// src/lib/auth.ts
import {
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signInWithCredential,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged,
  type User
} from 'firebase/auth';
import { ref, set, get } from 'firebase/database';
import { getFirebaseAuth, getFirebaseDatabase, isFirebaseConfigured, googleOAuthClientId } from './firebase';

export interface PepperUser {
  uid: string;
  username: string;
  displayName: string;
  email?: string;
  photoURL?: string;
  createdAt: number;
  lastLogin: number;
  hasCustomDisplayName?: boolean; // Flag to track if user has set a custom display name
  stats: {
    wins: number;
    losses: number;
    totalGames: number;
    bidStats: {
      totalBids: number;
      successfulBids: number;
      bidsByValue: Record<string, { attempts: number; successes: number }>;
      bidsBySuit: Record<string, { attempts: number; successes: number }>;
    };
    defensiveStats: {
      timesStayed: number;
      timesSet: number;
      timesSetOpponent: number;
      timesNegotiated: number;
    };
    partnerStats: Record<string, number>; // partnerId -> gamesPlayed
  };
}

// Initialize default user stats
const createDefaultStats = () => ({
  wins: 0,
  losses: 0,
  totalGames: 0,
  bidStats: {
    totalBids: 0,
    successfulBids: 0,
    bidsByValue: {},
    bidsBySuit: {}
  },
  defensiveStats: {
    timesStayed: 0,
    timesSet: 0,
    timesSetOpponent: 0,
    timesNegotiated: 0
  },
  partnerStats: {}
});

// Current user state
let currentUser: PepperUser | null = null;
const authStateListeners: ((_user: PepperUser | null) => void)[] = [];

const buildGoogleProvider = (): GoogleAuthProvider => {
  const provider = new GoogleAuthProvider();
  provider.addScope('profile');
  provider.addScope('email');
  return provider;
};

// Google sign-in via popup. Works on desktop (all browsers), but iOS Safari blocks the OAuth
// popup — use the redirect flow there (see prefersRedirectSignIn / signInWithGoogleRedirect).
export const signInWithGoogle = async (): Promise<PepperUser | null> => {
  if (!isFirebaseConfigured()) {
    console.warn('Firebase not configured. Cannot sign in.');
    return null;
  }

  try {
    const auth = getFirebaseAuth();
    if (!auth) throw new Error('Firebase Auth not initialized');

    const result = await signInWithPopup(auth, buildGoogleProvider());
    const pepperUser = await createOrUpdateUser(result.user);
    return pepperUser;
  } catch (error) {
    console.error('Error signing in with Google:', error);
    return null;
  }
};

// Google sign-in via full-page redirect. Preferred on mobile (especially iOS Safari, which blocks
// the OAuth popup). This NAVIGATES AWAY; the result is picked up by completeRedirectSignIn() when
// the browser returns to the app on the next load. Throws so the caller can fall back if needed.
export const signInWithGoogleRedirect = async (): Promise<void> => {
  if (!isFirebaseConfigured()) return;
  const auth = getFirebaseAuth();
  if (!auth) throw new Error('Firebase Auth not initialized');
  await signInWithRedirect(auth, buildGoogleProvider());
};

// Deprecated name kept for older call sites (was referenced but never defined).
export const signInWithGoogleAlternative = signInWithGoogleRedirect;

// Call on page load to complete a pending redirect sign-in. Returns the user if a redirect just
// resolved, else null. Safe to call on every load (getRedirectResult is null when none pending).
export const completeRedirectSignIn = async (): Promise<PepperUser | null> => {
  if (!isFirebaseConfigured()) return null;
  const auth = getFirebaseAuth();
  if (!auth) return null;
  try {
    const result = await getRedirectResult(auth);
    if (result?.user) return await createOrUpdateUser(result.user);
  } catch (error) {
    console.error('Error completing redirect sign-in:', error);
  }
  return null;
};

// Exchange a Google ID token (from Google Identity Services) for a Firebase session. This is a
// direct API call — no popup, no redirect, no cross-origin auth handler — so it works on iOS
// Safari where signInWithPopup/Redirect fail (ITP partitions the firebaseapp.com storage).
export const signInWithGoogleCredential = async (idToken: string): Promise<PepperUser | null> => {
  if (!isFirebaseConfigured()) return null;
  const auth = getFirebaseAuth();
  if (!auth) return null;
  try {
    const result = await signInWithCredential(auth, GoogleAuthProvider.credential(idToken));
    return await createOrUpdateUser(result.user);
  } catch (error) {
    console.error('Error signing in with Google credential:', error);
    return null;
  }
};

// Use Google Identity Services (GIS) for sign-in? Only when a client ID is configured AND we're
// not in emulator mode (the Auth emulator's fake-Google popup can't validate a real GIS token, so
// local testing keeps using the popup flow).
export const useGoogleIdentityServices = (): boolean =>
  Boolean(googleOAuthClientId) && import.meta.env.PUBLIC_FIREBASE_EMULATOR !== 'true';

// Should this device use the redirect flow instead of the popup? iOS (incl. iPadOS reporting as
// Mac) and Android block or mishandle the OAuth popup; redirect (full-page navigation) is reliable.
export const prefersRedirectSignIn = (): boolean => {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const iOS = /iPhone|iPad|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1);
  const android = /Android/.test(ua);
  return iOS || android;
};


// Sign out
export const signOutUser = async (): Promise<void> => {
  if (!isFirebaseConfigured()) return;

  try {
    const auth = getFirebaseAuth();
    if (auth) {
      await signOut(auth);
      currentUser = null;
      notifyAuthStateListeners(null);
    }
  } catch (error) {
    console.error('Error signing out:', error);
  }
};

// Create or update user in database
const createOrUpdateUser = async (firebaseUser: User): Promise<PepperUser> => {
  const database = getFirebaseDatabase();
  if (!database) throw new Error('Firebase Database not initialized');

  const userRef = ref(database, `users/${firebaseUser.uid}`);
  const snapshot = await get(userRef);

  const now = Date.now();
  let pepperUser: PepperUser;

  // Clean up photo URL to avoid rate limiting issues
  const cleanPhotoURL = (url: string | null | undefined): string | undefined => {
    if (!url) return undefined;

    // For Google Photos, ensure we use a standard size parameter to avoid rate limiting
    if (url.includes('googleusercontent.com')) {
      // Replace any existing size parameter with a standard one
      let cleanUrl = url.replace(/=s\d+-c$/, '=s96-c').replace(/=s\d+$/, '=s96');
      // If no size parameter exists, add one
      if (!cleanUrl.includes('=s')) {
        cleanUrl += '=s96-c';
      }
      return cleanUrl;
    }

    return url;
  };

  if (snapshot.exists()) {
    // Existing user - update last login
    const existingUser = snapshot.val() as PepperUser;
    pepperUser = {
      ...existingUser,
      lastLogin: now,
      // Only update displayName from Google if user hasn't set a custom one
      displayName: existingUser.hasCustomDisplayName
        ? existingUser.displayName
        : (firebaseUser.displayName || existingUser.displayName),
      email: firebaseUser.email || existingUser.email,
      photoURL: cleanPhotoURL(firebaseUser.photoURL) || existingUser.photoURL
    };
  } else {
    // New user - create profile
    const baseUsername = firebaseUser.email?.split('@')[0] || 'player';
    const username = await generateUniqueUsername(baseUsername);

    pepperUser = {
      uid: firebaseUser.uid,
      username,
      displayName: firebaseUser.displayName || username,
      email: firebaseUser.email || undefined,
      photoURL: cleanPhotoURL(firebaseUser.photoURL),
      createdAt: now,
      lastLogin: now,
      stats: createDefaultStats()
    };
  }

  // Save to database. RTDB rejects `undefined` values, so drop any unset optional fields
  // (e.g. photoURL/email for an account with no photo) before writing — a Google account
  // without a photo would otherwise fail to save its profile.
  await set(userRef, JSON.parse(JSON.stringify(pepperUser)));

  currentUser = pepperUser;
  notifyAuthStateListeners(pepperUser);

  return pepperUser;
};

// Generate unique username
const generateUniqueUsername = async (baseUsername: string): Promise<string> => {
  const database = getFirebaseDatabase();
  if (!database) throw new Error('Firebase Database not initialized');

  let username = baseUsername;
  let counter = 1;

  // Check if username exists and increment counter if needed
  while (await usernameExists(username)) {
    username = `${baseUsername}${counter}`;
    counter++;
  }

  return username;
};

// Check if username exists
const usernameExists = async (username: string): Promise<boolean> => {
  const database = getFirebaseDatabase();
  if (!database) return false;

  // For now, do a simple check. In production, we'd want an index for this.
  const usersRef = ref(database, 'users');
  const snapshot = await get(usersRef);

  if (!snapshot.exists()) return false;

  const users = snapshot.val() as Record<string, PepperUser>;
  return Object.values(users).some((user) => user.username === username);
};

// Auth state listener management
export const onAuthStateChange = (callback: (_user: PepperUser | null) => void) => {
  authStateListeners.push(callback);

  // Set up Firebase auth state listener on first subscription
  if (authStateListeners.length === 1 && isFirebaseConfigured()) {
    const auth = getFirebaseAuth();
    if (auth) {
      onAuthStateChanged(auth, async (firebaseUser) => {
        if (firebaseUser) {
          try {
            const pepperUser = await createOrUpdateUser(firebaseUser);
            currentUser = pepperUser;
            notifyAuthStateListeners(pepperUser);
          } catch (error) {
            console.error('Error updating user on auth state change:', error);
            currentUser = null;
            notifyAuthStateListeners(null);
          }
        } else {
          currentUser = null;
          notifyAuthStateListeners(null);
        }
      });
    }
  }

  // Return unsubscribe function
  return () => {
    const index = authStateListeners.indexOf(callback);
    if (index > -1) {
      authStateListeners.splice(index, 1);
    }
  };
};

// Notify all auth state listeners
const notifyAuthStateListeners = (user: PepperUser | null) => {
  authStateListeners.forEach(callback => callback(user));
};

// Get current user
export const getCurrentUser = (): PepperUser | null => {
  return currentUser;
};

// Check if user is authenticated
export const isAuthenticated = (): boolean => {
  return currentUser !== null;
};

// Lookup user by username (for game setup)
export const getUserByUsername = async (username: string): Promise<PepperUser | null> => {
  if (!isFirebaseConfigured()) return null;

  const database = getFirebaseDatabase();
  if (!database) return null;

  try {
    const usersRef = ref(database, 'users');
    const snapshot = await get(usersRef);

    if (!snapshot.exists()) return null;

    const users = snapshot.val() as Record<string, PepperUser>;
    const foundUser = Object.values(users).find((user) => user.username === username);

    return foundUser as PepperUser || null;
  } catch (error) {
    console.error('Error looking up user by username:', error);
    return null;
  }
};

// Get display name for user (fallback to username)
export const getDisplayName = (user: PepperUser): string => {
  return user.displayName || user.username;
};

// Update user's display name
export const updateDisplayName = async (newDisplayName: string): Promise<PepperUser | null> => {
  if (!isFirebaseConfigured() || !currentUser) {
    console.warn('Firebase not configured or user not signed in. Cannot update display name.');
    return null;
  }

  try {
    const database = getFirebaseDatabase();
    if (!database) throw new Error('Firebase Database not initialized');

    const userRef = ref(database, `users/${currentUser.uid}`);

    // Update the display name and mark as custom
    const updatedUser: PepperUser = {
      ...currentUser,
      displayName: newDisplayName.trim(),
      hasCustomDisplayName: true // Mark that user has set a custom display name
    };

    await set(userRef, updatedUser);

    // Update local state
    currentUser = updatedUser;
    notifyAuthStateListeners(updatedUser);

    return updatedUser;
  } catch (error) {
    console.error('Error updating display name:', error);
    return null;
  }
};

// Reset display name to Google's default
export const resetDisplayNameToGoogle = async (): Promise<PepperUser | null> => {
  if (!isFirebaseConfigured() || !currentUser) {
    console.warn('Firebase not configured or user not signed in. Cannot reset display name.');
    return null;
  }

  try {
    const auth = getFirebaseAuth();
    const firebaseUser = auth?.currentUser;

    if (!firebaseUser) {
      throw new Error('No Firebase user found');
    }

    const database = getFirebaseDatabase();
    if (!database) throw new Error('Firebase Database not initialized');

    const userRef = ref(database, `users/${currentUser.uid}`);

    // Reset to Google's display name and remove custom flag
    const updatedUser: PepperUser = {
      ...currentUser,
      displayName: firebaseUser.displayName || currentUser.username,
      hasCustomDisplayName: false // Remove custom flag
    };

    await set(userRef, updatedUser);

    // Update local state
    currentUser = updatedUser;
    notifyAuthStateListeners(updatedUser);

    return updatedUser;
  } catch (error) {
    console.error('Error resetting display name:', error);
    return null;
  }
};

// Search for users by username, display name, or email
export const searchUsers = async (query: string, limit: number = 5): Promise<PepperUser[]> => {
  if (!isFirebaseConfigured() || !query.trim()) return [];

  const database = getFirebaseDatabase();
  if (!database) return [];

  try {
    const usersRef = ref(database, 'users');
    const snapshot = await get(usersRef);

    if (!snapshot.exists()) return [];

    const users = snapshot.val() as Record<string, PepperUser>;
    const queryLower = query.toLowerCase().trim();

    // Search and rank results
    const matches = Object.values(users)
      .map(user => ({
        user,
        score: calculateSearchScore(user, queryLower)
      }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ user }) => user);

    return matches;
  } catch (error) {
    console.error('Error searching users:', error);
    return [];
  }
};

// Calculate search relevance score
const calculateSearchScore = (user: PepperUser, query: string): number => {
  let score = 0;

  // Exact username match (highest priority)
  if (user.username.toLowerCase() === query) {
    score += 100;
  }
  // Username starts with query
  else if (user.username.toLowerCase().startsWith(query)) {
    score += 80;
  }
  // Username contains query
  else if (user.username.toLowerCase().includes(query)) {
    score += 40;
  }

  // Display name matches
  if (user.displayName) {
    const displayNameLower = user.displayName.toLowerCase();
    if (displayNameLower === query) {
      score += 90;
    } else if (displayNameLower.startsWith(query)) {
      score += 70;
    } else if (displayNameLower.includes(query)) {
      score += 30;
    }
  }

  // Email matches (if available and not too revealing)
  if (user.email && query.includes('@')) {
    const emailLower = user.email.toLowerCase();
    if (emailLower === query) {
      score += 95;
    } else if (emailLower.startsWith(query)) {
      score += 75;
    }
  }

  return score;
};