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

**Creating the accounts** (you make them up — there's no "create account" step in the roster; the
roster only *looks up* existing users by username). In each context, open http://localhost:4321,
click **Sign in with Google**, and in the emulator's popup click **Add new account** →
**Auto-generate user information** (or type an email + display name) → **Sign in**. That context is
now that user. You do NOT need to sign out between accounts: the emulator is one shared server, so
an account you add in context 1 already appears in context 2's popup — just click **Add new
account** again for the next player. Repeat until each of the four contexts is a different user.
(Each user's **username** — derived from the email, shown on the Account page — is what the host
types into the roster.)

Then:
1. In the **host** context, set up a game and add the other three by their usernames.
2. Share the **room code** (shown on the game page) and have the other three join from their contexts.
3. Play. You'll see host gating (host enters decisions; others get **Enter this myself**), the
   presence fallback, and — once all four are signed in — the per-seat concurrent auction.

## Fake accounts persist across restarts
`dev:emulator` saves the emulator's Auth + DB state to `./emulator-data/` on exit and reloads it
next time (via `--export-on-exit` / `--import`, and `emulator-data/` is git-ignored). So you only
create your four fake accounts **once** — add them on the first run, `Ctrl-C`, and every later
`dev:emulator` starts with them already signed-up. Delete `emulator-data/` to reset to a clean slate.

**Shutting down (important for persistence):** press `Ctrl-C` **once** and wait a few seconds. The
emulator does a *clean shutdown* that runs the export — you'll see `Received SIGINT … Starting a
clean shutdown`. The `Script exited unsuccessfully (code 1)` line is harmless (a dev server exiting
via Ctrl-C always returns non-zero). Do **not** press Ctrl-C a second time — that force-kills before
the export finishes and your accounts are lost. After it exits, `emulator-data/auth_export/` should
exist. (This is why the dev server is launched directly rather than through `npm run dev` — `npm`
doesn't forward Ctrl-C, which made the first attempt hang.)

## Notes
- The emulators run project `pepper-scorer` (from `.firebaserc`), matching `.env`, so namespaces
  line up. Nothing here reaches the live database.
- For a fully automated (headless) check of the auction over the real rules, see
  `npm run test:emulator` (`tests/emulator/`).
