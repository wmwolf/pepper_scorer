# Development Plan for Pepper Scorer

## Project Overview
Modernizing the Pepper card game scoring application by moving from Bootstrap 4 and CoffeeScript to Astro and Tailwind CSS, while adding Firebase integration for real-time multiplayer features, user authentication, and comprehensive statistics tracking.

## Current status (2026-07-11)
The `firebase-integration` branch was **merged into `main`** (Firebase is now on the mainline; that
branch is deleted). Live at https://billwolf.space/pepper_scorer/ via GitHub Pages.

- **Phases 1–8: done.** Core scoring, series, stats/awards, Firebase auth, schema/migration,
  real-time sync, and the mobile bidding interface (Phase 8) — including the **concurrent-entry
  auction** (8b redesign), **host-based turn gating** (bid winner picks their own trump), the
  reveal pause + bogus-bid demotion, and numerous multiplayer bug fixes flushed out by real
  4-device testing (sync coalescing, RTDB-`undefined` writes, empty-`entries` auction freeze).
- **Phase 11 security: done.** Strict rules version-controlled in `database.rules.json` and
  **deployed**; emulator harness green in CI (rules + wiring, incl. a 4-client auction flow).
- **Mobile auth: DONE.** iOS Safari broke `signInWithPopup`/`Redirect` (cross-origin authDomain +
  ITP); fixed with **Google Identity Services** (`signInWithCredential`), **confirmed working on a
  stock iPhone**. The old redirect/popup fallback was excised (popup kept only for `dev:emulator`).
- **Privacy hardening (2026-07-11): DONE.** `/users` was world-readable and the roster search
  downloaded the whole table → anyone could mine emails. Split into an owner-only `/users` (email,
  stats) and a PII-free, auth-gated `/directory` (username/displayName/photo) that search reads;
  usernames no longer derive from the email local part. Rules redeployed.
- **Award system overhaul (2026-07-11): DONE.** Selection was starving most awards (first-eligible-
  per-bucket); redesigned to pick one team/player/dubious award **at random, weighted toward rarer
  ones, among the eligible**, seeded from the game's hands so every device shows the same awards.
  Fixed a genuinely unreachable award (`gambling_problem`→`punching_bag`, wrong switch) and a
  defensive-scoring bug (negotiated folds now count as successful defenses, per the award
  definition). Added team awards (`dynamic_duo`, `great_minds`, `misery_loves_company`,
  `brick_wall`) and series awards (`moonshot`, `big_talker`, `cut_to_the_quick`); tuned thresholds.
  `evaluateAward` is exported; a seeded statistical + a realistic game-sim regression suite guards
  distributions. **Award-PREVALENCE tuning is considered sufficient** (further tuning waits on real
  data); the new award *cards* still want a quick live visual check.
- **Not started:** Phase 9 (user management & game discovery — but note much scaffolding already
  exists: auth/profiles, username autocomplete, active-games list, room codes; the real remaining
  work is the **game invitation system** + discovery/dashboard polish). Phase 10 (advanced stats/
  history) — **aggregating real player stats from cloud game data is still in scope** (gated on
  having a corpus of played games; award-prevalence *sims* are done). Phase 11 production polish
  (PWA/offline, monitoring, backup). Remaining Phase-8 follow-ups: real multi-device auction QA at
  scale and the deferred mixed-phone/non-phone auction mode.

The detailed per-phase notes below are the historical decision trail; the summary above is the
current state of record.

## Completed Phases ✅

### Phase 1: Project Setup and Core Components ✅
1. Set up Astro project with Tailwind CSS ✅
2. Create basic layout components ✅
   - Header/footer with navbar
   - Main layout structure
   - Rules modal with responsive design
3. Implement core game state management ✅
   - Game state encoding system (6-character string format)
   - State management utilities
   - Basic game flow control

### Phase 2: Game Setup and Basic Gameplay ✅
1. Create setup flow components ✅
   - Player name input
   - Team name input
   - Game type selection (single game vs series)
2. Implement main game interface ✅
   - Score display with responsive layout
   - Action area with game controls
   - Running score log with history toggle
3. Add basic game logic ✅
   - Bidding system with pepper round support
   - Score calculation and validation
   - Hand completion and victory detection

### Phase 3: Enhanced Navigation and Series Play ✅
1. Implement enhanced undo functionality ✅
   - State traversal system
   - Phase-aware undo logic
   - UI integration
2. Add series play support ✅
   - Series state management
   - Multiple game tracking
   - Dealer rotation
   - Series statistics and awards

### Phase 4: Statistics and Awards System ✅
1. Implement comprehensive statistics ✅
   - Player performance analysis
   - Team statistics
   - Bid history and success rates
2. Advanced award system ✅
   - 23+ different game and series awards
   - Dynamic award selection algorithms
   - Award visualization in victory celebrations
3. Victory celebrations with confetti and animations ✅

## Current Phase: Firebase Integration 🔥

**Phases 5, 6 & 7 Complete!** Authentication, infrastructure, and version-based
real-time sync are working. Ready for Phase 8 (mobile bidding interface).

### Status update (since Phase 5)
`main` has been merged into `firebase-integration`, bringing in a body of core-logic
hardening done on `main`:
- A real, passing test suite (Vitest: `tests/unit/` + `tests/integration/` + `tests/helpers/gameActions.ts`) and CI (`.github/workflows/test.yml`) — 240 tests green. The old `tests/integration/` files (which tested an API that never shipped) were rewritten against the real `GameManager`.
- Correctness fixes to scoring/undo/awards/stats (inverted defensive-set stat, an undo score-desync, a Pepper-bid `NaN`, an MVP award naming the biggest loser, a fold miscounted as a successful defense, etc.).
- Guards: `startNextGame()` now refuses to abandon an in-progress game; `GameManager` restructured its `undo()` to recompute scores from the hands.

Two things to carry forward:
- **`fromJSON` diverges by branch**: `main` validates strictly (throws on missing fields); this branch fills defaults permissively for partial Firestore payloads. Pick one when this branch merges back to `main`.
- **Known bug (Phase 6): FIXED.** Manual sync reverting newer→older state is resolved by version-based transactional sync (see Phase 6 completion note below). The rest of the Firebase layer (`firebaseGameState.ts`, `auth.ts`) still has **no automated tests** and is verified manually — but the pure conflict-resolution decision now has unit coverage (`tests/unit/firebase-sync.test.ts`). When adding a new field to `GameState` that must sync, remember it flows through the transaction untouched; the new `version` field is managed exclusively by `FirebaseGameManager` and defaults to 0.

### Session planning guidance (how to batch the remaining phases)
The remaining phases need very different context loaded, so batch them by the subsystem
and mental model they share rather than doing them in strict numeric order:

- **Phases 6 + 7 — one session (do first).** Both live in the real-time sync internals
  (`firebaseGameState.ts`, the RTDB schema, transactions, listeners). Migration (6) and
  live multi-device sync (7) touch the same code and data model, and the "manual sync
  reverts newer→older" bug must be fixed here before anything downstream is trustworthy.
  This session is read-heavy (`firebaseGameState.ts` is ~1200 lines) — start it fresh
  with a full context budget.
- **Phase 8 — its own session, immediately after 6/7.** Mobile bidding depends on a solid
  sync layer but adds a large, distinct surface (new mobile UI components + a turn-based
  bidding state machine). Same infra as 6/7, but enough new UI/interaction that it wants
  its own budget.
- **Phase 9 — its own session.** User management & game discovery (dashboards, room codes,
  invitations) is a distinct feature/UX area with its own queries; little overlap with the
  sync internals.
- **Phase 10 — its own session, and relatively independent.** Advanced stats/history extends
  the existing `statistics-util.ts`/`pepper-awards.ts` layer plus per-user persistence. It
  doesn't depend much on 8/9 and could be slotted whenever a stats-focused session fits.
- **Phase 11 — split it.** The **security rules are urgent and standalone**: the original
  Firebase "test mode" rules expired (they are time-limited) and flipped the DB to deny-all;
  it is currently **temporarily** re-opened (`.read`/`.write: true`) for dev testing of the
  sync layer. Write and deploy `database.rules.json` (rules drafted below) *before* exposing
  multiplayer to real users — and to re-close the currently-open DB. This is a quick task
  that does not need to wait for 6–10. The rest of Phase 11 (PWA, offline, monitoring) is
  launch-hardening for its own late session.

Dependency order: **6 → 7 → 8**; **9**, **10**, and **Phase 11 security rules** are largely
independent and can be scheduled around the critical path.

### Phase 5: Firebase Foundation & Authentication ✅
**Status: Complete - Safari/DuckDuckGo authentication issues resolved**

#### Manual Firebase Setup Complete:
1. **Firebase Project Created** ✅ - Project configured at console.firebase.google.com
2. **Services Enabled** ✅:
   - Realtime Database (was "test mode"; those time-limited rules have since expired — see Phase 11 / current-status note above)
   - Authentication with Google sign-in provider
3. **Configuration Complete** ✅ - Environment variables configured
4. **Authorized Domains** ⚠️ - `localhost` is authorized (default). NOTE (corrected 2026-07-10):
   `billwolf.space` was NOT actually in Firebase Auth → Settings → Authorized domains despite an
   earlier claim here — production Google sign-in failed with "The requested action is invalid" /
   `auth/popup-blocked` until it was added. Add any new serving domain there (Console-only step).

#### Code Implementation Complete:
1. **Firebase SDK Integration** ✅ - Dependencies installed and configured
2. **Configuration Infrastructure** ✅ - Environment-based setup with fallbacks
3. **Authentication System** ✅ - Simple popup authentication working across all browsers
4. **Database Schema Design** ✅ - Complete schema for users, games, and real-time sync
5. **Testing Interface** ✅ - Authentication UI added and verified working
6. **User Lookup System** ✅ - Username autocomplete for game setup

#### Critical Authentication Fixes Applied:
- ✅ **Simple popup-only authentication** - Reverted from complex redirect system
- ✅ **Cross-browser compatibility** - Works in Chrome, Safari, DuckDuckGo
- ✅ **Base path configuration** - Development uses root path, production uses /pepper_scorer
- ✅ **Domain configuration** - Proper Firebase authorized domains setup

#### Verified Working Features:
- ✅ Firebase initialization and configuration
- ✅ Google authentication (sign in/sign out) in all browsers
- ✅ User profile creation and management
- ✅ Real-time authentication state management
- ✅ User search and autocomplete in game setup
- ✅ Backward compatibility with localStorage
- ✅ "Continue without signing in" fallback option

#### All Known Issues Resolved ✅:
- ✅ **Login UI State**: Login button now shows proper loading states during authentication process
- ✅ **Account Page Loading**: Eliminated jarring flash of "authentication required" message with smooth loading state
- ✅ **Display Name Persistence**: Custom display names now persist properly and don't revert to Google data on page refresh

### Phase 6: Database Schema & Core Data Migration ✅
**Goal**: Replace localStorage with Firebase, maintain backward compatibility, implement robust real-time synchronization

#### Critical Real-time Sync Improvements:
- **Firebase Transactions** ✅: `syncToFirebase()` now writes via `runTransaction()` on `games/{id}/gameState` (with `applyLocally: false`) instead of a blind `set()`.
- **Conflict Resolution** ✅: A monotonic `version` counter (`GameState.version`) orders writes. The transaction refuses to overwrite a strictly-newer remote state and instead pulls it in. Decision logic is the pure static `FirebaseGameManager.resolveSyncWrite()` / `isRemoteNewer()` / `versionOf()`.
- **State Consistency** ✅: The read path (`applyRemoteState()`, used by every listener) adopts remote state **iff** its version is strictly greater than ours — this replaced the fragile wall-clock "skip our own update within 1s" heuristic (`lastSyncTime` removed), so echoes and stale updates can no longer race.
- **Manual Sync Fix** ✅: `forceSyncToFirebase()` routes through the same version-guarded transaction, so the "Sync Now" button can never revert newer state to older.

**Implementation notes / gotchas:**
- `version` starts at 0 on creation (both create paths + `loadFirebaseGame`) and is bumped on every committed write. `versionOf()` treats a missing version as 0, so pre-version legacy games (none expected pre-launch) degrade to last-writer-wins rather than erroring.
- Base `startNextGame()` rebuilds `this.state` without a version; the Firebase fallback paths that re-use the same game node re-seed `this.state.version` before syncing so the fresh game supersedes the completed game still on the node (otherwise the guard would "revert" it). The series path writes to a brand-new node, so no re-seed is needed there.
- `undo()` is a forward version bump (not a revert): `super.undo()` mutates state in place, then the sync commits a higher version that propagates the undo to other devices.
- Unit coverage: `tests/unit/firebase-sync.test.ts` (9 tests) locks in the conflict-resolution decision.

#### Database Structure:
```
users/{userId}/
  username: string (unique)
  displayName: string
  stats: {
    wins: number,
    losses: number,
    totalGames: number,
    bidStats: {
      totalBids: number,
      successfulBids: number,
      bidsByValue: { 4: {attempts, successes}, 5: {...}, etc }
      bidsBySuit: { C: {attempts, successes}, D: {...}, etc }
    },
    defensiveStats: {
      timesStayed: number,
      timesSet: number,
      timesSetOpponent: number,
      timesNegotiated: number
    },
    partnerStats: { [partnerId]: gamesPlayed }
  }

games/{gameId}/
  metadata: {
    createdBy: userId,
    createdAt: timestamp,
    status: 'setup' | 'active' | 'completed',
    roomCode?: string (for spectators)
  }
  players: [{ userId?, displayName, isAuthenticated, position }]
  teams: [string, string]
  gameState: {
    hands: string[],
    scores: [number, number],
    isComplete: boolean,
    seriesScores?: [number, number],
    etc.
  }
  bidding?: {
    active: boolean,
    dealerIndex: number,
    currentBidder: number,
    bids: { [playerIndex]: { value, suit?, revealed } },
    phase: 'bidding' | 'trump' | 'decision'
  }

userGames/{userId}/{gameId}: true  // Quick lookup for active games
```

### Phase 7: Real-time Game Synchronization ✅
**Goal**: Multiple devices stay in sync during manual play

#### Features:
- **Game state listeners for live score updates** ✅: `setupFirebaseListeners()` subscribes to `games/{id}/gameState` and funnels every snapshot through `applyRemoteState()`.
- **Automatic UI refresh when host updates scores** ✅: the manager's `uiUpdateCallback` (wired in `game.astro`) calls `window.updateUI()` whenever a newer remote state is adopted.
- **Connection status indicators** ✅: `monitorConnection()` subscribes to Firebase's special `.info/connected` ref and drives the connection banner (connected / connecting / offline). `getOnlineStatus()` exposes the latest value.
- **Graceful handling of network interruptions** ✅: while offline, Firebase queues writes and flushes them on reconnect; the connection banner reflects offline state.
- **Fallback to localStorage when offline** ✅: `applyRemoteState()` and `updateUI()` persist to `localStorage.currentGame` on every change, and the game page falls back to the local copy when the cloud is unconfigured/unreachable.

**Also fixed here:** `game.astro` previously loaded the `FirebaseGameManager` twice (URL-`?id=` path + `setupFirebaseSync`), leaking a full listener set and running two managers for one game. It now loads once and reuses the instance; `beforeunload` calls `firebaseGame.destroy()` (was calling a never-defined `window.firebaseUnsubscribe`) to tear down all listeners including the connection monitor.

**Still TODO for a later hardening pass:** richer reconnect UX (e.g. surfacing queued-write count), and automated coverage of the DOM/listener wiring (currently manual).

### Phase 8: Mobile Bidding Interface ✅ (8a + 8b implemented; needs real-device QA)
**Goal**: Players can bid via their phones

**Status (2026-07-10, updated):** 8a foundation (identity, turn-gating, presence + manual
fallback, room codes) and the 8b auction are implemented and CI-green. The 8b auction was
**redesigned** from the sequential pass + pre-commit model to **concurrent entry + dealer-prefix
reveal** (see "8b redesign spec" below) — that concurrent model is what now ships. Verified via
the pure engine tests and a jsdom test that drives the real `renderAuction` + wiring over the real
engine. Remaining before launch:
- **Real multi-device QA**: the flows were exercised via simulation/jsdom (headless Google sign-in
  isn't possible here). Needs a manual pass with 4 signed-in devices against live Firebase.
- **The Firebase auction wiring (`firebaseGameState.ts`) is not covered by CI** — only the pure
  `auction.ts` engine (19 tests) and the DOM render (`auction-ui.test.ts`, 7 tests) are. The
  Phase 11 emulator harness is scaffolded to cover the wiring (orchestration tests still TODO —
  see Phase 11 status).
- **Mid-auction stall**: the auction requires all four seats *authenticated*. In the concurrent
  model there is no turn pointer, but a seat that never enters a bid **stalls completion**; the
  **manual-override** escape hatch is the current remedy (and ties into the deferred mixed-device
  feature). Auto-abort-to-manual is a possible refinement.
- Security rules (Phase 11) now cover the `presence`/`bidding` nodes, the `metadata/roomCode`
  index, and seated-player `.write` — **written** in `database.rules.json`; see the Phase 11 status.

#### 8b redesign spec (2026-07-10 — ✅ IMPLEMENTED, CI-green, jsdom-verified)
**Status:** Built. `auction.ts` is now the concurrent-entry engine below; the Firebase wiring
(`firebaseGameState.ts`: `enterBid`/`setTrump`/`maybeApplyAuction`) and the auction UI
(`game.ts`: `renderAuction`/`wireAuctionButtons`) were rewritten to match. The old sequential-turn
model (commits 8b-1…8b-4) and the trump-as-part-of-bid change (`cfff20c`) are **superseded**.
Coverage: `tests/unit/auction.test.ts` (19, pure engine) + `tests/unit/auction-ui.test.ts` (7,
jsdom drives the real `renderAuction` + wiring over the real engine — the DOM path was previously
manual-only). Still needs real multi-device QA against live Firebase (headless sign-in impossible
here). Mixed phone/non-phone players remains DEFERRED (see that section).

The spec that was built (kept for reference):
A rewrite of `auction.ts` + the Firebase auction wiring + the auction UI — **not** a tweak. It
**supersedes the sequential-turn auction** (commits 8b-1…8b-4) and the trump-as-part-of-bid
change (`cfff20c`). The current sequential-turn model must be consciously discarded.

- **Concurrent entry.** After the deal, *all four* players may enter a bid at any time, in any
  order. There is **no turn-gating on entry** — drop the "currentBidderSeat / it's your turn"
  pointer entirely. A player enters a bid value (4/5/6/M/D) or Pass.
- **Reveal = dealer-order prefix.** Order is dealer's-left first, clockwise, dealer last. A bid
  is revealed to all once it has been entered AND every player *ahead* of it in that order is
  already revealed — i.e. reveal the maximal prefix in which everyone has entered. Entering the
  first still-missing player can cascade-reveal several already-entered later players at once.
- **Hidden until revealed** — from everyone, *including the author* (shows only "bid logged"
  on-device; phones may be face-up on the table).
- **Edit bid; lock trigger = the *next* player's reveal.** An "Edit bid" button reopens the menu
  (never showing the current value) to change/re-enter the bid. A bid stays editable until the
  player who bids *after* them (successor in dealer order) has their bid **revealed**. Rationale
  (user): mirrors oral bidding — freely fix a genuine misspeak ("4, er, 6"), but once the next
  player's bid is on the table, changing yours would be abusing that knowledge, so you lock at
  that moment. **This intentionally means a bid can stay editable for a window *after* it is
  already revealed to the table** (you reveal at your slot; you lock when your successor
  reveals) — that's the audible-correction case, and it's wanted. Edge case: the last player
  (dealer) has no successor → lock on auction completion (their own reveal).
- **Resolution.** At/after reveal, a revealed bid whose value is ≤ the current revealed high
  becomes a Pass (auto-pass); equal bids go to the earlier seat. Because a revealed bid may still
  be edited until its successor reveals, resolution is provisional until locks settle.
- **Trump, decoupled + masked.** Entering a *non-pass* bid immediately shows a trump menu — it
  does **not** block the bid (already entered) or anyone else. The menu stays until the player
  picks a trump OR is revealed to be outbid, whichever first. After picking, a masked **"Edit
  trump"** button allows changes until they are revealed as the winner (or outbid); it never
  displays the current trump. A Pass has no trump. A winner who never picked keeps the trump menu
  until they do — this replaces the separate gated trump phase *for auction hands*.
- **Completion → hand.** Once all four are revealed and resolved and the winner has a trump, feed
  winner + winning bid + trump into the hand encoding (bidder+bid+trump → decision phase); a
  throw-in if all passed. If the winner hasn't picked trump yet, the hand waits on their pick.
- **Unchanged:** pepper rounds bypass the auction (auto-bid); 8a turn-gating still drives
  decision/tricks. A seat that never enters a bid **stalls** the auction → ties into the
  mixed-device / presence feature below (a central device may need to enter for absent seats).

#### Requested feature: mixed phone / non-phone players (2026-07-10 — NOT built)
Today the auction is all-or-nothing: it activates only when **all four seats are
authenticated**; otherwise it falls back to the single-device tap flow (or manual override).
Desired: a **mix** — some players on their phones, others' bids entered on a **central device**
because they're calling them out verbally. Clean path: make eligibility **per-seat via
presence** — a seat whose player is present on their own phone acts for themselves; a seat with
nobody present can be driven by a central/host device. Reuses the 8a presence system; needs the
turn-gating and auction UI to support "act on behalf of an absent seat." Moderate scope; own
design pass.

#### Chosen bidding model (decided 2026-07-09): hybrid sequential auction with optimistic pre-commit
> ⚠️ **SUPERSEDED (2026-07-10) by the concurrent-entry 8b redesign above.** This sequential
> model was fully discarded and replaced; the text below is retained only as historical context
> for the decision trail. The shipped model is concurrent entry + dealer-prefix reveal.

The **live sequential ascending auction is the source of truth** (start left of the dealer,
each player bids higher or passes, auction ends when three pass; pepper rounds auto-bid 4 for
the player left of the dealer). On top of that sits an **optimistic pre-commit layer**:
- A player may lock in a bid **out of turn** (most often a pass) so they can step away. Their
  screen then shows only "bid logged" — the value/suit are hidden so a phone left in view
  doesn't leak them. The pre-commit stays **editable until the auction pointer passes that seat**.
- Alternatively a player may **wait** and bid in sequence; the bid screen indicates whose turn
  it currently is, with a directional arrow to that seat **relative to the viewer** (partner =
  across, opponents = left/right).
- **Pre-bid resolution rule (precise):** when the pointer reaches a seat with a pre-committed
  bid, it **auto-passes if the pre-set bid is equal to or lower than any prior bid** (bids must
  be strictly higher); otherwise it enters as the pre-set bid. A pass pre-commit always applies.
  (We cannot reliably re-prompt an absent player, hence auto-pass rather than re-ask.)
- **Trump is chosen as part of the bid.** Placing a bid (in turn or as a pre-bid) is a two-tap
  action: pick the bid value, then pick trump; picking the suit is what submits it. There is
  **no "decide trump later"** option — it was removed as redundant (if you're outbid the choice
  is discarded anyway; if you win you'd have to pick trump regardless). Pass submits immediately
  with no trump. Because the winner therefore always has trump attached, the win is announced
  *with* trump and the auction hands straight to the defenders' decision — the separate gated
  trump phase never fires for auction hands (it remains only for **pepper rounds**, which don't
  use the auction). The bid + suit stay hidden until revealed in sequence.
- After trump is known, the defending team gets the play/fold/negotiate decision (8a gating).

#### Session sequencing (decided 2026-07-09): foundation first, then the auction
- **8a — foundation (model-agnostic), build + commit incrementally:**
  1. In-game player identity: resolve signed-in user → seat via `games/{id}/players[].userId`;
     spectator if not a participant. Surface "You are {name} (Seat N, {team})".
  2. Turn-gating framework + waiting states, applied first to the phases that map cleanly to a
     real player and survive the auction rework: **trump → bid winner**, **decision → defending
     team**, **tricks → bidder/scorekeeper**. `bidder`/`bid` stay open to all participants until
     8b replaces them with the auction. Spectators are always read-only.
  3. Presence tracking (`games/{id}/presence/{uid}` via `onDisconnect`) + a "play this manually"
     override when the responsible player is offline → automatic fallback to manual mode.
  4. Room-code display (shareable) + join-by-room-code (`findGameByRoomCode`, needs an
     `.indexOn` on `metadata/roomCode` — fold into Phase 11 rules).
- **8b — the hybrid auction itself**, writing/consuming the `bidding` sub-tree declared on
  `FirebaseGameData` (currently an empty scaffold), integrated into the 8a turn-gating framework
  and feeding the resulting `bidWinner`+`bid` into the existing hand encoding.

#### Mobile UI Components:
- Responsive bid selection interface
- Trump selection with suit symbols
- "Waiting for your turn" states (with relative-seat directional indicator)
- Real-time connection status
- Game viewer mode for non-participants

### Phase 9: User Management & Game Discovery ✅ (done)
**Goal**: User accounts, game ownership, active game management

#### Features:
- User registration and profile management ✅
- Active games dashboard ✅
- Username autocomplete in game setup ✅
- Room code generation for spectators ✅
- Game invitation system ✅ (consent-layer model; `src/lib/invitations.ts`, emulator-tested)

### Phase 10: Advanced Statistics & Historical Analysis
**Goal**: Comprehensive long-term stat tracking

#### Statistics Features:
- Per-hand outcome categorization
- Partner compatibility analysis
- Bidding pattern analysis
- Performance trends over time
- Comparative statistics (vs. other players)

#### Game Management:
- Historical game browser
- Game replay functionality
- Export game data
- Stats recalculation system (for "edit last tricks")

### Phase 11: Security & Production Features
**Goal**: Secure, scalable deployment ready for public use

#### Status (2026-07-10): security rules DEPLOYED + emulator harness RUNNING GREEN ✅
- ✅ **`database.rules.json` written** (repo root) — coarse, node-level grants. `/users` public
  read + self-write; `/games` readable by any authed user (room-code spectators) with
  `.indexOn: ["metadata/roomCode"]`; game **creation** gated to `createdBy === auth.uid`;
  `gameState`/`bidding` writable by any **seated** player (4-way `players/N/userId` check);
  `metadata/status`/`lastUpdated`/`seriesId` writable by seated players while `createdBy` (and the
  rest of metadata) stays immutable; `presence/$uid` self-write; top-level `series` auth-gated;
  `userGames` self-managed, with the creator allowed to seed other players' lists.
- ✅ **Emulator harness built & PASSING (13 tests)**: `firebase.json` + `.firebaserc`, an auth+DB
  test seam in `src/lib/firebase.ts` (`connectAuthEmulator`/`connectDatabaseEmulator` when
  `PUBLIC_FIREBASE_EMULATOR === 'true'`), a separate `vitest.emulator.config.ts` (jsdom), the
  `test:emulator` script (`emulators:exec --only auth,database`), and a dedicated CI `emulator`
  job (Temurin + firebase-tools). Kept OUT of the fast `npm run test:run`. Tests:
  - `tests/emulator/rules.test.ts` (9) — every grant via `@firebase/rules-unit-testing`.
  - `tests/emulator/auction-flow.test.ts` (4) — **end-to-end concurrent auction across FOUR
    anonymously-authenticated clients** (one Firebase app each), driving real per-seat RTDB
    transactions through the real `auction.ts` engine under the real rules: ascending resolve,
    winner-sets-trump-after-complete, throw-in, and non-seated-write-denied. This is the "4 device"
    coverage — proven headlessly. **Ran green locally once Temurin was installed.**
- ✅ **Manual visual harness**: `src/pages/dev-auction.astro` renders the REAL seat-1 auction UI
  and drives seats 2–4 as their own authed users against the emulators — open it in a local
  browser (`firebase emulators:start --only auth,database --project demo-pepper` + `npm run dev`,
  then `/dev-auction`). Dev-only; connects to localhost emulators (harmless in a prod build).
- ⚠️ **Emulator gotchas (learned)**: RTDB emulator namespace is `<project>-default-rtdb` — a client
  `databaseURL` of `...?ns=demo-pepper` silently splits namespaces; use the host form
  `https://demo-pepper-default-rtdb.firebaseio.com`. And `runTransaction` needs an **active
  `onValue` listener** (not a bare `get()`) or its optimistic first pass sees `null` and aborts —
  exactly why `FirebaseGameManager` keeps a listener.
- ✅ **Rules DEPLOYED (2026-07-10)** via `firebase deploy --only database` to project
  `pepper-scorer`. The interim `auth != null` console rules are now replaced by the strict
  seated-player rules; the DB is locked down. (Gotcha found during deploy: `.env`'s
  `PUBLIC_FIREBASE_PROJECT_ID` and the initial `.firebaserc` said `pepper-score` — a typo missing
  the trailing "r"; the real project is `pepper-scorer`, as `AUTH_DOMAIN`/`DATABASE_URL` always
  had. Both fixed.)
- ⏳ **REMAINING (optional)**: tests that drive the `FirebaseGameManager` **class methods**
  specifically (version monotonicity / two-manager convergence via the class, not just the auction
  node). `tests/unit/firebase-sync.test.ts` covers the pure conflict-resolution decision; the
  auction wiring is now covered end-to-end by `auction-flow.test.ts`.

#### Security Implementation (original draft — now realized in `database.rules.json`):
```javascript
// Firebase Security Rules
{
  "rules": {
    "users": {
      "$userId": {
        ".read": true,  // Public read for username lookup
        ".write": "$userId === auth.uid"  // Users can only edit their own data
      }
    },
    "games": {
      "$gameId": {
        ".read": "auth != null && (data.child('players').val().hasChild(auth.uid) || query.orderByChild('roomCode').equalTo($gameId).exists())",
        ".write": "auth != null && data.child('metadata/createdBy').val() === auth.uid"
      }
    }
  }
}
```

**Phase 8 additions the rules must account for (added while building 8a):**
- **`games` needs `".indexOn": ["metadata/roomCode"]`.** `FirebaseGameManager.findGameByRoomCode`
  queries `/games` ordered by `metadata/roomCode`; without the index Firebase downloads all
  of `/games` and logs a warning.
- **New per-game child nodes**: `games/{id}/presence/{uid}` (online tracking, written by each
  present player via `onDisconnect`) and `games/{id}/bidding` (the 8b auction sub-tree). Both
  need to be writable by any *seated* player, not just `metadata/createdBy`.
- **The `.write` rule above is too strict for multiplayer**: turn-based bidding and per-seat
  scoring require every seated player to write `gameState`/`bidding`/`presence`, so the rule
  must widen from "creator only" to "any authenticated user listed in `players`" (while still
  protecting `metadata`). Reconcile this when writing `database.rules.json`.

#### Production Features:
- **Progressive Web App + offline: DONE (2026-07-12, implemented & browser-verified; not yet
  deployed).** Static `public/manifest.webmanifest` using **relative** URLs so `scope`/`start_url`/
  icons resolve correctly under both dev (`/`) and the Pages sub-path (`/pepper_scorer/`) with no
  build-time templating. Icons in `public/icons/` (192/512 `any maskable` + apple-touch + svg),
  generated from `public/icons/icon.svg` (four-suit design). Service worker `public/sw.js`
  **self-derives BASE** from `self.location.pathname` (so scope is correct on both), uses a
  **versioned cache** (`pepper-v1`), and is deliberately **network-first for navigations** (does
  NOT worsen the known GH-Pages index.html CDN staleness — online always gets fresh HTML),
  **cache-first only for immutable `_astro/*`**, SWR for other static, and **passthrough for
  cross-origin** (Firebase/GIS never intercepted). Precache + an `activate`-time `warmCache()`
  (fetches the app pages and precaches their hashed CSS/JS) so the FIRST offline load renders fully
  styled. **Kill-switch documented in `sw.js`** (self-unregister + cache purge) and reachable
  because registration uses `updateViaCache: 'none'`. Registration (`src/lib/register-sw.ts`) is
  **PROD-gated** (never registers under `astro dev` — test via `astro build` + `astro preview`).
  Verified: SW scope correct, manifest loads, precache+warm populate, and with the server killed the
  app reloads fully styled offline. **Treat the first prod deploy as a watched rollout.**
- **Error monitoring: DONE (scaffolded, no-op until configured).** `src/lib/monitoring.ts` gates
  entirely on `PUBLIC_SENTRY_DSN` — when unset the Sentry SDK is never imported (Vite dead-code-
  eliminates the branch, so ZERO bytes ship); when set it dynamic-imports `@sentry/browser`, inits
  error-only capture (+ `captureConsoleIntegration` for `console.error`, no tracing/replay).
  `PUBLIC_SENTRY_DSN`/`PUBLIC_SENTRY_RELEASE` added to `.env.example` and the Pages workflow (release
  = `github.sha`). **TODO (user): create a Sentry project, add `PUBLIC_SENTRY_DSN` as a repo secret.**
- **Data backup/export: DONE (2026-07-12).** Account page "Backup & Export" card:
  `exportUserData` (read-only over `userGames`/`games`/`users` — no rules change) downloads a JSON
  backup of all games + profile; import parses/validates a backup, previews the games, and can
  restore one to THIS device (localStorage, local-only — never writes to the cloud). Logic in
  `src/lib/data-export.ts`; unit-tested (`tests/unit/data-export.test.ts`, 8 tests).
- Performance optimization — DEFERRED (no evidence of a problem yet).

#### Firebase Emulator Test Harness (do alongside the security rules)
**Goal**: repeatable, hermetic, CI-friendly coverage of the Firebase integration layer —
and of the security rules themselves — without touching a live DB.

**Why now / why here**: the pure sync conflict-resolution logic is already unit-tested
(`tests/unit/firebase-sync.test.ts`), and the real-RTDB `runTransaction` semantics were
verified once manually (see below). What remains uncovered is the `FirebaseGameManager`
*orchestration* — the override methods, version carry-forward across `startNextGame()`,
`applyRemoteState()` merge behavior, and listener wiring — which is exactly the risky part
before go-live. The emulator is the only faithful way to test it (mocks can't replicate
transaction/abort behavior). Pair it with the rules work because `@firebase/rules-unit-testing`
drives the same emulator and lets us also test `database.rules.json`.

**Do NOT** put live-DB tests in CI. The one-off live verification script
(`scratchpad/live-sync-test.mjs` from the 2026-07-09 session) is a **manual pre-launch
smoke test only** — non-hermetic, needs network + open rules + credentials. Retire it from
any automated path.

**Prerequisites (must land before the first emulator test runs):**
1. **DB test seam** in `src/lib/firebase.ts`: call `connectDatabaseEmulator(db, '127.0.0.1', 9000)`
   when an env flag (e.g. `PUBLIC_FIREBASE_EMULATOR` / `import.meta.env.MODE === 'test'`) is set,
   so tests point at the local emulator instead of prod.
2. **DOM globals in the test env**: `FirebaseGameManager` touches `localStorage`, `window`,
   and `document` (the notification/DOM code). Either switch the emulator test project to the
   `jsdom` environment or extend the mocks in `tests/setup.ts`. (Note: the class also reads
   `import.meta.env` transitively via `./firebase` — fine under Vitest/Vite, throws under plain
   node, which is why the manual script duplicates the decision logic instead of importing it.)
3. **Separate Vitest project** for emulator tests (`vitest --project emulator`), kept OUT of the
   default fast unit run so `npm run test:run` stays Java-free and quick.

**Wiring:**
- Run via `firebase emulators:exec --only database "vitest run --project emulator"`.
- Needs `firebase-tools` (dev dep or `npx`) + a `firebase.json` with a `database` emulator block
  + a `.firebaserc`.
- **Java dependency**: GitHub `ubuntu` runners ship Java and `firebase-tools` installs cleanly,
  so CI is straightforward (add a dedicated job). Local dev on this machine currently has **no
  Java** — running the emulator locally needs `brew install --cask temurin` (or similar) first.

**Coverage targets (the tests to write):**
- `addHandPart`/`undo`/`completeGame` each commit a strictly-higher version; undo propagates
  as a forward version bump (not a revert).
- Two managers on the same game node converge (stale device's write is deferred, not applied).
- `startNextGame()` fallback path re-uses the same node and its fresh game supersedes the
  completed game (version carry-forward), while the series path writes a new node.
- `applyRemoteState()` adopts only strictly-newer remote state and merges arrays safely.
- Rules tests (`@firebase/rules-unit-testing`): unauth denied; a player can read/write their
  own game; a non-participant cannot; users can only edit their own profile.

## Recommended sequencing (updated 2026-07-19)

Status: Phases 1–9 done; **Phase 11 security deployed**; Phase 11 production polish (PWA, Sentry,
export) **built but not yet deployed** (uncommitted on this machine as of 2026-07-19 — see the
Production Features section). Phase 12 (multiplayer role model) **A–D done and merged**; D-remainder
and E open (see Phase 12 "Still open"). Remaining major work: Phase 10, Phase 11 rollout, Phase 12 D/E.

Recommended order from here:

1. **Real-device QA.** The concurrent auction and now the whole role model (host claim, per-device
   spectate, collision-safe entry) are proven headlessly (emulator) but under-exercised on real
   signed-in devices. One real multi-device pass against the live DB is the cheapest way to surface
   what the emulator can't (Google auth, presence/onDisconnect timing, multi-device latency).
2. **Phase 11 production rollout.** The PWA/SW, Sentry scaffold, and export are built and
   browser-verified; commit, deploy, and watch the first PWA rollout (GH-Pages HTML-staleness note
   in the Production Features section).
3. **Phase 12 D-remainder + E** — auto host-promotion, auction eligibility from player-mode
   presence, hybrid preemption abort, undo lockout (see Phase 12 "Still open").
4. **Phase 10 — Advanced Statistics & Historical Analysis.** Largest and most independent; benefits
   from more real games existing first.

Cross-cutting follow-ups to schedule opportunistically: the deferred **mixed phone/non-phone**
auction mode, and optional `FirebaseGameManager` **class-method** emulator tests (partially covered
now by `tests/emulator/`).

## Spectator / big-display mode — audit 2026-07-19 (SUPERSEDED by Phase 12)

This section originally logged the ad-hoc spectator behavior and six follow-ups. Most were built
in the Phase 12 work below; the detailed line-number references it carried are stale after the
gating rewrite, so they've been removed rather than left to rot. What shipped vs. what remains:

- **Non-seated ⇒ read-only, and the spectator auction-init transaction guarded** — DONE (PR #6).
- **Presence separation (per-device presence)** — DONE (PR #7); a spectating device no longer
  masquerades as a seated player in presence.
- **Deliberate "spectate on this device" control** — DONE (PR #9), for signed-in devices.

Still genuinely open, carried into Phase 12 "Still open" below:

- **Spectated game pollutes `localStorage.currentGame`** (`game.astro` writes it on load), so the
  device's home page later offers to "resume" someone else's game.
- **No `onAuthStateChanged` await before `loadFirebaseGame`** — a cold load can briefly misreport a
  seated player as having no access (latent race).
- **Signed-out / TV mode** (the big one) — a device that isn't signed in still can't watch:
  `games/.read` requires auth, and `loadFirebaseGame` can't distinguish "not found" from "not
  permitted". Needs anonymous auth, a public-read projection, or a share-token scheme.

## Phase 12: three-role model (player / spectator / host) — spec agreed 2026-07-19

Supersedes the per-device spectator-toggle sketch above, which becomes one case of the role model.

### Why

The 2026-07-19 production incident (see the spectator section above and PR #6): a fifth account
created a game, was therefore the "host", was NOT seated, and was let into the tap flow while the
rules rejected every write. The fix on `main` makes an unseated device read-only — which is safe
but blocks the thing actually wanted: **a laptop that both displays the game and records it**.
Phase 12 makes that a supported role instead of an accident.

### Primitives (global state is EMERGENT, not stored)

Two primitives only:

- **Per-device role**: `player` | `spectator` | `host`. Device-local (localStorage), like the
  existing manual-override flag — EXCEPT that claiming `host` also writes the shared claim below.
- **One global host claim**: `metadata/currentHost` in RTDB, exclusive, claimed by transaction.

The three "global modes" are then derived, never stored — no enum to replicate, no transitions to
implement, nothing to drift:

| | no host claimed | host claimed |
|---|---|---|
| all 4 seats have a present player-mode device | player-driven | hybrid |
| otherwise | *(promote a host — see below)* | host-driven |

### Agreed rules (decisions, 2026-07-19)

1. **Undo.** If a host is present, ONLY the host may undo. With no host, any player may undo, but
   the flow first checks for a lockout in the DB, creates one if absent, and shows a modal
   confirmation — giving state time to settle and preventing two simultaneous undos. Acknowledged
   as heavy-handed; expect to iterate after using it.
2. **Host takeover of bidding.** During the auction the host sees results like anyone else, plus
   an "End auction and select bid winner" control: a button per player and "no one". Choosing one
   ENDS the auction, and the host then also picks trump/no-trump **regardless of whether the bid
   winner already chose a suit**. Once the host takes over, the host owns bidding for the rest of
   that hand. The defending-team decision may then come from the host or the defending team;
   the hand outcome from the host if present, otherwise (open) possibly restricted to the
   defending team when the hand was played.
3. **Host vanishes.** Promote in dealer order: first dealer if signed in, else second, etc. With
   no players signed in either, the game pauses.
4. **Collisions.** ~~Give the defender decision to ONE seat (left of the winning bidder).~~
   SUPERSEDED by the collision-safe resolution below (PR #9): rather than assign steps to seats,
   any writer may enter any step and a losing write is resolved safely (first write wins, the loser
   re-syncs and gets a benign notice). The single-seat assignment survives only as an optional
   collision-*reducer* if simultaneous entry proves annoying — not built.
5. **Series advance.** Host-only if a host is present, so everyone can read the stats. With no
   host, the first player to advance starts a ~5s timer that any player may cancel.

### Sequencing

- **A. DONE (PR #6).** Non-seated ⇒ spectator, surfaced write failures, auction-init guard, sync
  conflict hardening. Safe, but deliberately blocks unseated-host scoring.
- **B. DONE (PR #7).** Per-device presence. `presence/$uid/$deviceId → { mode, ts }`. Today presence is keyed by
  uid ALONE, so two devices on one account are indistinguishable and the app literally cannot
  evaluate "is this player's only client in spectator mode". Load-bearing for the auction rule,
  the promotion rule, and hybrid — do it first.
- **C. DONE (PR #8, rules deployed 2026-07-19).** Host claim. `metadata/currentHost`, claimed by transaction (seated players
  and the creator may claim; taking it over is allowed and must be surfaced — "Dave took over as
  host"). `database.rules.json` gains `|| …/metadata/currentHost === auth.uid` on the `gameState`
  and `bidding` write rules, and `currentHost` joins the writable metadata subset. **This is the
  phase that delivers the laptop-as-scoreboard-and-scorer case**, and it also lets one person be a
  player on their phone and the host on a second device.
- **D. DONE (PR #9), collision-safe route.** Instead of deriving global modes and hard-gating by
  them, collisions were made safe so gating could go permissive. A losing `syncToFirebase` now
  distinguishes a benign deferral (remote already moved past our step — someone recorded it first)
  from a real failure: the benign case fires a TRANSIENT notice (`setSyncNoticeCallback`) and
  clears any error; only genuine failures (permission/network) latch the persistent banner.
  `evaluateGating` collapsed to read-only vs. can-write — any seated player in player mode, or the
  host, may record ANY tap-flow step (per-step ownership gone; the trump exception with it). The
  auction stays per-seat (handled before gating); a spectator-mode device is read-only even if
  seated. Proven in `tests/emulator/collision-safety.test.ts`. The mode-DERIVATION accessors
  (`nextHostSeatInDealerOrder()`, `allSeatsHavePlayerDevice()`) exist but are not yet wired to
  auto-promotion or `auctionEligible()` — see below.
- **E. Hybrid preemption + auction abort — NOT built.** Highest risk. `maybeApplyAuction` holds a
  2.8s reveal delay before `applyAuctionToHand`; a host preempting inside that window can have the
  auction result land AFTER their entry. The `phase === 'bidder'` guard only helps if the host's
  write has committed and propagated within 2.8s — exactly what fails on a backgrounded phone.
  Needs an explicit auction abort (clear `bidding`, mark the hand host-entered), with emulator
  coverage for the preempt-vs-reveal race.

### NEXT BUILD — role-aware auction + host takeover (agreed 2026-07-19)

This is the designated next work item. It has two tightly-related halves.

**Motivation — a real information leak (confirmed in code 2026-07-19).** The auction is rendered
off the viewer's *seat* (account), NOT their per-device role, so ANY device logged into a seated
account shows that seat's *participant* view — including the trump selector, which opens the
instant you bid (optimistic pre-commit, `renderAuction` "Bid logged ✓ — now choose your trump").
On a SHARED display that is a leak: the selector appears for a bid and never for a pass, so its
mere presence broadcasts "that player did not pass." Showing that a bid was *recorded* (masked
"bid logged ✓", identical for bid and pass) is fine and public; the trump selector appearing is
not. Today's only leak-free shared-display option is a non-seated account (must be the game
CREATOR to also host, since only creator/seated may claim host).

**Half 1 — role-aware auction rendering.** Make `auctionEligible()` / `renderAuction()` key on the
device's role, not just its seat:
- A device in **spectator or host** role renders the read-only spectator auction view (masked
  reveal strip only — no bid pad, no trump selector) EVEN when its account holds a seat. Fixes the
  leak: a seated player can host/spectate on a second device with no participant UI, and bid only
  on their player-role device.
- `auctionEligible()` requires every seat to have a present *player-role* device
  (`allSeatsHavePlayerDevice()` exists). When a seat has none, DON'T run the concurrent auction —
  fall back to host tap-flow bid entry (Half 2), so nothing stalls.
- Note this fixes the leak WITHOUT needing per-device host tracking: keying auction *rendering* on
  device role means the laptop (host role) is read-only while the phone (player role) plays, even
  though `isHost()` stays account-level true on both. Per-device host is a separate UI cleanup.

**Half 2 — host takeover of an ACTIVE auction (the clarified request, 2026-07-19).** Even while a
concurrent auction is live, the host must be able to enter the outcome directly, exactly like the
non-Firebase tap flow:
- Host can select **bid winner**, then **winning bid** (if not a throw-in), then **trump** (if
  there was a winning bid) — the same bidder/bid/trump tap-flow, available to the host on top of
  the live auction.
- The host's auction view shows the **auction progress** (the masked reveal strip) PLUS a note:
  the host may declare the winner, which **ends the auction**. Choosing a winner (or "no one" =
  throw-in) writes the hand directly and aborts the auction.
- Implementation: on host takeover, clear/abort the `bidding` node and write the bidder+bid(+trump)
  parts into the hand (reuse `applyAuctionToHand`'s path). This is the **explicit auction abort**
  that Phase E needs anyway — it removes the 2.8s-reveal-delay race, because the host's decision is
  authoritative and immediate rather than competing with a pending reveal.

**Testing:** this touches the most concurrency-sensitive code, so it needs emulator coverage —
role-aware rendering (a seated spectator/host device shows no participant UI), the player-mode
eligibility fallback, and the host-takeover-aborts-auction path (host declares a winner mid-auction
→ bidding cleared, hand written, no leaked reveal).

### Still open

- **Auto host-promotion on disconnect** (Phase D remainder): on host presence-loss, promote in
  dealer order — `nextHostSeatInDealerOrder()` exists but nothing calls it. With no players signed
  in, pause.
- **Auction eligibility + hybrid preemption** — folded into the NEXT BUILD above (Halves 1 and 2).
- **Undo lockout** (agreed design): host-only when a host is present; else any player, gated by a
  DB lockout + confirmation modal. Build after auto-promotion so it can key off "is there a host".
- **Series advance gating** (agreed design, not built): host-only when a host is present; else a
  ~5s timer any player can cancel.
- **Optional collision-reducer**: soft-assign the outcome to the defender left of the bidder with a
  non-blocking "waiting for X" hint. Only worth it if simultaneous entry annoys real players.
- **Carried from the spectator audit:** spectated game pollutes `localStorage.currentGame`; no
  `onAuthStateChanged` await before `loadFirebaseGame` (cold-load race); signed-out / TV watch mode.
- **No migration needed for the host claim.** The pre-existing games have no `currentHost`, so they
  read as "no host claimed": seated players can record and the creator can claim with one click.
  New games seed the claim at creation. A backfill is optional.

## Technical Details

### Game State Encoding
Each hand is encoded as a 6-character string:
1. [1-4] - Dealer position
2. [0-4] - Bid winner (0 for throw-in)
3. [4,5,6,M,D,P] - Bid value (P for pepper)
4. [C,D,S,H,N] - Trump suit (N for no trump)
5. [P,F] - Defending team decision (Play/Fold)
6. [0-6] - Tricks won/given

Example: "12PCP3" represents:
- Player 1 deals
- Player 2 "wins" bid
- Pepper round (automatic bid of 4)
- Clubs trump
- Defending team plays
- Defending team wins 3 tricks

### Data Structures
```typescript
interface GameState {
  hands: string[];              // Array of encoded hands
  currentHand: string;          // Current hand being played
  teams: [string, string];      // Team names
  players: string[];            // Player names in order
  scores: [number, number];     // Current scores
}

interface SeriesState {
  games: GameState[];          // Array of completed games
  currentGame: GameState;      // Current game being played
  seriesScore: [number, number]; // Games won by each team
}
```

## Implementation Notes

### State Management
- Use centralized state management
- Implement undo/redo functionality
- Maintain game history for statistics

### Data Persistence
- Use localStorage for game state
- Implement data pruning strategy
- Version control for stored data

### User Interface
- Responsive design for all devices
- Clear navigation
- Intuitive game flow
- Accessible statistics display

## Firebase Integration Technical Details

### Development Strategy
- **Feature Branch Development**: All Firebase features developed in `firebase-integration` branch
- **Backward Compatibility**: Maintain localStorage support during transition
- **Progressive Enhancement**: Add Firebase features without breaking existing functionality
- **Mobile-First**: Design bidding interface for mobile devices primarily

### Data Migration Strategy
1. **Dual-mode Operation**: Support both localStorage and Firebase simultaneously
2. **Import Existing Games**: Allow users to migrate localStorage games to Firebase
3. **Graceful Degradation**: Fall back to localStorage if Firebase unavailable
4. **Data Validation**: Ensure data integrity during migration

### Real-time Synchronization Patterns
```javascript
// Game state listener pattern
onGameStateChange(gameId, callback) {
  return firebase.database().ref(`games/${gameId}/gameState`)
    .on('value', (snapshot) => {
      callback(snapshot.val());
    });
}

// Optimistic updates with rollback
updateGameState(gameId, newState) {
  // Update local state immediately
  updateLocalState(newState);

  // Push to Firebase with error handling
  firebase.database().ref(`games/${gameId}/gameState`)
    .set(newState)
    .catch(error => {
      // Rollback local state on failure
      rollbackLocalState();
      showError('Failed to sync. Please try again.');
    });
}
```

### Bidding Synchronization Logic
1. **Turn-based Updates**: Only current bidder can submit bids
2. **Atomic Transactions**: Use Firebase transactions for bid submission
3. **Conflict Resolution**: Handle simultaneous bid attempts gracefully
4. **State Validation**: Server-side validation of bid sequences

### Performance Considerations
- **Minimal Data Transfer**: Only sync essential game state changes
- **Connection Management**: Implement heartbeat system for connection monitoring
- **Offline Support**: Cache critical data for offline viewing
- **Rate Limiting**: Prevent excessive API calls

## Testing Strategy
- **Manual Testing**: Focus on user experience and edge cases
- **Device Testing**: Test on actual mobile devices for bidding interface
- **Connection Testing**: Test with poor network conditions
- **Firebase Emulator**: Use local Firebase emulator for development
