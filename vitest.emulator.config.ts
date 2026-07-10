import { defineConfig } from 'vitest/config'

// Separate Vitest project for the Firebase emulator harness (Phase 11). Kept OUT of the default
// `npm run test:run` so that fast suite stays Java-free. Run via:
//   npm run test:emulator
// which wraps this in `firebase emulators:exec --only database` so the emulator is up.
//
// NOTE: requires a real Java runtime (the Firebase emulator is a Java process). This machine has
// only a Java stub, so these tests run in CI (a job installs Temurin + firebase-tools), not here.
export default defineConfig({
  test: {
    environment: 'jsdom', // FirebaseGameManager touches window/localStorage/document
    globals: true,
    include: ['tests/emulator/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
    // Point our firebase.ts singleton at the emulator with a demo (offline) project.
    env: {
      PUBLIC_FIREBASE_EMULATOR: 'true',
      PUBLIC_FIREBASE_API_KEY: 'demo-key',
      PUBLIC_FIREBASE_AUTH_DOMAIN: 'demo-pepper.firebaseapp.com',
      PUBLIC_FIREBASE_DATABASE_URL: 'http://127.0.0.1:9000?ns=demo-pepper',
      PUBLIC_FIREBASE_PROJECT_ID: 'demo-pepper',
      PUBLIC_FIREBASE_STORAGE_BUCKET: 'demo-pepper.appspot.com',
      PUBLIC_FIREBASE_MESSAGING_SENDER_ID: 'demo-sender',
      PUBLIC_FIREBASE_APP_ID: 'demo-app',
    },
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
})
