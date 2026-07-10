// src/lib/firebase.ts
import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getDatabase, connectDatabaseEmulator } from 'firebase/database';

// Firebase configuration interface
interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  databaseURL: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

// Firebase configuration - will be set via environment variables
// These values will come from the Firebase Console after manual setup
const firebaseConfig: FirebaseConfig = {
  apiKey: import.meta.env.PUBLIC_FIREBASE_API_KEY || '',
  authDomain: import.meta.env.PUBLIC_FIREBASE_AUTH_DOMAIN || '',
  databaseURL: import.meta.env.PUBLIC_FIREBASE_DATABASE_URL || '',
  projectId: import.meta.env.PUBLIC_FIREBASE_PROJECT_ID || '',
  storageBucket: import.meta.env.PUBLIC_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: import.meta.env.PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: import.meta.env.PUBLIC_FIREBASE_APP_ID || ''
};

// Check if Firebase is configured
export const isFirebaseConfigured = () => {
  const configured = Boolean(
    firebaseConfig.apiKey &&
    firebaseConfig.authDomain &&
    firebaseConfig.databaseURL &&
    firebaseConfig.projectId
  );

  if (!configured) {
    console.warn('Firebase configuration incomplete');
  }

  return configured;
};

// Initialize Firebase app
let app: ReturnType<typeof initializeApp> | null = null;
let auth: ReturnType<typeof getAuth> | null = null;
let database: ReturnType<typeof getDatabase> | null = null;

export const initializeFirebase = () => {
  if (!isFirebaseConfigured()) {
    console.warn('Firebase not configured. Falling back to localStorage.');
    return { app: null, auth: null, database: null };
  }

  try {
    if (!app) {
      app = initializeApp(firebaseConfig);
      auth = getAuth(app);
      database = getDatabase(app);

      // Test seam (Phase 11 emulator harness): when the emulator flag is set, point the RTDB
      // client at the local Firebase emulator instead of production. Enabled only by the
      // emulator Vitest project (see vitest.emulator.config.ts), never in the app build.
      if (import.meta.env.PUBLIC_FIREBASE_EMULATOR === 'true') {
        connectDatabaseEmulator(database, '127.0.0.1', 9000);
      }
    }
    return { app, auth, database };
  } catch (error) {
    console.error('Error initializing Firebase:', error);
    return { app: null, auth: null, database: null };
  }
};

// Export Firebase services (with null checks)
export const getFirebaseAuth = () => {
  if (!auth) {
    const { auth: newAuth } = initializeFirebase();
    return newAuth;
  }
  return auth;
};

export const getFirebaseDatabase = () => {
  if (!database) {
    const { database: newDatabase } = initializeFirebase();
    return newDatabase;
  }
  return database;
};

export { firebaseConfig };