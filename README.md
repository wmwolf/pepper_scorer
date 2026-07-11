# Pepper Scorer

A web app for scoring the card game **Pepper** — real-time score tracking, series play, an
award/statistics system, and optional cloud multiplayer (sign in, invite players by room code,
and bid from your own phone).

**Live:** https://billwolf.space/pepper_scorer/

Built with [Astro](https://astro.build) + [Tailwind](https://tailwindcss.com). Cloud features use
[Firebase](https://firebase.google.com) (Google auth + Realtime Database). Without Firebase
configured, the app runs fully in local-only mode (localStorage), so core scoring always works.

## Quick start

```sh
npm install
npm run dev            # dev server at http://localhost:4321
```

Cloud features need Firebase env vars — copy `.env.example` to `.env` and fill them in
(see [FIREBASE_SETUP.md](./FIREBASE_SETUP.md)).

## Commands

| Command | Action |
| :-- | :-- |
| `npm run dev` | Dev server at `localhost:4321` |
| `npm run build` | Production build to `./dist/` |
| `npm run preview` | Preview the production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint over `src/**/*.ts` |
| `npm run test:run` | Unit + integration tests (Vitest) |
| `npm run test:emulator` | Firebase emulator tests (rules + wiring; needs Java) |
| `npm run dev:emulator` | Dev server against local Firebase emulators (multiplayer testing) |

## Testing multiplayer locally

`npm run dev:emulator` runs the app against the local Firebase Auth + Database emulators so you
can play a full multi-account game on one machine with fake accounts — see
[LOCAL_MULTIPLAYER_TESTING.md](./LOCAL_MULTIPLAYER_TESTING.md).

## Project layout

- `src/lib/` — core logic: `gameState.ts` (game/scoring), `game.ts` (UI controller),
  `pepper-awards.ts` + `statistics-util.ts` (awards/stats), `auction.ts` (bidding engine),
  and the Firebase layer (`firebase.ts`, `auth.ts`, `firebaseGameState.ts`, `multiplayer.ts`).
- `src/pages/` — `index.astro` (setup), `game.astro` (gameplay), `account.astro`.
- `src/components/`, `src/layouts/` — UI.
- `database.rules.json` — Firebase Realtime Database security rules (deployed via
  `firebase deploy --only database`).
- `rules/` — the game's rules (LaTeX + generated Markdown).
- `development-plan.md` — roadmap and phase status. `CLAUDE.md` — guidance for AI coding agents.

## Deployment

Pushing to `main` builds and deploys to GitHub Pages (`.github/workflows/astro.yml`). The
`PUBLIC_FIREBASE_*` and `PUBLIC_GOOGLE_OAUTH_CLIENT_ID` values are injected from GitHub Actions
secrets at build time.
