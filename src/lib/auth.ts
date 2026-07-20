// src/lib/auth.ts
import {
  signInWithPopup,
  signInWithCredential,
  signInAnonymously,
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
  // A throwaway anonymous session (watch/TV mode): read-only, never persisted to /users or the
  // public directory. Carries default (empty) stats so the type stays uniform.
  isAnonymous?: boolean;
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

// Public directory entry — the ONLY user data readable by other players (for the roster search).
// Deliberately excludes email/stats: full profiles live at owner-only `/users/$uid`, so no PII ever
// reaches another client. Search matches display name + username only (never email).
export interface PublicProfile {
  uid: string;
  username: string;
  displayName: string;
  photoURL?: string;
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

// Google sign-in via popup. Used ONLY for local emulator testing (`npm run dev:emulator`), where
// the fake Auth emulator can't validate a real Google Identity Services token. Production uses GIS
// (signInWithGoogleCredential) instead — see useGoogleIdentityServices().
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

// Write the PII-free public directory entry for a user. Called on sign-in and whenever the display
// name changes, so the searchable directory never drifts from /users. Strips undefined (RTDB rejects
// it) — e.g. a photo-less account's photoURL.
const syncDirectoryEntry = async (user: PepperUser): Promise<void> => {
  const database = getFirebaseDatabase();
  if (!database) return;
  const publicProfile: PublicProfile = {
    uid: user.uid,
    username: user.username,
    displayName: user.displayName,
    photoURL: user.photoURL,
  };
  await set(ref(database, `directory/${user.uid}`), JSON.parse(JSON.stringify(publicProfile)));
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

    // Only update displayName from Google if the user hasn't set a custom one.
    const displayName = existingUser.hasCustomDisplayName
      ? existingUser.displayName
      : (firebaseUser.displayName || existingUser.displayName);

    // Self-healing migration: legacy usernames were the email local part (all accounts created
    // before 2026-07-11), which leaks the address through the public directory search. If this
    // username still equals the email local part, regenerate it from the display name. One-time —
    // after migration the username no longer matches, so this won't fire again.
    let username = existingUser.username;
    const emailLocalPart = firebaseUser.email?.split('@')[0]?.toLowerCase();
    if (username && emailLocalPart && username.toLowerCase() === emailLocalPart) {
      username = await generateUniqueUsername(slugifyDisplayName(displayName || '') || 'player');
    }

    pepperUser = {
      ...existingUser,
      username,
      lastLogin: now,
      displayName,
      email: firebaseUser.email || existingUser.email,
      photoURL: cleanPhotoURL(firebaseUser.photoURL) || existingUser.photoURL
    };
  } else {
    // New user - create profile. Derive the username from the display name, NOT the email local
    // part: usernames are publicly searchable, so an email-derived one would leak the address.
    const username = await generateUniqueUsername(
      slugifyDisplayName(firebaseUser.displayName || '') || 'player'
    );

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

  // Mirror the searchable, PII-free subset into the public directory. This is what other players'
  // roster search reads (see searchUsers) — email/stats stay behind the owner-only /users node.
  await syncDirectoryEntry(pepperUser);

  currentUser = pepperUser;
  notifyAuthStateListeners(pepperUser);

  return pepperUser;
};

// Turn a display name into a username slug: lowercase, accent-stripped, alphanumerics joined by
// single hyphens, trimmed to a reasonable length. Deliberately NOT derived from the email — the
// username is publicly searchable, so it must not encode the address. Returns '' when nothing
// usable remains (callers fall back to 'player').
const slugifyDisplayName = (name: string): string =>
  name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)
    .replace(/-+$/g, '');

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

// Check if username exists. Reads the public directory (not /users, which is now owner-only). The
// caller is mid-sign-in and therefore authenticated, so the auth-gated directory read is permitted.
const usernameExists = async (username: string): Promise<boolean> => {
  const database = getFirebaseDatabase();
  if (!database) return false;

  const directoryRef = ref(database, 'directory');
  const snapshot = await get(directoryRef);

  if (!snapshot.exists()) return false;

  const profiles = snapshot.val() as Record<string, PublicProfile>;
  return Object.values(profiles).some((profile) => profile.username === username);
};

// Auth state listener management
export const onAuthStateChange = (callback: (_user: PepperUser | null) => void) => {
  authStateListeners.push(callback);

  // Set up Firebase auth state listener on first subscription
  if (authStateListeners.length === 1 && isFirebaseConfigured()) {
    const auth = getFirebaseAuth();
    if (auth) {
      onAuthStateChanged(auth, async (firebaseUser) => {
        if (firebaseUser && firebaseUser.isAnonymous) {
          // Watch/TV mode: an anonymous session is a read-only onlooker. Do NOT create a profile
          // or a directory entry (that would pollute the public roster with throwaway accounts) —
          // build a minimal in-memory identity only.
          currentUser = {
            uid: firebaseUser.uid,
            username: '',
            displayName: 'Guest',
            isAnonymous: true,
            createdAt: Date.now(),
            lastLogin: Date.now(),
            stats: createDefaultStats(),
          };
          notifyAuthStateListeners(currentUser);
        } else if (firebaseUser) {
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

// Whether Firebase has reported its initial auth state at least once. Until then, getCurrentUser()
// can be transiently null for a genuinely signed-in user (the cold-load race) — awaitAuthReady()
// lets callers wait for the real answer.
let authSettled = false;

// Notify all auth state listeners
const notifyAuthStateListeners = (user: PepperUser | null) => {
  authSettled = true;
  authStateListeners.forEach(callback => callback(user));
};

// Resolve once Firebase has determined the initial auth state (with the user, or null). Resolves
// immediately if that already happened, or if Firebase isn't configured (local-only mode). Use this
// before reading getMySeat()/isHost() on a cold load so a seated player isn't misjudged a spectator.
export const awaitAuthReady = (): Promise<PepperUser | null> => {
  if (!isFirebaseConfigured()) return Promise.resolve(null);
  if (authSettled) return Promise.resolve(currentUser);
  return new Promise(resolve => {
    const unsubscribe = onAuthStateChange(user => {
      unsubscribe();
      resolve(user);
    });
  });
};

// Ensure this device has SOME authenticated session so it can read a shared game (the `games`
// read rule requires auth != null). If already signed in, returns that user; otherwise signs in
// ANONYMOUSLY — the watch/TV-mode path for a signed-out onlooker. Returns null if anonymous auth
// is unavailable (e.g. the provider isn't enabled in the Firebase console), in which case the read
// will fail and the caller falls back to "no access".
export const ensureAnonymousAuth = async (): Promise<PepperUser | null> => {
  if (!isFirebaseConfigured()) return null;
  if (currentUser) return currentUser;
  const auth = getFirebaseAuth();
  if (!auth) return null;
  return new Promise(resolve => {
    const unsubscribe = onAuthStateChange(user => {
      if (user) { unsubscribe(); resolve(user); }
    });
    signInAnonymously(auth).catch(error => {
      console.error('Anonymous sign-in failed (watch mode unavailable):', error);
      unsubscribe();
      resolve(null);
    });
  });
};

// Get current user
export const getCurrentUser = (): PepperUser | null => {
  return currentUser;
};

// Check if user is authenticated
export const isAuthenticated = (): boolean => {
  return currentUser !== null;
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

    await set(userRef, JSON.parse(JSON.stringify(updatedUser)));

    // Keep the public directory in sync so search shows the new display name.
    await syncDirectoryEntry(updatedUser);

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

    await set(userRef, JSON.parse(JSON.stringify(updatedUser)));

    // Keep the public directory in sync so search shows the reset display name.
    await syncDirectoryEntry(updatedUser);

    // Update local state
    currentUser = updatedUser;
    notifyAuthStateListeners(updatedUser);

    return updatedUser;
  } catch (error) {
    console.error('Error resetting display name:', error);
    return null;
  }
};

// Search the public directory by username or display name. Returns PII-free PublicProfiles — never
// email. Requires sign-in: the directory is auth-gated server-side, so we bail early when signed out
// to avoid a guaranteed permission-denied round-trip (and to keep the directory un-probeable by
// anonymous visitors). Email is intentionally NOT a search key — see PublicProfile.
export const searchUsers = async (query: string, limit: number = 5): Promise<PublicProfile[]> => {
  if (!isFirebaseConfigured() || !query.trim()) return [];
  if (!isAuthenticated()) return [];

  const database = getFirebaseDatabase();
  if (!database) return [];

  try {
    const directoryRef = ref(database, 'directory');
    const snapshot = await get(directoryRef);

    if (!snapshot.exists()) return [];

    const profiles = snapshot.val() as Record<string, PublicProfile>;
    const queryLower = query.toLowerCase().trim();

    // Search and rank results
    const matches = Object.values(profiles)
      .map(profile => ({
        profile,
        score: calculateSearchScore(profile, queryLower)
      }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ profile }) => profile);

    return matches;
  } catch (error) {
    console.error('Error searching users:', error);
    return [];
  }
};

// Calculate search relevance score. Username and display name only — email is never in the directory.
const calculateSearchScore = (profile: PublicProfile, query: string): number => {
  let score = 0;

  // Exact username match (highest priority)
  if (profile.username.toLowerCase() === query) {
    score += 100;
  }
  // Username starts with query
  else if (profile.username.toLowerCase().startsWith(query)) {
    score += 80;
  }
  // Username contains query
  else if (profile.username.toLowerCase().includes(query)) {
    score += 40;
  }

  // Display name matches
  if (profile.displayName) {
    const displayNameLower = profile.displayName.toLowerCase();
    if (displayNameLower === query) {
      score += 90;
    } else if (displayNameLower.startsWith(query)) {
      score += 70;
    } else if (displayNameLower.includes(query)) {
      score += 30;
    }
  }

  return score;
};