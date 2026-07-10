# Local multiplayer testing (no real Google accounts)

Test the full multiplayer game — host gating, override, presence, the concurrent auction —
against the local Firebase emulators, signing in as **fake** users. No real Google accounts and
no touching production data.

## Prerequisites (one-time)
- A real Java runtime (the emulator is a Java process): `brew install --cask temurin`
- `firebase-tools`: `npm install -g firebase-tools` (or it runs via `npx`)

## Run it

```bash
npm run dev:emulator
```

This starts the **Auth + Realtime Database emulators** (with `database.rules.json` enforced) and
the Astro dev server in emulator mode, all in one process. Leave it running; `Ctrl-C` stops
everything. The app is at **http://localhost:4321** and talks only to the local emulators.

## Simulate four players on one machine

Firebase auth is one-user-per-origin, so you need four separate browser **contexts** (not tabs):
- four Chrome **profiles**, or
- a normal window + windows in other browsers (Chrome, Firefox, Safari, Edge).

In each context, open http://localhost:4321 and click **Sign in with Google**. Against the Auth
emulator this opens a fake account picker — choose **Add new account** and type any email +
display name. Each context becomes a distinct fake user (its own uid). Repeat for all four.

Then:
1. In one context (this player is the **host**), set up a game and add the other three by the
   usernames they were assigned on first sign-in (the account page shows each user's username).
2. Share the **room code** (shown on the game page) and have the other three join from their
   contexts.
3. Play. You'll see host gating (host enters decisions; others get **Enter this myself**), the
   presence fallback, and — once all four are signed in — the per-seat concurrent auction.

## Notes
- Emulator data is in-memory and wiped when you stop `dev:emulator` — every run is a clean slate.
- The emulators run project `pepper-scorer` (from `.firebaserc`), matching `.env`, so namespaces
  line up. Nothing here reaches the live database.
- For a fully automated (headless) check of the auction over the real rules, see
  `npm run test:emulator` (`tests/emulator/`).
