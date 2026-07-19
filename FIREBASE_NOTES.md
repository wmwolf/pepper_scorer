# Firebase internals & gotchas

Deep reference for the Firebase layer, devolved from `CLAUDE.md` to keep that file focused. The
load-bearing footguns you need *ambiently* (the RTDB `undefined` behavior, the turn-gating/host
model) stay in `CLAUDE.md`; this file holds the detail you consult when actively working in the
Firebase code. For user-facing setup (creating the project, OAuth, env vars) see `FIREBASE_SETUP.md`.

## Security rules (`database.rules.json`)

Version-controlled in `database.rules.json` and **deployed** to project `pepper-scorer` (last
redeploy 2026-07-19 for the host claim). Change them by editing that file and running
`firebase deploy --only database`.

- **Game creation** gated to `metadata/createdBy === auth.uid`.
- **`gameState` / `bidding`** writable by the four seated players **or the current host**
  (`metadata/currentHost`). See the host-role note in `CLAUDE.md`.
- **`metadata`** immutable except `status` / `lastUpdated` / `seriesId` / `currentHost`. The last is
  claimable by seated players or the creator (that's how host takeover works).
- **`presence/$uid`** self-write only; children are per-device (`$deviceId → {mode, ts}`).
- **`series` / `userGames`** auth-gated.

### User-data split to prevent email mining (2026-07-11)

- `/users/$uid` is self-read + self-write only (email/stats private).
- A PII-free `/directory/$uid` (`{uid, username, displayName, photoURL}`) is auth-gated readable +
  self-write, and is what the roster search (`searchUsers`) reads.
- `createOrUpdateUser` / display-name edits mirror the public subset via `syncDirectoryEntry`;
  search matches username + display-name only (never email).
- **Do NOT** reintroduce a broad `/users` read or put email in `/directory`.

(The real project id is `pepper-scorer`; an early typo wrote `pepper-score` in `.env`/`.firebaserc`
— both fixed.)

## Emulator tests

`npm run test:emulator` (needs a real Java runtime; wraps `emulators:exec --only auth,database`)
runs `tests/emulator/` — rules coverage via `@firebase/rules-unit-testing` plus end-to-end flows
across authenticated clients under the real rules. Kept OUT of the fast `npm run test:run`; runs in
the CI `emulator` job. `src/pages/dev-auction.astro` is a dev-only visual harness for driving the
auction against the local emulators.

**Emulator gotchas:**
- The RTDB namespace is `<project>-default-rtdb` (a `?ns=` override splits namespaces).
- `runTransaction` needs an active `onValue` listener or its optimistic first pass sees `null` and
  aborts.
- The harness drives every account through one browser context, and signing out cancels the
  previous account's listeners (reads require `auth != null`) — so cross-device live-push is checked
  by re-loading, not by watching a listener across a sign-out.
