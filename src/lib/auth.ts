// src/lib/auth.ts
import {
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged,
  type User
} from 'firebase/auth';
import { ref, set, get } from 'firebase/database';
import { getFirebaseAuth, getFirebaseDatabase, isFirebaseConfigured } from './firebase';

export interface PepperUser {
  uid: string;
  username: string;
  displayName: string;
  email?: string;
  photoURL?: string;
  createdAt: number;
  lastLogin: number;
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
const authStateListeners: ((user: PepperUser | null) => void)[] = [];

// Google sign-in
export const signInWithGoogle = async (): Promise<PepperUser | null> => {
  if (!isFirebaseConfigured()) {
    console.warn('Firebase not configured. Cannot sign in.');
    return null;
  }

  try {
    const auth = getFirebaseAuth();
    if (!auth) throw new Error('Firebase Auth not initialized');

    const provider = new GoogleAuthProvider();
    provider.addScope('profile');
    provider.addScope('email');

    const result = await signInWithPopup(auth, provider);
    const user = result.user;

    // Create or update user in database
    const pepperUser = await createOrUpdateUser(user);
    return pepperUser;
  } catch (error) {
    console.error('Error signing in with Google:', error);
    return null;
  }
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

  if (snapshot.exists()) {
    // Existing user - update last login
    const existingUser = snapshot.val() as PepperUser;
    pepperUser = {
      ...existingUser,
      lastLogin: now,
      // Update profile info from Google in case it changed
      displayName: firebaseUser.displayName || existingUser.displayName,
      email: firebaseUser.email || existingUser.email,
      photoURL: firebaseUser.photoURL || existingUser.photoURL
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
      photoURL: firebaseUser.photoURL || undefined,
      createdAt: now,
      lastLogin: now,
      stats: createDefaultStats()
    };
  }

  // Save to database
  await set(userRef, pepperUser);

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
export const onAuthStateChange = (callback: (user: PepperUser | null) => void) => {
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