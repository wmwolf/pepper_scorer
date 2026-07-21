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
- **firebaseGameState.ts**: `FirebaseGameManager extends GameManager`, overriding `addHandPart`/`undo`/`completeGame`/`convertToSeries`/`startNextGame` to sync to the Firebase Realtime Database with live listeners and series coordination. Large (~2000 lines). Emulator coverage under `tests/emulator/` is now substantial — `manager-flow` (sync/host/auction wiring), `unseated-host` (host claim + gating), `presence-devices` (per-device presence + player+host coexistence), `collision-safety`/`concurrent-writers` (concurrent writes), `five-user-game` (four players + one unseated host, end to end), `auction-flow`, `host-takeover` (host aborts a live auction), `host-promotion` (auto-promotion + blip guard), `undo-series-coordination` (undo lock + series-advance node), `series-advance` (Make-it-a-Series / Next Game DB effects + force-advance), `watch-mode` (anonymous spectator, no roster pollution), `invitation-flow`, `rules` (security rules) — but it still talks to the network, so treat changes carefully and run `npm run test:emulator`. **`addHandPart`/`undo` coalesce their sync into ONE write per tick** (`scheduleSync`, a microtask) — several flows add 2+ parts synchronously (pepper auto-bid, negotiate fold+tricks, clubs-forces-play); firing a transaction per part raced and dropped the later part. Do NOT reintroduce per-part syncing.
- **Turn gating (multiplayer):** `game.ts` `evaluateGating()` is **collision-safe / permissive** (rewritten 2026-07-19, Phase 12D). It decides ONLY read-only vs. can-write; it does NOT assign steps to seats. Any **seated player in player mode** OR the **host** may record ANY tap-flow step (bidder/bid/trump/decision/tricks) — there is no per-step ownership and no "trump exception" anymore. A device is read-only when signed-out, in **spectator mode** (the Phase 12B per-device role, even if seated), or signed-in-but-neither-seated-nor-host. The **host** is `metadata/currentHost` (claimable, need NOT be seated — see below), NOT `createdBy`. Concurrent writes are SAFE: `syncToFirebase`'s version compare-and-set lets exactly one win; the loser re-syncs and gets a benign TRANSIENT notice (`setSyncNoticeCallback`, "someone recorded that first"), distinct from the persistent error banner (permission/network). This safety is what lets gating be permissive — do NOT reintroduce hard per-seat/per-step blocks. The concurrent auction is still per-seat, handled before gating by `auctionEligible()`/`renderAuction`. **`renderAuction` is ROLE-AWARE (PR #10):** it keys participation on the DEVICE role (`getDeviceRole()`), not the seat — a seated account on a `spectator`/`host`-role device shows the read-only masked strip (no bid pad / trump selector), which closed a shared-display leak (the trump selector appeared on a bid, never on a pass). `auctionEligible()` additionally requires every seat to have a present `player`-role device (`allSeatsHavePlayerDevice()`, guarded on `hasPresenceData()`); when a seat can't bid it falls back to host tap entry rather than stalling. Manual-override also forces tap-flow entry (`auctionEligible` returns false when it's on).
- **Host role (Phase 12C):** `metadata/currentHost` names the one account administering the game — seeded to the creator at creation, claimable by any seated player or the creator via `claimHost()` (a transaction; takeover allowed, one at a time), released via `releaseHost()`. It may be **unseated** (a laptop scoring for four phones — the case the whole phase exists for), and the rules grant it write access accordingly. `isHost()` reads `currentHost`; `getCreatorUid()`/`createdBy` is the immutable "who may claim". A live listener on `currentHost` re-renders so a device that loses the role stops offering controls. **Presence is per-device (Phase 12B):** `presence/$uid/$deviceId → {mode,ts}`; `parsePresence` reads both this and the legacy `presence/$uid → true` shape. `seatHasPlayerDevice()`/`allSeatsHavePlayerDevice()`/`nextHostSeatInDealerOrder()` are now WIRED (they were placeholders): `allSeatsHavePlayerDevice()` gates `auctionEligible()`, and on host presence-loss `maybePromoteHost()`→`promoteSelfToHost()` auto-promotes the next present seated player in dealer order (takeover-safe transaction, ~3s debounce + re-check; adopt the role on the committed VALUE, not the `committed` flag — RTDB reports `committed:false` on a no-op-equal write).
- **Host takeover of a live auction (Phase 12E):** the host may declare the bidder mid-auction via `hostTakeoverBidder()`, which `abortAuction()`s (clears `bidding`) then writes the bidder part. `applyAuctionToHand` RE-READS the `bidding` node before applying, so a takeover is authoritative and the 2.8s reveal-delay race is closed. Do NOT restore the fire-and-forget apply.
- **Auction init must self-heal (post-launch fix, PR #15):** `renderAuction` retries a lost `ensureAuctionForCurrentHand()` write (guard cleared on failure + a ~2.5s timer). Do NOT make auction-node init fire-and-forget-without-retry again — a single lost write used to stick the auction on "Starting the auction…" forever (a real in-game failure).
- **Series advance OWNS its navigation (post-launch fix, PR #14):** the Firebase `startNextGame()` → `advanceSeriesAndNavigate()` navigates to the new game itself. The victory-button handlers must NOT also `window.location.reload()` for a Firebase game — doing so raced the navigation and looped back to the completed game ("Make it a Series did nothing"). `forceAdvanceSeries()` is a host failsafe that goes to the already-created next game instead of spawning a duplicate. Local games still mutate in place + reload.
- **Undo / series-advance gating (Phase 12, `game.ts` test seams `evaluateUndoPolicy`/`evaluateSeriesAdvancePolicy`):** host present ⇒ host-only; hostless ⇒ undo needs a confirm modal + one-at-a-time DB lock (`undoLock`, stale-12s/onDisconnect), series advance starts a shared ~5s cancelable countdown (`seriesAdvance` node). Both rule nodes are deployed.
- **Anonymous watch/TV mode (PR #13):** `ensureAnonymousAuth()` signs a signed-out device in anonymously so it can READ a shared `?id=` game (the `games` read rule needs `auth != null`); anon sessions get a minimal in-memory identity and write NO `/users` or `/directory` entry. `awaitAuthReady()` is awaited before load (closes the cold-load "seated player looks like a spectator" race). `shouldPersistLocalCopy()` gates `localStorage.currentGame` writes to participants/host only, so a pure spectator never overwrites the device's own resumable game. Watch mode needs the Anonymous sign-in provider enabled in the Firebase console — **enabled + confirmed working in prod (`pepper-scorer`) 2026-07-21**.
- **RTDB `undefined` footgun (bit us more than once):** RTDB `set()` REJECTS objects containing `undefined` and fails the WHOLE write, and it DROPS empty objects/arrays (so they read back `undefined`). Always strip `undefined` before writing (e.g. `JSON.parse(JSON.stringify(x))` — done in profile save + game creation) and default empties on read (e.g. `normalizeAuction` restores `entries`/`order`, without which the auction UI froze).
- **Security rules & emulator tests**: rules are version-controlled in `database.rules.json`, **deployed** to project `pepper-scorer`, and writable by seated players or the current host (see host-role note above). Emulator tests run via `npm run test:emulator` (needs Java; kept out of the fast `test:run`, runs in the CI `emulator` job). **Full detail — rules layout, the PII-safe user/directory split, deploy command, and emulator gotchas — is in `FIREBASE_NOTES.md`. Read it before touching rules or emulator setup.**
- **Roadmap**: `development-plan.md` is the source of truth for phase status and remaining work.

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
Analyzes completed games/series to assign three buckets — **team**, **player**, and tongue-in-cheek
**dubious** awards. Per-award definitions + eligibility logic (`evaluateAward`) live in
`pepper-awards.ts`. **Selection** (`selectGameAwards`/`selectSeriesAwards`) picks ONE award per bucket
by **weighted-random among the ELIGIBLE** ones (`AWARD_WEIGHTS` favors rarer/notable awards),
**seeded from the completed game's hands** (`rngFromHands`, `awardRng.ts`) so every synced device —
and every refresh — shows the SAME awards while different games vary. Do NOT reintroduce the old
"first-eligible-per-bucket, then break" walk — it structurally starved most awards.

## Commands
- `npm install` — install dependencies
- `npm run dev` — dev server at localhost:4321 (DO NOT run — the dev server is always running)
- `npm run build` / `npm run preview` — production build to ./dist/ and preview
- **Before committing, run all three:** `npm run typecheck && npm run lint && npm run test:run`
  (types via `tsc --noEmit`, ESLint on `src/**/*.ts`, full unit+integration suite via `vitest run`).
  Watch for: unused vars, possibly-undefined property/array access, missing type annotations.
- `npm run test:emulator` — Firebase rules/wiring tests (needs Java; see `FIREBASE_NOTES.md`).

## Testing
- **Framework**: Vitest (`vitest.config.ts`, node environment, `tests/setup.ts` mocks `window`/`getPath`).
- **Layout**: `tests/unit/` (GameManager, awards, statistics) and `tests/integration/` (full game/series/undo/persistence/awards flows).
- **`tests/helpers/gameActions.ts`**: a semantic layer (`setBidder`/`setBid`/`setTrump`/`setDecision`/`setTricks` + phase/accessor helpers) over the raw `addHandPart` encoding. Prefer these when writing integration tests.
- **CI**: `.github/workflows/test.yml` runs typecheck + lint + build + tests on every PR and on pushes to `main`. Keep it green.
- Tests drive `GameManager`/awards/stats directly; `game.ts` (DOM) and most of the Firebase layer are covered only by the emulator suite (`tests/emulator/`), not the fast unit suite.
- Game rules (LaTeX) build commands: see `rules/README.md`.

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
- Award data comes from `trackAwardData()` (single game) / `aggregateSeriesAwardData()` (series) in
  statistics-util.ts.
- `selectGameAwards(data, rng?)` / `selectSeriesAwards(data, rng?)` pick the displayed awards. `rng`
  defaults to `Math.random`, but production passes `rngFromHands(data.hands)` (portable seed) and
  tests pass `seededRng(n)` for determinism.
- **Test award LOGIC via the exported `evaluateAward(def, data)`** (deterministic) — NOT by asserting
  what `selectGameAwards` returns (that's now random). Coverage: canned per-award trigger tests +
  `award-selection-stats.test.ts` (seeded statistical regression over a realistic game sim in
  `tests/helpers/randomGames.ts`).
- **Gotchas:** (1) an award's `case` in `evaluateAward` MUST live in the switch matching its `type`
  (`team` vs `player`) or it's unreachable (this was the `gambling_problem`/`punching_bag` bug).
  (2) "Dubious" awards are identified by id sets (`GAME_DUBIOUS_IDS`/`SERIES_DUBIOUS_IDS`); `game.ts`
  keeps a parallel list for amber card styling — keep them in sync. (3) A fold that negotiated
  tricks counts as a SUCCESSFUL defense (matches the award definition). (4) Icons are emoji mapped by
  name in `game.ts`'s `iconMap`.
- Statistics HTML is generated server-side style but executed in the browser.
- Debug/preview a completed game's award cards: on `/game`, `importGame({players,teams,hands})`
  (console) or set `localStorage.debugGame` — a completed hand-set shows the victory cards; awards
  are deterministic per hands.

### Pepper Round Logic
- First 4 hands of each game are "pepper rounds" with special bidding rules
- Use `isPepperRound(handIndex)` to check if special rules apply
- Pepper rounds have automatic bidding progression and forced play/fold decisions

## Code Style
- Match the surrounding code. Path alias `@/` maps to `src/` (astro.config.mjs). camelCase for
  values, PascalCase for types/classes. Null-check DOM lookups. Run tests often.