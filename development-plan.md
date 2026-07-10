# Development Plan for Pepper Scorer

## Project Overview
Modernizing the Pepper card game scoring application by moving from Bootstrap 4 and CoffeeScript to Astro and Tailwind CSS, while adding Firebase integration for real-time multiplayer features, user authentication, and comprehensive statistics tracking.

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
4. **Authorized Domains** ✅ - localhost and billwolf.space configured

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

**Status (2026-07-10):** Both the 8a foundation (identity, turn-gating, presence + manual
fallback, room codes) and the 8b hybrid auction (sequential pass + optimistic pre-commit +
optional pre-picked trump) are implemented, CI-green, and verified in-browser by driving the
**real** auction engine through a simulated multiplayer manager. Remaining before launch:
- **Real multi-device QA**: the flows were exercised via simulation (headless Google sign-in
  isn't possible here). Needs a manual pass with 4 signed-in devices against live Firebase.
- **The Firebase auction wiring (`firebaseGameState.ts`) is not covered by CI** — only the pure
  `auction.ts` engine is (16 tests). The Phase 11 emulator harness should cover the wiring.
- **Mid-auction disconnect**: the auction requires all four seats *authenticated* (not
  necessarily present); if a seated player is offline when it's their turn, the auction waits
  on them and the **manual-override** escape hatch is the current remedy. Auto-abort-to-manual
  mid-auction is a possible refinement. (8a presence-fallback already covers trump/decision/tricks.)
- Security rules (Phase 11) must cover the new `presence`/`bidding` nodes and the
  `metadata/roomCode` index, and widen `.write` to any seated player — see the Phase 11 note.

#### Chosen bidding model (decided 2026-07-09): hybrid sequential auction with optimistic pre-commit
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
- **Optional pre-selected trump:** the moment a player *submits* a bid (whether in turn or as a
  pre-bid), control passes to the next bidder immediately — but if they bid (did not pass) they
  may **optionally pick their trump right then**, while the auction continues, also hidden until
  reveal. Then at auction end:
    - if they **won and pre-picked trump** → the win is announced *together with* trump and the
      separate trump step is skipped;
    - if they **won without a pre-picked trump** → the trump prompt stays up on their phone with
      a visual "waiting on you to pick trump" indicator (this is the existing gated trump phase).
  Pre-picking trump is optional, exactly like pre-bidding. (The `bids` scaffold already carries
  the optional `suit?` field for this.)
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

### Phase 9: User Management & Game Discovery
**Goal**: User accounts, game ownership, active game management

#### Features:
- User registration and profile management
- Active games dashboard
- Username autocomplete in game setup
- Room code generation for spectators
- Game invitation system

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

#### Security Implementation:
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
- Error monitoring and logging
- Performance optimization
- Progressive Web App features
- Offline functionality
- Data backup and recovery

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
