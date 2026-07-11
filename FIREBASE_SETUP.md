# Firebase Setup Instructions

This document provides step-by-step instructions for setting up Firebase for the Pepper Scorer application's multiplayer features.

## Prerequisites

- Google account
- Access to [Firebase Console](https://console.firebase.google.com)

## Step 1: Create Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Click "Create a project" or "Add project"
3. Enter project name: `pepper-scorer` (or your preferred name)
4. Choose whether to enable Google Analytics (optional for this project)
5. Click "Create project"
6. Wait for project creation to complete

## Step 2: Enable Authentication

1. In the Firebase Console, click on "Authentication" in the left sidebar
2. Click "Get started" if this is your first time
3. Go to the "Sign-in method" tab
4. Enable the following sign-in providers:
   - **Google**: Click on Google → Enable → Save
   - Configure OAuth consent screen if prompted:
     - Add your domain (e.g., `localhost` for development)
     - Add authorized domains for production

> Note: for iOS Safari support, sign-in uses **Google Identity Services** (see the Google Sign-In
> section below) rather than the OAuth popup/redirect, which Safari's tracking protection breaks
> for cross-origin auth domains.

## Step 3: Enable Realtime Database

1. Click on "Realtime Database" in the left sidebar
2. Click "Create Database"
3. Choose your database location (closest to your users)
4. Start in **locked mode** — the real rules are version-controlled and deployed from the repo
   (see "Security rules" below). Do NOT rely on "test mode": its rules are time-limited and expire
   to deny-all.
5. Click "Done"

## Step 4: Get Web App Configuration

1. In the Firebase Console, click the gear icon ⚙️ next to "Project Overview"
2. Select "Project settings"
3. Scroll down to "Your apps" section
4. Click the "Web" icon `</>`
5. Enter app nickname: `pepper-scorer-web`
6. **Do not** check "Set up Firebase Hosting" (we use different hosting)
7. Click "Register app"
8. Copy the configuration object that looks like this:

```javascript
const firebaseConfig = {
  apiKey: "your-api-key",
  authDomain: "your-project.firebaseapp.com",
  databaseURL: "https://your-project-default-rtdb.firebaseio.com/",
  projectId: "your-project-id",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "123456789",
  appId: "your-app-id"
};
```

## Step 5: Configure Environment Variables

1. Create a `.env` file in the root of your project (if it doesn't exist)
2. Add the Firebase configuration values from Step 4:

```bash
# Firebase Configuration
PUBLIC_FIREBASE_API_KEY=your-api-key
PUBLIC_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
PUBLIC_FIREBASE_DATABASE_URL=https://your-project-default-rtdb.firebaseio.com/
PUBLIC_FIREBASE_PROJECT_ID=your-project-id
PUBLIC_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
PUBLIC_FIREBASE_MESSAGING_SENDER_ID=123456789
PUBLIC_FIREBASE_APP_ID=your-app-id
```

3. Add `.env` to your `.gitignore` file to keep credentials secure:

```gitignore
# Environment variables
.env
.env.local
.env.production
```

## Step 6: Google Sign-In (Google Identity Services)

iOS Safari's tracking protection breaks the OAuth popup/redirect flow when the auth handler
(`<project>.firebaseapp.com`) is a different origin than the app. To fix it, the app uses **Google
Identity Services** (GIS), which returns an ID token via a JS callback that we exchange with
`signInWithCredential` — no popup, no redirect, no cross-origin handler.

1. Get the OAuth **Web client** ID: Firebase console → Authentication → Sign-in method → Google →
   *Web SDK configuration* → "Web client ID" (this is an auto-created client in your project's
   Google Cloud credentials).
2. Authorize your origins: Google Cloud console → APIs & Services → Credentials → open that Web
   client → **Authorized JavaScript origins** → add your app origins (e.g. `https://billwolf.space`
   and `http://localhost:4321`). Origins are scheme + host only (no path).
3. Set `PUBLIC_GOOGLE_OAUTH_CLIENT_ID` (in `.env` and, for deploys, as a GitHub Actions secret).

When this value is unset, or when running against the emulator, the app falls back to the
popup/redirect flow (fine for desktop and local emulator testing).

## Security rules

The Realtime Database rules are **version-controlled** in `database.rules.json` (not edited in the
console) and deployed with:

```sh
firebase deploy --only database
```

They restrict writes to seated, authenticated players (game creation to the creator; `gameState`/
`bidding`/`presence` to seated players; immutable `metadata` except status/lastUpdated/seriesId).
The rules are covered by emulator tests — see below. Requires `firebase-tools` and a `.firebaserc`
pointing at your project.

## Testing

- **App config:** start `npm run dev`, open `http://localhost:4321`, and check the console for
  Firebase warnings. "Firebase configuration incomplete" means an env var is missing.
- **Local multiplayer:** `npm run dev:emulator` runs the app against the Auth + Database emulators
  with fake accounts — see [LOCAL_MULTIPLAYER_TESTING.md](./LOCAL_MULTIPLAYER_TESTING.md).
- **Rules + wiring:** `npm run test:emulator` runs hermetic emulator tests (needs a Java runtime).

## Troubleshooting

### Common Issues

1. **"Firebase not configured" warning**:
   - Check that all environment variables are set correctly
   - Make sure you're using `PUBLIC_` prefix for Astro environment variables
   - Restart your development server after adding environment variables

2. **Authentication errors**:
   - Verify that Google sign-in is enabled in Firebase Console
   - Check that your domain is added to authorized domains
   - For localhost development, `localhost` should be in authorized domains

3. **Database permission errors**:
   - If using production rules, ensure your user is authenticated
   - For development, you can use test mode (allows read/write to all)

4. **CORS errors**:
   - Add your domain to Firebase authorized domains
   - Check that the authDomain matches your Firebase project

### Environment Variable Example

Your `.env` file should look something like this (with your actual values):

See `.env.example` for the full, documented list. A filled-in `.env` looks like:

```bash
PUBLIC_FIREBASE_API_KEY=AIzaSyDOCAbC123dEf456GhI789jKl012-MnO
PUBLIC_FIREBASE_AUTH_DOMAIN=pepper-scorer-12345.firebaseapp.com
PUBLIC_FIREBASE_DATABASE_URL=https://pepper-scorer-12345-default-rtdb.firebaseio.com/
PUBLIC_FIREBASE_PROJECT_ID=pepper-scorer-12345
PUBLIC_FIREBASE_STORAGE_BUCKET=pepper-scorer-12345.appspot.com
PUBLIC_FIREBASE_MESSAGING_SENDER_ID=123456789012
PUBLIC_FIREBASE_APP_ID=1:123456789012:web:abcdef123456
PUBLIC_GOOGLE_OAUTH_CLIENT_ID=123456789012-abc123.apps.googleusercontent.com
```

For production (GitHub Pages), these are set as GitHub Actions **secrets** (same names) and injected
at build time by `.github/workflows/astro.yml`.

## Security Notes

- Never commit your `.env` file to version control (it is git-ignored).
- Firebase web config values (including the API key and OAuth client ID) are public by design —
  they ship in the client bundle; access is controlled by the security rules + authorized domains,
  not by hiding these values.
- Keep `database.rules.json` locked down and deployed (`firebase deploy --only database`) before
  exposing multiplayer to real users.