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

## Step 3: Enable Realtime Database

1. Click on "Realtime Database" in the left sidebar
2. Click "Create Database"
3. Choose your database location (closest to your users)
4. Start in **test mode** (we'll add security rules later)
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

## Step 6: Configure Database Security Rules (Optional - for production)

For development, test mode is fine. For production, update the database rules:

1. Go to "Realtime Database" → "Rules" tab
2. Replace the default rules with:

```json
{
  "rules": {
    "users": {
      "$userId": {
        ".read": true,
        ".write": "$userId === auth.uid"
      }
    },
    "games": {
      "$gameId": {
        ".read": "auth != null && (root.child('userGames').child(auth.uid).child($gameId).exists() || data.child('metadata/roomCode').val() != null)",
        ".write": "auth != null && data.child('metadata/createdBy').val() === auth.uid"
      }
    },
    "userGames": {
      "$userId": {
        ".read": "$userId === auth.uid",
        ".write": "$userId === auth.uid"
      }
    }
  }
}
```

3. Click "Publish"

## Step 7: Test the Configuration

1. Start your development server: `npm run dev`
2. Open your browser to `http://localhost:4321`
3. Check the browser console for any Firebase-related errors
4. If everything is working, you should see "Firebase initialized successfully" in the console

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

```bash
PUBLIC_FIREBASE_API_KEY=AIzaSyDOCAbC123dEf456GhI789jKl012-MnO
PUBLIC_FIREBASE_AUTH_DOMAIN=pepper-scorer-12345.firebaseapp.com
PUBLIC_FIREBASE_DATABASE_URL=https://pepper-scorer-12345-default-rtdb.firebaseio.com/
PUBLIC_FIREBASE_PROJECT_ID=pepper-scorer-12345
PUBLIC_FIREBASE_STORAGE_BUCKET=pepper-scorer-12345.appspot.com
PUBLIC_FIREBASE_MESSAGING_SENDER_ID=123456789012
PUBLIC_FIREBASE_APP_ID=1:123456789012:web:abcdef123456
```

## Next Steps

Once Firebase is configured:

1. Test authentication by implementing sign-in/sign-out buttons
2. Test database connectivity by creating a simple game
3. Implement real-time game synchronization
4. Add mobile bidding interface

## Security Notes

- Never commit your `.env` file to version control
- Use different Firebase projects for development and production
- Review and update security rules before going to production
- Consider setting up Firebase usage alerts to monitor costs