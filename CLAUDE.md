# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Pepper Scorer is an Astro-based web application for scoring the card game Pepper. It features real-time game state management, comprehensive award tracking, and series support. The application uses localStorage for persistence and includes an advanced statistics system with dynamic award calculations.

## Architecture

### Core Game Logic (`src/lib/`)
- **gameState.ts**: Central game state management with `GameManager` class. Handles hand encoding, score calculation, series management, and undo functionality. This is the heart of the application's game logic.
- **game.ts**: UI controller and main gameplay orchestration. Contains complex UI update logic, confetti effects, and victory celebration handling. Imports and manages all other game components.
- **pepper-awards.ts**: Comprehensive award system with 23+ different awards for individual games and series. Contains award definitions, evaluation logic, and selection algorithms.
- **statistics-util.ts**: Advanced statistical analysis and HTML generation for game summaries.

### Firebase Layer (merged into `main` since the Phase 8 multiplayer work)
- **firebase.ts**: Firebase SDK config/init from `PUBLIC_FIREBASE_*` env vars (see `.env.example`). `isFirebaseConfigured()` gates activation; the app falls back to local/localStorage mode when unconfigured. A `PUBLIC_FIREBASE_EMULATOR` flag points auth+DB at the local emulators.
- **auth.ts**: Google authentication, `PepperUser` profiles, display names, username lookup/search. Sign-in prefers **Google Identity Services** in production (`signInWithGoogleCredential`, gated by `useGoogleIdentityServices()` = a `PUBLIC_GOOGLE_OAUTH_CLIENT_ID` is set and not in emulator mode) — GIS sidesteps iOS Safari's ITP breakage of `signInWithPopup`/`signInWithRedirect` (both fail there because the auth handler is cross-origin). Popup/redirect remain the fallback (and are what the emulator uses locally). See FIREBASE_SETUP.md.
- **firebaseGameState.ts**: `FirebaseGameManager extends GameManager`, overriding `addHandPart`/`undo`/`completeGame`/`convertToSeries` to sync to the Firebase Realtime Database with live listeners and series coordination. Large (~1300 lines); the sync/host/auction wiring is covered by `tests/emulator/manager-flow.test.ts`, but the class is otherwise lightly tested — treat changes here carefully. **`addHandPart`/`undo` coalesce their sync into ONE write per tick** (`scheduleSync`, a microtask) — several flows add 2+ parts synchronously (pepper auto-bid, negotiate fold+tricks, clubs-forces-play); firing a transaction per part raced and dropped the later part. Do NOT reintroduce per-part syncing.
- **Turn gating (multiplayer):** `game.ts` `evaluateGating()` uses a **host-based** model — the game creator (`metadata.createdBy` → `FirebaseGameManager.isHost()`) may enter every tap-flow decision; the ONE exception is **trump**, which the bid winner enters for themselves. Non-host players get a waiting panel + an "Enter this myself" override; a host-offline presence fallback drops gating; signed-out/spectator devices are read-only. The concurrent auction (all four signed in) is per-seat and handled before gating by `auctionEligible()`/`renderAuction`.
- **RTDB `undefined` footgun (bit us more than once):** RTDB `set()` REJECTS objects containing `undefined` and fails the WHOLE write, and it DROPS empty objects/arrays (so they read back `undefined`). Always strip `undefined` before writing (e.g. `JSON.parse(JSON.stringify(x))` — done in profile save + game creation) and default empties on read (e.g. `normalizeAuction` restores `entries`/`order`, without which the auction UI froze).
- **Roadmap**: `development-plan.md` is the source of truth for phase status and remaining work. Firebase security rules are version-controlled in `database.rules.json` and **deployed** (2026-07-10) to project `pepper-scorer` — strict seated-player rules (game creation gated to `createdBy`; `gameState`/`bidding`/`presence` writable only by seated players; `metadata` immutable except `status`/`lastUpdated`/`seriesId`; `series`/`userGames` auth-gated). Edit `database.rules.json` and re-run `firebase deploy --only database` to change them. (The real project id is `pepper-scorer`; an early typo wrote `pepper-score` in `.env`/`.firebaserc` — both fixed.)
- **Firebase emulator tests**: `npm run test:emulator` (needs a real Java runtime; wraps `emulators:exec --only auth,database`) runs `tests/emulator/` — rules coverage via `@firebase/rules-unit-testing` plus an end-to-end concurrent-auction flow across 4 anonymously-authenticated clients (real per-seat transactions under the real rules). Kept OUT of the fast `npm run test:run`; runs in the CI `emulator` job. `src/pages/dev-auction.astro` is a dev-only visual harness for driving the auction against the local emulators. Emulator gotchas: the RTDB namespace is `<project>-default-rtdb` (a `?ns=` override splits namespaces), and `runTransaction` needs an active `onValue` listener or its optimistic first pass sees `null` and aborts.

### State Management
- Game state is managed through the `GameManager` class with immutable operations
- Persistent storage via `localStorage` with JSON serialization
- Support for both single games and multi-game series
- Complex undo system that handles different game phases appropriately

### Game Phases
The game follows a structured progression through phases:
1. **bidder**: Select who won the bid (or throw-in)
2. **bid**: Enter the bid value (4, 5, 6, Moon, Double Moon)  
3. **trump**: Select trump suit (or no-trump)
4. **decision**: Defending team decides to play or fold (with optional free tricks)
5. **tricks**: Enter number of tricks won by defending team

### Hand Encoding & Scoring Gotchas (read before touching scoring/stats/awards)
A completed hand is a 6-character string: `${dealer}${bidWinner}${bid}${trump}${decision}${tricks}`.
- `dealer`/`bidWinner`: `1`-`4` (`bidWinner` `0` = throw-in). `biddingTeam = (bidWinner - 1) % 2` → seats 1 & 3 are team 0, seats 2 & 4 are team 1.
- `bid`: `4`/`5`/`6`/`P`(pepper=4)/`M`(moon=7)/`D`(double moon=14). `decodeHand` returns numeric bids as **numbers**, and `P`/`M`/`D` as letters — don't `parseInt('P')` (it's `NaN`).
- `trump`: `C`/`D`/`S`/`H`/`N`(no-trump). `decision`: `P`(play)/`F`(fold).
- **`tricks` (last char) is the DEFENDING team's trick count, NOT the bidder's.** This is the single biggest source of bugs. `tricks === 0` means the defenders were shut out and the **bidder swept** (defenders go set) — it is a bidder success, not a bidder failure. Defenders "set the bidder" only when `tricks + tricksNeeded > 6` (`tricksNeeded` = 6 for 6/Moon/Double-Moon bids, else the bid value). The UI prompt "How many tricks did {defending team} win?" is the ground truth.
- A **fold** makes the bid for the bidding team; any trailing tricks digit is free points negotiated to the defenders. A fold is NOT a successful defense.

### fromJSON validation
`GameManager.fromJSON` **rejects a non-object payload** (throws) but **tolerates missing individual fields**, filling defaults for `hands`/`scores`/`players`/`teams` so a partial payload (e.g. restored from Firebase) still loads. This resolved an earlier `main`-vs-`firebase-integration` divergence (main previously validated strictly): when `firebase-integration` fast-forward-merged into `main` (2026-07-10), `main` adopted this permissive+guard behavior.

### Award System
Sophisticated award tracking that analyzes completed games/series to assign:
- **Team awards**: Defensive prowess, bidding specialization, comeback achievements
- **Player awards**: Individual performance metrics, clutch plays, specializations
- **Dubious awards**: Humorous recognition for poor strategic decisions
Awards are dynamically selected to ensure variety and relevance to game events.

## Build Commands
- `npm install` - Install dependencies
- `npm run dev` - Start dev server at localhost:4321 (DO NOT run this as dev server is always running)
- `npm run build` - Build production site to ./dist/
- `npm run preview` - Preview production build locally

## Code Quality Checks
- `npm run typecheck` (`tsc --noEmit`) - Check TypeScript types
- `npm run lint` (`eslint src/**/*.ts`) - Run ESLint checks on TypeScript files
- `npm run test:run` (`vitest run`) - Run the full unit + integration test suite once

## Testing
- **Framework**: Vitest (`vitest.config.ts`, node environment, `tests/setup.ts` mocks `window`/`getPath`).
- **Layout**: `tests/unit/` (GameManager, awards, statistics) and `tests/integration/` (full game/series/undo/persistence/awards flows).
- **`tests/helpers/gameActions.ts`**: a semantic layer (`setBidder`/`setBid`/`setTrump`/`setDecision`/`setTricks` + phase/accessor helpers) over the raw `addHandPart` encoding. Prefer these when writing integration tests.
- **CI**: `.github/workflows/test.yml` runs typecheck + lint + build + tests on every PR and on pushes to `main`. Keep it green.
- Tests drive `GameManager`/awards/stats directly; `game.ts` (DOM) and the Firebase layer are NOT covered by the suite.

## Pre-Commit Quality Assurance
Run these before committing to catch type errors, lint issues, and regressions:
```bash
npm run typecheck && npm run lint && npm run test:run
```

Common issues to watch for:
- Unused variables (disable ESLint warnings only when variable will be used later)
- Possible undefined values when accessing object properties or array indices  
- Missing type annotations for function parameters and return values

## LaTeX Commands (in rules directory)
- `pdflatex rules.tex` - Generate PDF from LaTeX
- `latexmk -pdf rules.tex` - Compile LaTeX with dependencies
- `pandoc -o rules.md rules.tex` - Convert LaTeX to Markdown

## Important Development Patterns

### Game State Management
- Always use `GameManager.fromJSON()` to restore game state from localStorage
- Call `updateUI()` after any state changes to keep interface synchronized
- Use `gameManager.undo()` for safe state rollback that handles all game phases
- State is encoded as compact string arrays for efficient storage and undo operations

### UI Updates and Event Handling  
- The `game.ts` file controls all UI updates through the main `updateUI()` function
- Button event handlers are set up once in `setupEventListeners()` and persist throughout gameplay
- Dynamic HTML is generated at runtime for victory celebrations and awards (Astro components can't be used post-build)
- Always call `hideAllControls()` before showing phase-specific controls

### Working with Awards and Statistics
- Award data is generated by `trackAwardData()` in statistics-util.ts
- Use `selectGameAwards()` and `selectSeriesAwards()` to pick relevant awards
- Award evaluation happens dynamically based on actual game performance
- Statistics HTML is generated server-side style but executed in the browser

### Pepper Round Logic
- First 4 hands of each game are "pepper rounds" with special bidding rules
- Use `isPepperRound(handIndex)` to check if special rules apply
- Pepper rounds have automatic bidding progression and forced play/fold decisions

## Code Style Guidelines
- **TypeScript**: Use strict typing with interfaces/types for all data structures
- **Imports**: Group external libraries first, then local modules with blank line separator  
- **Path Aliases**: Use `@/` for imports from src directory (configured in astro.config.mjs)
- **Naming**: camelCase for variables/functions, PascalCase for classes/interfaces/types
- **Error Handling**: Use null checks before accessing properties, especially for DOM elements
- **State Management**: Persist critical data in localStorage, pass transient state via props
- **Comments**: Add comments for complex game logic or non-obvious implementations

## Project Organization
- `/src/lib/` - Core application logic and utility functions
- `/src/components/` - Reusable Astro UI components  
- `/src/layouts/` - Page layout templates
- `/src/pages/` - Page routes (index.astro for setup, game.astro for gameplay)
- `/rules/` - Game rules documentation in LaTeX and generated Markdown

## Development Best Practices
- Remember to run tests often when making changes to the codebase.