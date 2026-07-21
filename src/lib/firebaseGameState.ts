// src/lib/firebaseGameState.ts
import { ref, set, get, push, onValue, off, remove, onDisconnect, query, orderByChild, equalTo, runTransaction, type DatabaseReference } from 'firebase/database';
import { getFirebaseDatabase, isFirebaseConfigured } from './firebase';
import { getCurrentUser } from './auth';
import { createGameInvitations } from './invitations';
import { GameManager, getCurrentPhase, type GameState } from './gameState';
import { getPath } from './path-utils';
import { resolveSeat, parsePresence, type DeviceRole } from './multiplayer';
import {
  createAuction,
  enterBid,
  setTrump,
  isComplete as auctionIsComplete,
  auctionResult,
  type AuctionState,
  type ActionValue,
  type TrumpSuit,
} from './auction';

export interface FirebaseGameMetadata {
  createdBy: string;
  currentHost?: string | null;
  createdAt: number;
  lastUpdated?: number;
  status: 'setup' | 'active' | 'completed';
  roomCode?: string;
  seriesId?: string; // Links to a series if part of one
}

export interface FirebaseGamePlayer {
  userId?: string;
  displayName: string;
  isAuthenticated: boolean;
  position: number; // 0-3
}

export interface FirebaseGameData {
  metadata: FirebaseGameMetadata;
  players: FirebaseGamePlayer[];
  teams: [string, string];
  gameState: GameState;
  // Phase 8b mobile bidding auction state (see src/lib/auction.ts). Present only while a
  // regular hand's auction is in progress or just completed; reset per hand by handIndex.
  bidding?: AuctionState;
}

export interface FirebaseSeriesData {
  metadata: {
    createdBy: string;
    currentHost?: string | null;
    createdAt: number;
    lastUpdated?: number;
    status: 'active' | 'completed';
  };
  players: FirebaseGamePlayer[];
  teams: [string, string];
  currentGameId: string; // ID of the current active game in the series
  gameIds: string[]; // Array of all game IDs in chronological order
  seriesScores: [number, number]; // Series wins for each team
  seriesWinner?: number; // Team index (0 or 1) when series is complete
}

// Generate room code for game
const generateRoomCode = (): string => {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
};

export class FirebaseGameManager extends GameManager {
  private gameId: string | null = null;
  private gameRef: DatabaseReference | null = null;
  private listeners: Array<() => void> = [];
  private uiUpdateCallback: ((_state: GameState) => void) | null = null;
  private seriesId: string | null = null;
  private seriesListener: (() => void) | null = null;
  private connectionListener: (() => void) | null = null;
  private online = true;

  // Phase 8 multiplayer identity: the full player roster (with userId/position) and the
  // room code, kept alongside the display-name-only GameState.players so we can answer
  // "which seat is the signed-in user?" and surface a shareable room code.
  private firebasePlayers: FirebaseGamePlayer[] = [];
  private roomCode: string | null = null;
  // The uid of the game creator (metadata.createdBy) — the "host" who may enter every decision.
  private hostUid: string | null = null;          // metadata/createdBy (immutable)
  private currentHostUid: string | null = null;   // metadata/currentHost (claimable)

  // Phase 8 presence: uids currently connected to this game (via onDisconnect-backed
  // writes under games/{id}/presence). Drives the "fall back to manual when the seat
  // whose turn it is has no one online" behaviour. Empty until the presence node loads.
  private presentUids: Set<string> = new Set();
  // Phase 12: the same presence, but per DEVICE — uid -> the roles of that user's connected
  // devices. One account on two devices is two entries, so "this player's only client is
  // spectating" becomes answerable. presentUids stays as the uid-level view over this.
  private presentDevices: Map<string, DeviceRole[]> = new Map();
  private presenceInitialized = false;

  // Phase 8b auction: the live bidding state for the current hand (mirrored from
  // games/{id}/bidding), or null when no auction is active.
  private auctionState: AuctionState | null = null;

  constructor(players: string[], teams: [string, string], gameId?: string) {
    super(players, teams);

    // Brand-new local state starts at version 0; every sync bumps it monotonically.
    this.state.version = 0;

    if (gameId) {
      this.gameId = gameId;
      this.setupFirebaseListeners();
    }
  }

  // Read the monotonic sync version from any state-like value; missing/invalid => 0.
  static versionOf(state: unknown): number {
    if (state && typeof state === 'object' && typeof (state as GameState).version === 'number') {
      return (state as GameState).version as number;
    }
    return 0;
  }

  // Is `remote` strictly newer than `local` by sync version? Single source of truth for
  // both the write guard (syncToFirebase) and the read guard (applyRemoteState).
  static isRemoteNewer(remote: unknown, local: unknown): boolean {
    return FirebaseGameManager.versionOf(remote) > FirebaseGameManager.versionOf(local);
  }

  // Pure conflict-resolution decision for a sync write. Given the current remote state
  // and our local state, either defer to the remote, or commit our state stamped with a
  // bumped, monotonically-increasing version. Exposed static for testing.
  //
  // This is a compare-and-set on the version, NOT a "defer only if remote is strictly
  // newer" check. `local.version` is only ever assigned from a value we successfully
  // committed or adopted (see syncToFirebase / applyRemoteState), so it doubles as the
  // baseline version we last agreed with the server on. Committing only when the remote
  // still sits at that baseline is what makes a write safe.
  //
  // The strictly-newer form had a hole that cost us a live game: content can advance
  // locally WITHOUT the version advancing, because the version is only bumped by a
  // successful commit. A device whose write failed (rejected by the security rules, or a
  // dropped connection) therefore holds divergent content at an EQUAL version. The old
  // guard read equal as "no conflict" and committed, overwriting good server state with a
  // stale branch — and, because the commit bumped the version, every other device then
  // adopted the damage. Requiring equality means a device can only write forward from the
  // state it last saw; anything else defers and pulls the server's version in.
  static resolveSyncWrite(
    remote: GameState | null,
    local: GameState
  ): { defer: true } | { commit: GameState } {
    if (remote && FirebaseGameManager.versionOf(remote) !== FirebaseGameManager.versionOf(local)) {
      return { defer: true };
    }
    const nextVersion = Math.max(
      FirebaseGameManager.versionOf(local),
      FirebaseGameManager.versionOf(remote)
    ) + 1;
    return { commit: { ...local, version: nextVersion } };
  }

  // Apply a remote game state to this manager if (and only if) it is strictly newer
  // than what we currently hold. Centralizes the merge, local persistence, and UI
  // notification so every listener path behaves identically. Returns true if adopted.
  //
  // The version guard replaces the old wall-clock "skip our own update within 1s"
  // heuristic: our own committed writes echo back with a version equal to ours and are
  // ignored, while genuinely newer remote state is always accepted.
  //
  // `force` bypasses the version guard and is used ONLY when a sync transaction deferred: the
  // server rejected our write, so its value is authoritative by definition and we must take it
  // even if the versions compare equal (exactly the diverged-at-equal-version case).
  private applyRemoteState(newState: GameState | null, force = false): boolean {
    if (!newState) return false;

    if (!force && !FirebaseGameManager.isRemoteNewer(newState, this.state)) return false;

    const remoteVersion = FirebaseGameManager.versionOf(newState);

    this.state = {
      ...this.state,
      ...newState,
      hands: newState.hands || [],
      scores: newState.scores || [0, 0],
      players: newState.players || this.state.players || [],
      teams: newState.teams || this.state.teams || ['Team 1', 'Team 2'],
      version: remoteVersion
    };

    this.notifyStateChange();

    // Persist a local copy for offline fallback — but ONLY for a participant (seated) or the host.
    // A pure spectator watching live updates must not overwrite this device's own resumable game.
    if (this.shouldPersistLocalCopy()) {
      try {
        localStorage.setItem('currentGame', JSON.stringify(this.state));
      } catch {
        // localStorage may be unavailable (private mode / quota); non-fatal.
      }
    }

    if (this.uiUpdateCallback) {
      this.uiUpdateCallback(this.state);
    }

    return true;
  }

  // Create Firebase game for this instance
  async createFirebaseGame(
    authenticatedPlayers: Array<{ userId: string; username: string; displayName: string; isAuthenticated: boolean; position: number }> = [],
    createdBy: string | null = null
  ): Promise<void> {
    if (!isFirebaseConfigured()) {
      console.warn('Firebase not configured. Skipping Firebase game creation.');
      return;
    }

    const database = getFirebaseDatabase();
    const currentUser = getCurrentUser();

    if (!database) {
      console.warn('Firebase database not available.');
      return;
    }

    const gameCreator = createdBy || currentUser?.uid;
    if (!gameCreator) {
      console.warn('No authenticated user to create Firebase game.');
      return;
    }

    try {
      const roomCode = generateRoomCode();
      // Create game data
      const gameData: FirebaseGameData = {
        metadata: {
          createdBy: gameCreator,
          // Seed the host claim so the creator can administer from the start — including when
          // they hold no seat (a laptop scoring for four phones). The rules key write access
          // off this field, so an unset one would leave an unseated creator unable to write.
          currentHost: gameCreator,
          createdAt: Date.now(),
          status: 'setup',
          roomCode
        },
        players: this.state.players.map((playerName, index) => {
          const authPlayer = authenticatedPlayers.find(p => p.position === index);
          return {
            userId: authPlayer?.userId,
            displayName: authPlayer?.displayName || playerName,
            isAuthenticated: Boolean(authPlayer?.isAuthenticated),
            position: index
          };
        }),
        teams: this.state.teams as [string, string],
        gameState: this.state
      };

      // Save to Firebase. RTDB rejects `undefined`, so strip it — an unlinked player seat has
      // `userId: undefined`, which would otherwise fail the whole write (mixed phone/non-phone
      // games are the normal case).
      const gamesRef = ref(database, 'games');
      const newGameRef = push(gamesRef);
      const gameId = newGameRef.key!;

      await set(newGameRef, JSON.parse(JSON.stringify(gameData)));

      // Set this instance as Firebase-enabled
      this.gameId = gameId;
      this.state.firebaseGameId = gameId;
      this.firebasePlayers = gameData.players;
      this.roomCode = roomCode;
      this.hostUid = gameCreator;
      this.currentHostUid = gameCreator;

      // Add to creator's active games
      const userGameRef = ref(database, `userGames/${gameCreator}/${gameId}`);
      await set(userGameRef, true);

      // Invite the other registered players (Phase 9). Rather than silently dropping the game into
      // their active list, send a pending invitation they accept/decline — accepting is what adds it
      // to their userGames. They are already seated in `players` above, so they can play on accept.
      const creatorName =
        authenticatedPlayers.find(p => p.userId === gameCreator)?.displayName ||
        currentUser?.displayName ||
        'A player';
      await createGameInvitations(
        gameId,
        {
          from: gameCreator,
          fromName: creatorName,
          teams: this.state.teams as [string, string],
          roomCode
        },
        authenticatedPlayers
          .filter(p => p.userId && p.userId !== gameCreator)
          .map(p => ({
            userId: p.userId,
            seat: p.position,
            // Partner is the other seat on the same team (seats 0&2 vs 1&3).
            partnerName: this.state.players[(p.position + 2) % 4] || 'your partner'
          }))
      );

      // Setup Firebase listeners
      this.setupFirebaseListeners();

      console.log('Firebase game created with ID:', gameId);

    } catch (error) {
      console.error('Error creating Firebase game:', error);
    }
  }

  // Create new Firebase game (static method)
  static async createFirebaseGame(
    players: string[],
    teams: [string, string],
    authenticatedPlayers: Array<{ userId: string; username: string; displayName: string; position: number }> = []
  ): Promise<FirebaseGameManager | null> {
    if (!isFirebaseConfigured()) {
      console.warn('Firebase not configured. Creating local game.');
      return new FirebaseGameManager(players, teams);
    }

    const database = getFirebaseDatabase();
    const currentUser = getCurrentUser();

    if (!database || !currentUser) {
      return new FirebaseGameManager(players, teams);
    }

    try {
      // Create game data
      const gameData: FirebaseGameData = {
        metadata: {
          createdBy: currentUser.uid,
          createdAt: Date.now(),
          status: 'setup',
          roomCode: generateRoomCode()
        },
        players: players.map((playerName, index) => {
          const authPlayer = authenticatedPlayers.find(p => p.position === index);
          return {
            userId: authPlayer?.userId,
            displayName: authPlayer?.displayName || playerName,
            isAuthenticated: Boolean(authPlayer),
            position: index
          };
        }),
        teams,
        gameState: {
          hands: [],
          players,
          teams,
          scores: [0, 0] as [number, number],
          isComplete: false,
          isSeries: false,
          startTime: Date.now(),
          version: 0
        }
      };

      // Save to Firebase (strip undefined — unlinked player seats have userId: undefined).
      const gamesRef = ref(database, 'games');
      const newGameRef = push(gamesRef);
      const gameId = newGameRef.key!;

      await set(newGameRef, JSON.parse(JSON.stringify(gameData)));

      // Add to user's active games
      const userGameRef = ref(database, `userGames/${currentUser.uid}/${gameId}`);
      await set(userGameRef, true);

      // Invite the other registered players (Phase 9) rather than silently seeding their userGames;
      // accepting is what adds the game to their list. See the instance createFirebaseGame + invitations.ts.
      await createGameInvitations(
        gameId,
        {
          from: currentUser.uid,
          fromName: currentUser.displayName || 'A player',
          teams,
          roomCode: gameData.metadata.roomCode
        },
        authenticatedPlayers
          .filter(p => p.userId && p.userId !== currentUser.uid)
          .map(p => ({
            userId: p.userId,
            seat: p.position,
            partnerName: players[(p.position + 2) % 4] || 'your partner'
          }))
      );

      console.log('Firebase game created with ID:', gameId);
      return new FirebaseGameManager(players, teams, gameId);

    } catch (error) {
      console.error('Error creating Firebase game:', error);
      return new FirebaseGameManager(players, teams);
    }
  }

  // Resolve a shareable room code to its game id, so players can join by code instead of
  // a raw push id. Room codes are effectively unique; the first match is returned.
  //
  // NOTE (Phase 11 rules): this query orders by the nested `metadata/roomCode`. Add
  //   "games": { ".indexOn": ["metadata/roomCode"] }
  // to database.rules.json — without the index Firebase falls back to a full download of
  // /games and logs a warning.
  static async findGameByRoomCode(roomCode: string): Promise<string | null> {
    if (!isFirebaseConfigured() || !roomCode) return null;

    const database = getFirebaseDatabase();
    if (!database) return null;

    try {
      const code = roomCode.trim().toUpperCase();
      const gamesRef = ref(database, 'games');
      const snapshot = await get(query(gamesRef, orderByChild('metadata/roomCode'), equalTo(code)));

      if (!snapshot.exists()) return null;

      const matches = snapshot.val() as Record<string, unknown>;
      const ids = Object.keys(matches);
      return ids[0] || null;
    } catch (error) {
      console.error('Error finding game by room code:', error);
      return null;
    }
  }

  // Load existing Firebase game
  static async loadFirebaseGame(gameId: string): Promise<FirebaseGameManager | null> {
    if (!isFirebaseConfigured()) return null;

    const database = getFirebaseDatabase();
    if (!database) return null;

    try {
      const gameRef = ref(database, `games/${gameId}`);
      const snapshot = await get(gameRef);

      if (!snapshot.exists()) {
        console.error('Game not found:', gameId);
        return null;
      }

      const gameData = snapshot.val() as FirebaseGameData;
      const manager = new FirebaseGameManager(
        gameData.gameState.players,
        gameData.gameState.teams as [string, string],
        gameId
      );

      // Restore full game state with proper defaults
      // Merge Firebase game state with defaults, ensuring arrays are properly initialized
      const baseState = {
        players: gameData.players?.map(p => p.displayName) || [],
        teams: gameData.teams || ['Team 1', 'Team 2'],
        hands: [],
        scores: [0, 0],
        isComplete: false,
        isSeries: false,
        startTime: Date.now(),
        firebaseGameId: gameId,
        version: 0
      };

      // Safely merge game state, ensuring arrays exist
      manager.state = {
        ...baseState,
        ...gameData.gameState,
        hands: gameData.gameState?.hands || [],
        scores: gameData.gameState?.scores || [0, 0],
        players: gameData.gameState?.players || gameData.players?.map(p => p.displayName) || [],
        teams: gameData.gameState?.teams || gameData.teams || ['Team 1', 'Team 2']
      };

      // Preserve the full player roster and room code for the multiplayer identity layer.
      manager.firebasePlayers = gameData.players || [];
      manager.roomCode = gameData.metadata?.roomCode || null;
      manager.hostUid = gameData.metadata?.createdBy || null;
      manager.currentHostUid = gameData.metadata?.currentHost || null;

      // Check if this game is part of a series
      if (gameData.metadata.seriesId) {
        manager.seriesId = gameData.metadata.seriesId;
        manager.setupSeriesListener();
      }

      return manager;
    } catch (error) {
      console.error('Error loading Firebase game:', error);
      return null;
    }
  }

  // Setup Firebase listeners
  private setupFirebaseListeners() {
    if (!this.gameId || !isFirebaseConfigured()) return;

    const database = getFirebaseDatabase();
    if (!database) return;

    this.gameRef = ref(database, `games/${this.gameId}`);

    // Listen for game state changes. applyRemoteState uses the monotonic version to
    // ignore our own echoes and any stale state, so no wall-clock heuristic is needed.
    const gameStateRef = ref(database, `games/${this.gameId}/gameState`);
    const unsubscribeGameState = onValue(gameStateRef, (snapshot) => {
      if (snapshot.exists()) {
        this.applyRemoteState(snapshot.val() as GameState);
      }
    });

    this.listeners.push(() => off(gameStateRef, 'value', unsubscribeGameState));

    // Phase 8b: mirror the auction state and refresh the UI whenever it changes.
    const biddingRef = ref(database, `games/${this.gameId}/bidding`);
    const unsubscribeBidding = onValue(biddingRef, (snapshot) => {
      // Normalize: RTDB drops empty `entries`/`order`, so a freshly-created auction round-trips
      // with `entries === undefined`. Without this, renderAuction's `auction.entries[seat]` throws
      // and the auction UI never appears (stuck on "Starting the auction…").
      this.auctionState = snapshot.exists()
        ? this.normalizeAuction(snapshot.val() as AuctionState)
        : null;
      if (this.uiUpdateCallback) this.uiUpdateCallback(this.state);
    });
    this.listeners.push(() => off(biddingRef, 'value', unsubscribeBidding));

    // Phase 12C: track the host claim live. A takeover has to reach every device promptly —
    // the device that just LOST host must stop offering controls it can no longer write with,
    // and the rest must re-evaluate who they are waiting on.
    const hostRef = ref(database, `games/${this.gameId}/metadata/currentHost`);
    const unsubscribeHost = onValue(hostRef, (snapshot) => {
      const next = (snapshot.val() as string | null) || null;
      if (next === this.currentHostUid) return;
      this.currentHostUid = next;
      if (this.hostChangeCallback) this.hostChangeCallback(next);
      if (this.uiUpdateCallback) this.uiUpdateCallback(this.state);
      // A host change may mean the host vanished (or a new one appeared) — re-evaluate promotion.
      this.maybePromoteHost();
    });
    this.listeners.push(() => off(hostRef, 'value', unsubscribeHost));

    // Series-advance request: a shared, cancelable "next game starting…" countdown for hostless
    // games. Mirror it so every device shows/hides the countdown together.
    const advanceRef = ref(database, `games/${this.gameId}/seriesAdvance`);
    const unsubscribeAdvance = onValue(advanceRef, (snapshot) => {
      const val = snapshot.exists() ? (snapshot.val() as { by: string; ts: number }) : null;
      this.seriesAdvancePending = val && typeof val.by === 'string' ? val : null;
      if (this.seriesAdvanceCallback) this.seriesAdvanceCallback(this.seriesAdvancePending);
      if (this.uiUpdateCallback) this.uiUpdateCallback(this.state);
    });
    this.listeners.push(() => off(advanceRef, 'value', unsubscribeAdvance));
  }

  // Notified when the host claim moves, so the UI can say "Dave took over as host".
  private hostChangeCallback: ((_hostUid: string | null) => void) | null = null;
  public setHostChangeCallback(callback: (_hostUid: string | null) => void): void {
    this.hostChangeCallback = callback;
  }

  // Sync state to Firebase using an atomic, version-guarded transaction.
  //
  // This is the core fix for the "manual sync reverts newer -> older" bug and for
  // races between multiple devices. Rather than blindly `set()`-ing our local state
  // (last-writer-wins), we run a transaction that refuses to overwrite a strictly-newer
  // remote state and instead pulls it in. When our state is the newest, we write it with
  // a bumped version so other devices can order it deterministically.
  private async syncToFirebase() {
    if (!this.gameId || !isFirebaseConfigured()) {
      return;
    }

    const database = getFirebaseDatabase();
    if (!database) {
      return;
    }

    const gameStateRef = ref(database, `games/${this.gameId}/gameState`);

    // Whether this sync is carrying a local edit (a hand part, an undo) rather than being a
    // no-op refresh. Only in the former case does losing the transaction cost the user anything.
    const hadPendingEdit = this.pendingLocalEdit;
    this.pendingLocalEdit = false;

    try {
      const result = await runTransaction(
        gameStateRef,
        (remote: GameState | null) => {
          const decision = FirebaseGameManager.resolveSyncWrite(remote, this.state);
          // defer => return undefined to abort (remote is newer; adopted below).
          // commit => write our state stamped with a bumped version.
          return 'defer' in decision ? undefined : decision.commit;
        },
        // Don't optimistically apply locally; wait for the confirmed server value so
        // our own onValue echo carries the committed version and stays idempotent.
        { applyLocally: false }
      );

      if (result.committed && result.snapshot.exists()) {
        // Track the version we just committed so our echo is recognized as our own, and so it
        // becomes the baseline the next compare-and-set writes forward from.
        this.state.version = FirebaseGameManager.versionOf(result.snapshot.val());
        this.setSyncError(null);
        this.touchLastUpdated();
      } else if (!result.committed && result.snapshot.exists()) {
        // The remote won the transaction, so its value IS the game — adopt it unconditionally,
        // including when it carries a LOWER version than ours. That looks like walking
        // backwards, but the alternative wedges the device: under the compare-and-set above, a
        // local version sitting above the node's defers forever, so refusing to adopt would
        // leave it unable to ever write again. Taking the server's value is both correct
        // (every other device sees it) and self-healing (the next write commits from it).
        this.applyRemoteState(result.snapshot.val() as GameState, true);
        // A deferral means the remote already moved past the step we were entering — someone
        // else (a player or the host) recorded it first. This is the EXPECTED outcome of two
        // people acting at once, not a failure: the step is already filled, so there is nothing
        // to re-enter. Surface it as a transient notice, not a persistent error, and make sure
        // any stale error banner is cleared now that we are back in sync. This benign resolution
        // is what lets gating relax to "anyone may record" — a lost race costs nothing.
        this.setSyncError(null);
        if (hadPendingEdit) {
          this.emitSyncNotice('Someone else recorded that first — showing the latest.');
        }
      }
    } catch (error) {
      // A rejected write used to be logged and forgotten, which is how a device could keep
      // accepting input for a whole game while nothing reached the server. Record it so the UI
      // can say so. Permission denied here almost always means "not one of the four seated
      // players" — the security rules only grant gameState writes to seated uids.
      const denied = String((error as { code?: string })?.code || error).includes('permission');
      this.setSyncError(
        denied
          ? 'This device is not allowed to record for this game — its changes are not being saved.'
          : 'Could not save to the server — your last change may only exist on this device.'
      );
      console.error('Error syncing to Firebase:', error);
    }
  }

  // Last sync failure, or null when the most recent sync round-tripped cleanly.
  private lastSyncError: string | null = null;
  private syncErrorCallback: ((_message: string | null) => void) | null = null;

  public getLastSyncError(): string | null {
    return this.lastSyncError;
  }

  // Notified whenever the sync-failure state changes, so the page can show/clear a banner.
  public setSyncErrorCallback(callback: (_message: string | null) => void): void {
    this.syncErrorCallback = callback;
    callback(this.lastSyncError);
  }

  private setSyncError(message: string | null): void {
    if (this.lastSyncError === message) return;
    this.lastSyncError = message;
    if (this.syncErrorCallback) this.syncErrorCallback(message);
  }

  // Transient, benign notices (distinct from the persistent error channel above): "someone else
  // recorded that first". These are expected in normal multi-writer play and should flash and
  // fade, never latch. Not stored — there is no state to read back, only an event to show.
  private syncNoticeCallback: ((_message: string) => void) | null = null;

  public setSyncNoticeCallback(callback: (_message: string) => void): void {
    this.syncNoticeCallback = callback;
  }

  private emitSyncNotice(message: string): void {
    if (this.syncNoticeCallback) this.syncNoticeCallback(message);
  }

  // Best-effort bump of the game's lastUpdated timestamp (used by active-game listing
  // and abandoned-game cleanup). Never blocks or fails the primary sync.
  private async touchLastUpdated(): Promise<void> {
    if (!this.gameId || !isFirebaseConfigured()) return;

    const database = getFirebaseDatabase();
    if (!database) return;

    try {
      await set(ref(database, `games/${this.gameId}/metadata/lastUpdated`), Date.now());
    } catch {
      // Non-fatal; the game state itself already synced.
    }
  }

  // Coalesce syncs triggered by multiple synchronous state mutations in the same tick into a
  // SINGLE write of the final state. Several flows add more than one hand part in one go —
  // pepper auto-bid (bid winner + 'P'), negotiate (fold + free tricks), clubs-forces-play
  // (trump + forced 'P'), and initial-hand setup ('1' + '2' + 'P'). Firing a separate
  // version-guarded transaction per part raced: two writes were stamped the same version, the
  // second deferred, and applyRemoteState pulled the first write's PARTIAL state back in —
  // silently dropping the later part (e.g. the auto-bid or the negotiated trick count).
  private syncScheduled = false;
  // Set when a local mutation is waiting to reach the server, cleared when a sync picks it up.
  private pendingLocalEdit = false;
  private scheduleSync(): void {
    this.pendingLocalEdit = true;
    if (this.syncScheduled) return;
    this.syncScheduled = true;
    queueMicrotask(() => {
      this.syncScheduled = false;
      this.syncToFirebase();
    });
  }

  // Override methods to sync to Firebase
  override addHandPart(part: string): void {
    super.addHandPart(part);
    this.scheduleSync();
  }

  override undo(): void {
    super.undo();
    this.scheduleSync();
  }

  override completeGame(): void {
    super.completeGame();
    this.syncToFirebase();
    this.updateGameStatus('completed');
  }


  // Update game status in Firebase
  private async updateGameStatus(status: 'setup' | 'active' | 'completed') {
    if (!this.gameId || !isFirebaseConfigured()) return;

    const database = getFirebaseDatabase();
    if (!database) return;

    try {
      const statusRef = ref(database, `games/${this.gameId}/metadata/status`);
      await set(statusRef, status);
    } catch (error) {
      console.error('Error updating game status:', error);
    }
  }

  // State change notification (for UI updates)
  private stateChangeListeners: Array<(_gameState: GameState) => void> = [];

  public onStateChange(callback: (_gameState: GameState) => void): () => void {
    this.stateChangeListeners.push(callback);
    return () => {
      const index = this.stateChangeListeners.indexOf(callback);
      if (index > -1) {
        this.stateChangeListeners.splice(index, 1);
      }
    };
  }

  private notifyStateChange() {
    this.stateChangeListeners.forEach(callback => callback(this.state));
  }

  // Get game ID
  public getGameId(): string | null {
    return this.gameId;
  }

  // Check if this is a Firebase game
  public isFirebaseGame(): boolean {
    return this.gameId !== null && isFirebaseConfigured();
  }

  // Multiplayer identity (Phase 8)
  // ===============================

  // The full player roster (with userId/position), as loaded from Firebase.
  public getFirebasePlayers(): FirebaseGamePlayer[] {
    return this.firebasePlayers;
  }

  // Shareable room code for this game (null for local games or older records).
  public getRoomCode(): string | null {
    return this.roomCode;
  }

  // The id of the series this game belongs to, or null if it is a standalone game.
  public getSeriesId(): string | null {
    return this.seriesId;
  }

  // The 0-based seat of the currently signed-in user, or null if they are not seated
  // (a spectator, or not signed in). Used to gate turn-based controls and to render
  // "you are seat N" / relative-direction indicators.
  public getMySeat(): number | null {
    return resolveSeat(this.firebasePlayers, getCurrentUser()?.uid ?? null);
  }

  // Is the signed-in user one of the four seated players?
  public isParticipant(): boolean {
    return this.getMySeat() !== null;
  }

  // Should this device keep a local `currentGame` copy (offline fallback + home-page resume)? Only
  // when it is a PARTICIPANT (seated) or the host. A pure spectator (incl. an anonymous watcher)
  // must not persist, or the home page later offers to resume a game it was only watching.
  public shouldPersistLocalCopy(): boolean {
    return this.getMySeat() !== null || this.isHost();
  }

  // Viewer status for turn-gating: whether anyone is signed in on this device, and if so
  // which seat they hold (null = signed-in spectator). When nobody is signed in we treat
  // the device as a shared/host scoreboard and apply no gating.
  public getViewerSeatInfo(): { signedIn: boolean; seat: number | null } {
    const uid = getCurrentUser()?.uid ?? null;
    return { signedIn: uid !== null, seat: resolveSeat(this.firebasePlayers, uid) };
  }

  // The EFFECTIVE host is metadata/currentHost — the one device-owner who may administer the
  // game right now. It is seeded to the creator at game creation and can be claimed by any
  // seated player (or the creator) thereafter, one at a time. Crucially it need NOT be seated:
  // that is the whole point of Phase 12C, and the security rules grant it write access to
  // gameState/bidding/status/seriesId regardless of seat.
  //
  // `hostUid` (metadata/createdBy) is a separate, immutable fact — it decides who may CLAIM
  // host, not who currently is one. Do not conflate them.
  public isHost(): boolean {
    const uid = getCurrentUser()?.uid ?? null;
    return uid !== null && this.currentHostUid !== null && uid === this.currentHostUid;
  }

  // The uid administering the game, or null when nobody holds the claim.
  public getCurrentHostUid(): string | null {
    return this.currentHostUid;
  }

  // The creator, who may always claim host back. Not necessarily the current host.
  public getCreatorUid(): string | null {
    return this.hostUid;
  }

  // May the signed-in user claim host? Seated players and the creator, matching the rules.
  public canClaimHost(): boolean {
    const uid = getCurrentUser()?.uid ?? null;
    if (!uid) return false;
    return uid === this.hostUid || resolveSeat(this.firebasePlayers, uid) !== null;
  }

  // Take over as host. A transaction so two simultaneous claims can't both believe they won —
  // takeover of an existing host IS allowed (one host at a time, not first-come-forever), so
  // the UI must surface the change to whoever just lost it.
  public async claimHost(): Promise<boolean> {
    if (!this.gameId || !isFirebaseConfigured()) return false;
    const database = getFirebaseDatabase();
    const uid = getCurrentUser()?.uid ?? null;
    if (!database || !uid || !this.canClaimHost()) return false;

    try {
      const hostRef = ref(database, `games/${this.gameId}/metadata/currentHost`);
      const result = await runTransaction(hostRef, () => uid);
      if (result.committed) {
        this.currentHostUid = uid;
        this.setDeviceRole('host');
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error claiming host:', error);
      return false;
    }
  }

  // Give up the host claim, leaving the game with no host until someone claims it.
  public async releaseHost(): Promise<boolean> {
    if (!this.gameId || !isFirebaseConfigured() || !this.isHost()) return false;
    const database = getFirebaseDatabase();
    if (!database) return false;

    try {
      await set(ref(database, `games/${this.gameId}/metadata/currentHost`), null);
      this.currentHostUid = null;
      if (this.getDeviceRole() === 'host') {
        this.setDeviceRole(this.getMySeat() !== null ? 'player' : 'spectator');
      }
      return true;
    } catch (error) {
      console.error('Error releasing host:', error);
      return false;
    }
  }

  // The current host's 0-based seat, or null if the host isn't among the seated players
  // (entirely legitimate now — an unseated host is a supported configuration).
  public getHostSeat(): number | null {
    return this.currentHostUid ? resolveSeat(this.firebasePlayers, this.currentHostUid) : null;
  }

  // Display name for the host, for the "waiting for {host}" message.
  public getHostName(): string {
    const seat = this.getHostSeat();
    if (seat !== null && this.firebasePlayers[seat]?.displayName) {
      return this.firebasePlayers[seat]!.displayName!;
    }
    return 'the host';
  }

  // Is the host currently connected? Drives the presence fallback: if the host is offline,
  // gating drops so the remaining players aren't stuck waiting on an absent host.
  public isHostPresent(): boolean {
    return this.currentHostUid ? this.presentUids.has(this.currentHostUid) : false;
  }

  // Seat to promote to host when the host vanishes: dealer order from the game's first dealer, the
  // first PRESENT seated player wins (agreed 2026-07-19). Returns null when no seated player is
  // present, in which case nobody can administer the game and it pauses until one returns.
  public nextHostSeatInDealerOrder(): number | null {
    const firstDealer = parseInt(this.state.hands[0]?.[0] || '1', 10); // 1-based; default seat 1
    for (let i = 0; i < 4; i++) {
      const seat = (firstDealer - 1 + i) % 4; // 0-based, walking from the first dealer
      const uid = this.firebasePlayers[seat]?.userId;
      if (uid && this.presentUids.has(uid)) return seat;
    }
    return null;
  }

  // Auto host-promotion (Phase D). When the current host's presence vanishes, the game still needs
  // an administrator (to drive tap-flow bidding, undo, series advance). The device that is the
  // next-in-line present seated player promotes ITSELF via a takeover-safe transaction, after a
  // short debounce that is re-checked so a transient network blip doesn't cause needless churn.
  // Deterministic single writer: only nextHostSeatInDealerOrder()'s seat acts, so devices don't
  // stampede. With no present seated player, nobody promotes and the game pauses (manual claim
  // still works). Invoked from the presence and host listeners after they update their state.
  private static readonly HOST_PROMOTION_DELAY_MS = 3000;
  private hostPromotionTimer: ReturnType<typeof setTimeout> | null = null;

  private maybePromoteHost(): void {
    if (!this.gameId || !isFirebaseConfigured()) return;
    // Don't trust "host absent" until presence has reported at least once (avoids a first-paint
    // false promotion before the real host's presence has loaded).
    if (!this.hasPresenceData()) return;
    // Only auto-promote when a host IS claimed but has gone absent. A hostless game (released or
    // never claimed) is covered by manual claim, not promotion.
    if (this.currentHostUid === null || this.isHostPresent()) {
      this.clearHostPromotion();
      return;
    }
    const myUid = getCurrentUser()?.uid ?? null;
    const mySeat = this.getMySeat();
    // Only the next-in-line present seated player promotes itself.
    if (myUid === null || mySeat === null || this.nextHostSeatInDealerOrder() !== mySeat) {
      this.clearHostPromotion();
      return;
    }
    if (this.hostPromotionTimer) return; // already pending
    this.hostPromotionTimer = setTimeout(() => {
      this.hostPromotionTimer = null;
      // Re-check after the debounce: the host may have returned, or another device may now be
      // first in line (e.g. an earlier-in-dealer-order seat reconnected).
      if (this.currentHostUid === null || this.isHostPresent()) return;
      if (this.getMySeat() !== this.nextHostSeatInDealerOrder()) return;
      const uid = getCurrentUser()?.uid ?? null;
      if (!uid) return;
      this.promoteSelfToHost(uid, this.currentHostUid).catch(err => console.error('host promotion:', err));
    }, FirebaseGameManager.HOST_PROMOTION_DELAY_MS);
  }

  private clearHostPromotion(): void {
    if (this.hostPromotionTimer) {
      clearTimeout(this.hostPromotionTimer);
      this.hostPromotionTimer = null;
    }
  }

  // Take over host from the vanished `absentHost`, only if the DB still records that same host —
  // so a manual claim or a rival promoter that landed first is not stomped (one host at a time).
  private async promoteSelfToHost(uid: string, absentHost: string): Promise<void> {
    const database = getFirebaseDatabase();
    if (!database || !this.gameId) return;
    const hostRef = ref(database, `games/${this.gameId}/metadata/currentHost`);
    const result = await runTransaction(hostRef, (current: string | null) => {
      if (current !== absentHost) return; // someone already changed it — abort, don't stomp
      return uid;
    });
    // Adopt the host role whenever the node now holds OUR uid — NOT only when `committed` is true.
    // RTDB reports committed:false for a benign no-op-equal write (e.g. a racing trigger already
    // wrote our uid), and gating on it left this device as host in the DB but still 'player' role
    // locally — the source of a flaky "expected 'player' to be 'host'". The node value is the truth.
    if (result.snapshot.val() === uid) {
      this.currentHostUid = uid;
      this.setDeviceRole('host');
      if (this.uiUpdateCallback) this.uiUpdateCallback(this.state);
    }
  }

  // Undo coordination (agreed 2026-07-19)
  // ====================================
  // In a HOSTLESS multiplayer game any seated player may undo, but only one at a time and only
  // after confirming — so the flow first takes a short-lived DB lock. A held lock blocks a second
  // player from starting a concurrent undo (they get a "someone's already undoing" notice). The
  // lock clears on disconnect and is treated as stale after a few seconds, so a device that crashes
  // mid-confirmation can't wedge undo for everyone. (When a host IS present, only the host undoes
  // and no lock is needed — that gate lives in game.ts's evaluateUndoPolicy.)
  private static readonly UNDO_LOCK_STALE_MS = 12000;

  // Try to take the undo lock. Returns true if this device now holds it (freshly, or already did).
  // Aborts (false) if another device holds a non-stale lock.
  public async acquireUndoLock(): Promise<boolean> {
    if (!this.gameId || !isFirebaseConfigured()) return true; // local game — no coordination
    const database = getFirebaseDatabase();
    const uid = getCurrentUser()?.uid ?? null;
    if (!database || !uid) return false;
    const lockRef = ref(database, `games/${this.gameId}/undoLock`);
    const now = Date.now();
    try {
      const result = await runTransaction(lockRef, (cur: { uid: string; ts: number } | null) => {
        if (cur && cur.uid !== uid && now - (cur.ts || 0) < FirebaseGameManager.UNDO_LOCK_STALE_MS) {
          return; // another device holds a fresh lock — abort
        }
        return { uid, ts: now };
      });
      const held = result.committed && (result.snapshot.val() as { uid: string } | null)?.uid === uid;
      if (held) onDisconnect(lockRef).remove();
      return held;
    } catch (error) {
      console.error('Error acquiring undo lock:', error);
      return false;
    }
  }

  // Release the undo lock, but only if this device still holds it (never clobber a newer holder).
  public async releaseUndoLock(): Promise<void> {
    if (!this.gameId || !isFirebaseConfigured()) return;
    const database = getFirebaseDatabase();
    const uid = getCurrentUser()?.uid ?? null;
    if (!database || !uid) return;
    const lockRef = ref(database, `games/${this.gameId}/undoLock`);
    try {
      await onDisconnect(lockRef).cancel();
      await runTransaction(lockRef, (cur: { uid: string } | null) => {
        if (cur && cur.uid !== uid) return cur; // not ours — leave it
        return null;
      });
    } catch (error) {
      console.error('Error releasing undo lock:', error);
    }
  }

  // Series-advance coordination (agreed 2026-07-19)
  // ==============================================
  // When a host is present, only the host advances to the next game (so everyone can read the
  // stats first) — that gate lives in game.ts. In a HOSTLESS game the first player to advance
  // writes a `seriesAdvance` request; every device shows a ~5s countdown that ANY player may
  // cancel, and the initiator performs the advance at the deadline if it wasn't cancelled.
  public static readonly SERIES_ADVANCE_DELAY_MS = 5000;
  private seriesAdvancePending: { by: string; ts: number } | null = null;
  private seriesAdvanceCallback: ((_pending: { by: string; ts: number } | null) => void) | null = null;

  // The current pending series-advance request (null when none), for the countdown UI.
  public getSeriesAdvancePending(): { by: string; ts: number } | null {
    return this.seriesAdvancePending;
  }

  // Subscribe to changes in the pending series-advance request. Fires on the initial value and on
  // every change (start / cancel), so all devices show or hide the countdown together.
  public setSeriesAdvanceCallback(callback: (_pending: { by: string; ts: number } | null) => void): void {
    this.seriesAdvanceCallback = callback;
  }

  // Start (or refresh) a series-advance request for this device. Idempotent-ish: re-requesting just
  // restamps it. The written `ts` anchors the shared countdown deadline so every device agrees.
  public async requestSeriesAdvance(): Promise<boolean> {
    if (!this.gameId || !isFirebaseConfigured()) return false;
    const database = getFirebaseDatabase();
    const uid = getCurrentUser()?.uid ?? null;
    if (!database || !uid) return false;
    const advRef = ref(database, `games/${this.gameId}/seriesAdvance`);
    try {
      const payload = { by: uid, ts: Date.now() };
      onDisconnect(advRef).remove(); // a dropped initiator cancels the pending advance
      await set(advRef, payload);
      return true;
    } catch (error) {
      console.error('Error requesting series advance:', error);
      return false;
    }
  }

  // Cancel any pending series-advance request (any player may cancel).
  public async cancelSeriesAdvance(): Promise<void> {
    if (!this.gameId || !isFirebaseConfigured()) return;
    const database = getFirebaseDatabase();
    if (!database) return;
    const advRef = ref(database, `games/${this.gameId}/seriesAdvance`);
    try {
      await onDisconnect(advRef).cancel();
      await set(advRef, null);
    } catch (error) {
      console.error('Error cancelling series advance:', error);
    }
  }

  // Manual-override ("score on one device") flag. This is a per-device preference, NOT
  // part of the synced game state, so it never leaves this client. When on, turn-gating
  // is bypassed and any input on this device is accepted.
  private manualOverride = false;

  public isManualOverride(): boolean {
    return this.manualOverride;
  }

  public setManualOverride(value: boolean): void {
    this.manualOverride = value;
  }

  // Presence (Phase 8)
  // ==================

  // Begin tracking who is connected to this game. Idempotent — safe to call again after
  // auth resolves. Subscribes to the presence node (to know who is online) and, whenever
  // this client is connected, writes its own presence with an onDisconnect cleanup so a
  // dropped/closed tab is removed automatically. Re-runs the UI on changes so turn-gating
  // can fall back to manual when the responsible seat goes offline.
  public setupPresence(): void {
    if (!this.gameId || !isFirebaseConfigured()) return;
    const database = getFirebaseDatabase();
    if (!database) return;

    // Always (re)announce for the current user — auth may have resolved since last call.
    this.announcePresence();

    if (this.presenceInitialized) return;
    this.presenceInitialized = true;

    const presenceRef = ref(database, `games/${this.gameId}/presence`);
    const unsubscribePresence = onValue(presenceRef, (snapshot) => {
      const val = (snapshot.val() as Record<string, unknown> | null) || {};
      this.presentDevices = parsePresence(val);
      this.presentUids = new Set(this.presentDevices.keys());
      // Presence affects who may act, so refresh the UI (re-evaluates gating).
      if (this.uiUpdateCallback) this.uiUpdateCallback(this.state);
      // A presence change may mean the host just vanished — consider auto-promoting a new one.
      this.maybePromoteHost();
    });
    this.listeners.push(() => off(presenceRef, 'value', unsubscribePresence));

    // Re-announce on every (re)connect so presence survives network blips.
    const connectedRef = ref(database, '.info/connected');
    const unsubscribeConnected = onValue(connectedRef, (snapshot) => {
      if (snapshot.val() === true) this.announcePresence();
    });
    this.listeners.push(() => off(connectedRef, 'value', unsubscribeConnected));
  }

  // Write this client's presence for the signed-in user (no-op if signed out). Presence is keyed
  // by uid AND deviceId, so one account signed in on two devices is two entries: the phone can be
  // playing while the laptop spectates. Keying by uid alone made those indistinguishable, which
  // is why "is this player's only client in spectator mode" was previously unanswerable.
  // The onDisconnect handler removes just THIS device when its connection drops.
  public announcePresence(): void {
    if (!this.gameId || !isFirebaseConfigured()) return;
    const database = getFirebaseDatabase();
    const uid = getCurrentUser()?.uid;
    if (!database || !uid) return;

    const presenceRef = ref(database, `games/${this.gameId}/presence/${uid}/${this.getDeviceId()}`);
    onDisconnect(presenceRef).remove();
    set(presenceRef, { mode: this.getDeviceRole(), ts: Date.now() })
      .catch(() => { /* queued while offline; non-fatal */ });
  }

  // Stable per-browser id, so two devices on one account are distinguishable. Persisted, because
  // a fresh id per page load would leak stale presence entries until their onDisconnect fired.
  private deviceId: string | null = null;
  private getDeviceId(): string {
    if (this.deviceId) return this.deviceId;
    let id: string | null = null;
    try {
      id = localStorage.getItem('pepperDeviceId');
      if (!id) {
        id = `d${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
        localStorage.setItem('pepperDeviceId', id);
      }
    } catch {
      // localStorage unavailable (private mode): fall back to a per-session id.
      id = `d${Math.random().toString(36).slice(2, 10)}`;
    }
    this.deviceId = id;
    return id;
  }

  // This device's role for this game. Defaults to `player` when seated and `spectator` when not,
  // which matches what the rules will actually let the device do. `host` is set only alongside a
  // successful claim of metadata/currentHost (Phase C).
  private deviceRole: DeviceRole | null = null;

  public getDeviceRole(): DeviceRole {
    return this.deviceRole ?? (this.getMySeat() !== null ? 'player' : 'spectator');
  }

  // Set this device's role and re-announce so other clients see the change immediately.
  public setDeviceRole(role: DeviceRole): void {
    if (this.deviceRole === role) return;
    this.deviceRole = role;
    this.announcePresence();
  }

  // Has the presence node reported at least once? Until it has, callers should not treat
  // "nobody present" as grounds to drop turn-gating (avoids a first-paint race).
  public hasPresenceData(): boolean {
    return this.presentUids.size > 0;
  }

  // Is the authenticated player seated at `seat` currently online? An unauthenticated or
  // empty seat is never "present" (no one can be waited on), which lets gating fall back.
  public isSeatPresent(seat: number): boolean {
    const uid = this.firebasePlayers[seat]?.userId;
    return uid ? this.presentUids.has(uid) : false;
  }

  // The roles of every connected device for `uid` (empty when that user has none online).
  public getPresentRoles(uid: string): DeviceRole[] {
    return this.presentDevices.get(uid) ?? [];
  }

  // Does the player at `seat` have at least one connected device in `player` mode? This is the
  // question the auction actually needs: a seat whose only device is spectating cannot bid, so
  // the concurrent auction must not wait on it. Keying presence by uid alone could not answer
  // this — the phone playing and the laptop spectating were the same entry.
  public seatHasPlayerDevice(seat: number): boolean {
    const uid = this.firebasePlayers[seat]?.userId;
    if (!uid) return false;
    return this.getPresentRoles(uid).includes('player');
  }

  // Are all four seats represented by a connected device in `player` mode? Phase D uses this to
  // derive player-driven vs host-driven rather than storing a global mode.
  public allSeatsHavePlayerDevice(): boolean {
    return [0, 1, 2, 3].every(seat => this.seatHasPlayerDevice(seat));
  }

  // Bidding auction (Phase 8b)
  // ==========================

  // The live auction state for the current hand, or null when none is active.
  public getAuction(): AuctionState | null {
    return this.auctionState;
  }

  // RTDB drops empty objects/arrays, so a round-tripped auction may be missing `entries`
  // or `order`. Restore the shape the pure engine expects.
  private normalizeAuction(raw: AuctionState): AuctionState {
    return {
      handIndex: raw.handIndex,
      order: raw.order || [],
      entries: raw.entries || {},
    };
  }

  // Create the auction for the current hand if one isn't already present for it. Idempotent
  // and race-safe (runs in a transaction), so every device may call it on entering the
  // bidder phase. No-op outside the bidder phase or for local games.
  public async ensureAuctionForCurrentHand(): Promise<void> {
    if (!this.gameId || !isFirebaseConfigured()) return;
    const database = getFirebaseDatabase();
    if (!database) return;

    const handIndex = this.state.hands.length - 1;
    const hand = this.getCurrentHand();
    if (getCurrentPhase(hand) !== 'bidder') return;
    const dealerSeat = parseInt(hand[0] || '1');

    const biddingRef = ref(database, `games/${this.gameId}/bidding`);
    try {
      await runTransaction(biddingRef, (remote: AuctionState | null) => {
        const state = remote ? this.normalizeAuction(remote) : null;
        if (state && state.handIndex === handIndex) return state; // already initialized
        return createAuction(dealerSeat, handIndex);
      });
    } catch (error) {
      console.error('Error initializing auction:', error);
    }
  }

  // Run a transactional mutation of the auction for `expectedHandIndex`. Aborts (no write)
  // if the remote auction is missing or for a different hand, or if `fn` rejects the action
  // (e.g. an out-of-turn submit racing another device). Returns the committed state, or null.
  private async mutateAuction(
    expectedHandIndex: number,
    // eslint-disable-next-line no-unused-vars
    fn: (state: AuctionState) => AuctionState
  ): Promise<AuctionState | null> {
    if (!this.gameId || !isFirebaseConfigured()) return null;
    const database = getFirebaseDatabase();
    if (!database) return null;

    const biddingRef = ref(database, `games/${this.gameId}/bidding`);
    try {
      const txn = await runTransaction(biddingRef, (remote: AuctionState | null) => {
        const state = remote ? this.normalizeAuction(remote) : null;
        if (!state || state.handIndex !== expectedHandIndex) return; // abort: missing/stale
        try {
          return fn(state);
        } catch {
          return; // abort: the engine rejected this action (e.g. not this seat's turn)
        }
      });

      if (txn.committed && txn.snapshot.exists()) {
        const committed = this.normalizeAuction(txn.snapshot.val() as AuctionState);
        this.auctionState = committed;
        return committed;
      }
    } catch (error) {
      console.error('Error mutating auction:', error);
    }
    return null;
  }

  // Enter (or re-enter / edit) this seat's bid, optionally with a pre-picked trump. Concurrent:
  // any seated player may enter at any time; the engine rejects an edit once the seat's bid is
  // locked (aborting the transaction). If this entry completes the auction with a trump-bearing
  // winner (or a throw-in), this (online) device applies the result to the hand exactly once.
  public async enterBid(seat: number, value: ActionValue, suit?: TrumpSuit): Promise<void> {
    const handIndex = this.state.hands.length - 1;
    const committed = await this.mutateAuction(handIndex, s => enterBid(s, seat, value, suit));
    if (committed) await this.maybeApplyAuction(committed, handIndex);
  }

  // Set or change this seat's trump on its existing non-pass bid (a separate, longer window than
  // the bid edit). Setting the winner's trump is what finishes a hand whose bidding filled first.
  public async setTrump(seat: number, suit: TrumpSuit): Promise<void> {
    const handIndex = this.state.hands.length - 1;
    const committed = await this.mutateAuction(handIndex, s => setTrump(s, seat, suit));
    if (committed) await this.maybeApplyAuction(committed, handIndex);
  }

  // How long the completed auction stays on screen (final reveal) before the hand advances.
  private static readonly AUCTION_REVEAL_MS = 2800;

  // Apply a completed auction to the hand once its outcome is fully determined: a throw-in, or a
  // winner that has picked a trump. A completed auction whose winner still owes a trump is held
  // until setTrump provides it. When ready, hold briefly so every device shows the final reveal
  // (who bid what) instead of snapping straight to the decision phase — especially when the winner
  // pre-picked trump and the hand would otherwise resolve instantly. applyAuctionToHand is guarded
  // against double application, so the delayed call is safe.
  private async maybeApplyAuction(state: AuctionState, handIndex: number): Promise<void> {
    if (!auctionIsComplete(state)) return;
    const result = auctionResult(state);
    if (!result) return;
    if (!result.thrownIn && result.winningSuit === null) return; // winner still owes a trump
    setTimeout(() => {
      this.applyAuctionToHand(state, handIndex).catch(err => console.error('applyAuctionToHand:', err));
    }, FirebaseGameManager.AUCTION_REVEAL_MS);
  }

  // Translate a completed auction into the hand encoding: bidder + bid (+ pre-picked trump),
  // or a throw-in. Applied once, by the device whose action completed the auction, and only
  // while the hand is still awaiting the bidder (guards against double application).
  private async applyAuctionToHand(state: AuctionState, handIndex: number): Promise<void> {
    const result = auctionResult(state);
    if (!result) return;
    if (this.state.hands.length - 1 !== handIndex) return;
    if (getCurrentPhase(this.getCurrentHand()) !== 'bidder') return;

    // Close the reveal-delay race with a host takeover: the delayed timer that scheduled us
    // captured a snapshot of the completed auction, but the host may have ABORTED it (cleared the
    // bidding node) and declared a winner directly during the 2.8s reveal. Re-read the node — if
    // it is gone or now for a different hand, the host's decision is authoritative; do not apply.
    const database = getFirebaseDatabase();
    if (database) {
      const snap = await get(ref(database, `games/${this.gameId}/bidding`));
      if (!snap.exists()) return; // aborted by a host takeover
      const live = this.normalizeAuction(snap.val() as AuctionState);
      if (live.handIndex !== handIndex) return; // node was recycled for a later hand
    }

    const parts: string[] = result.thrownIn
      ? ['0']
      : [String(result.winnerSeat), result.winningBid as string,
         ...(result.winningSuit ? [result.winningSuit] : [])];

    // Apply through the base GameManager (no per-part sync), then sync once.
    for (const part of parts) {
      GameManager.prototype.addHandPart.call(this, part);
    }
    await this.syncToFirebase();
  }

  // Abort the live auction by clearing the bidding node. The current host uses this to take over a
  // running auction (the rules grant the host `bidding` writes). Because a device with a pending
  // reveal timer re-reads this node in applyAuctionToHand, clearing it here also cancels any
  // natural application in flight — making the host's takeover authoritative and immediate.
  public async abortAuction(): Promise<void> {
    if (!this.gameId || !isFirebaseConfigured()) return;
    const database = getFirebaseDatabase();
    if (!database) return;
    await set(ref(database, `games/${this.gameId}/bidding`), null);
    this.auctionState = null;
  }

  // Host takeover of a live auction: declare the bid winner directly (seat 0 = throw-in), exactly
  // like the non-Firebase tap flow. Aborts the auction first so no pending reveal can clobber the
  // host's decision, then writes the bidder part. A non-throw-in leaves the hand in the `bid`
  // phase, from which the host flows through the normal bid/trump tap controls (evaluateGating
  // already permits the host); a throw-in (0) completes the hand outright.
  public async hostTakeoverBidder(bidWinnerSeat: number): Promise<void> {
    if (getCurrentPhase(this.getCurrentHand()) !== 'bidder') return;
    await this.abortAuction();
    GameManager.prototype.addHandPart.call(this, String(bidWinnerSeat));
    await this.syncToFirebase();
  }

  // Public method to force sync current state to Firebase
  public async forceSyncToFirebase(): Promise<void> {
    return this.syncToFirebase();
  }

  // Set UI update callback for real-time updates
  public setUIUpdateCallback(callback: (_state: GameState) => void): void {
    this.uiUpdateCallback = callback;
  }

  // Setup real-time listener for external UI updates
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, no-unused-vars
  async setupRealtimeListener(_onUpdate: (_gameState: GameState) => void): Promise<() => void> {
    if (!this.gameId || !isFirebaseConfigured()) {
      // Return no-op for local games
      return () => {};
    }

    const database = getFirebaseDatabase();
    if (!database) {
      return () => {};
    }

    const gameStateRef = ref(database, `games/${this.gameId}/gameState`);

    const unsubscribe = onValue(gameStateRef, (snapshot) => {
      if (snapshot.exists()) {
        this.applyRemoteState(snapshot.val() as GameState);
      }
    });

    // Store the unsubscribe function
    this.listeners.push(() => off(gameStateRef, 'value', unsubscribe));

    return () => off(gameStateRef, 'value', unsubscribe);
  }

  // Monitor realtime-database connection state (Phase 7). Fires the callback with the
  // current connectivity whenever it changes. While offline, Firebase queues writes and
  // flushes them on reconnect; local state is also persisted to localStorage on every
  // change, so play continues seamlessly. Returns an unsubscribe function.
  public monitorConnection(callback?: (_connected: boolean) => void): () => void {
    if (!isFirebaseConfigured()) return () => {};

    const database = getFirebaseDatabase();
    if (!database) return () => {};

    const connectedRef = ref(database, '.info/connected');
    const unsubscribe = onValue(connectedRef, (snapshot) => {
      const connected = snapshot.val() === true;
      this.online = connected;
      if (callback) callback(connected);
    });

    this.connectionListener = () => off(connectedRef, 'value', unsubscribe);
    this.listeners.push(this.connectionListener);
    return this.connectionListener;
  }

  // Current connectivity as last reported by monitorConnection (defaults to online).
  public getOnlineStatus(): boolean {
    return this.online;
  }

  // Clean up listeners

  // Get user's active games
  static async getUserActiveGames(userId: string): Promise<Array<{ id: string; metadata: FirebaseGameMetadata; teams: [string, string]; scores: [number, number]; hands: number }>> {
    if (!isFirebaseConfigured()) return [];

    const database = getFirebaseDatabase();
    if (!database) return [];

    try {
      const userGamesRef = ref(database, `userGames/${userId}`);
      const snapshot = await get(userGamesRef);

      if (!snapshot.exists()) {
        return [];
      }

      const gameIds = Object.keys(snapshot.val());
      const activeGames = [];

      for (const gameId of gameIds) {
        const gameRef = ref(database, `games/${gameId}`);
        const gameSnapshot = await get(gameRef);

        if (gameSnapshot.exists()) {
          const gameData = gameSnapshot.val() as FirebaseGameData;

          if (gameData.metadata.status !== 'completed') {
            activeGames.push({
              id: gameId,
              metadata: gameData.metadata,
              teams: gameData.teams,
              scores: gameData.gameState?.scores || [0, 0],
              hands: gameData.gameState?.hands?.length || 0
            });
          }
        }
      }
      return activeGames;
    } catch (error) {
      console.error('Error getting user active games:', error);
      return [];
    }
  }

  // Delete a specific game and remove from all users' active games
  static async deleteGame(gameId: string): Promise<boolean> {
    if (!isFirebaseConfigured()) return false;

    const database = getFirebaseDatabase();
    if (!database) return false;

    try {
      // Get the game data to find all participants
      const gameRef = ref(database, `games/${gameId}`);
      const gameSnapshot = await get(gameRef);

      if (gameSnapshot.exists()) {
        const gameData = gameSnapshot.val() as FirebaseGameData;

        // Remove from creator's user games
        if (gameData.metadata.createdBy) {
          const creatorGameRef = ref(database, `userGames/${gameData.metadata.createdBy}/${gameId}`);
          await remove(creatorGameRef);
        }

        // Remove from all authenticated players' user games
        for (const player of gameData.players || []) {
          if (player.userId) {
            const playerGameRef = ref(database, `userGames/${player.userId}/${gameId}`);
            await remove(playerGameRef);
          }
        }
      }

      // Delete the game itself
      await remove(gameRef);

      return true;
    } catch (error) {
      console.error('Error deleting game:', error);
      return false;
    }
  }

  // Find and delete abandoned games for a user
  static async cleanupAbandonedGames(userId: string): Promise<{ count: number; deletedGames: string[] }> {
    if (!isFirebaseConfigured()) return { count: 0, deletedGames: [] };

    const database = getFirebaseDatabase();
    if (!database) return { count: 0, deletedGames: [] };

    try {
      const userGamesRef = ref(database, `userGames/${userId}`);
      const snapshot = await get(userGamesRef);

      if (!snapshot.exists()) {
        return { count: 0, deletedGames: [] };
      }

      const gameIds = Object.keys(snapshot.val());
      const abandonedGames: string[] = [];

      // Check each game to see if it's abandoned
      for (const gameId of gameIds) {
        const gameRef = ref(database, `games/${gameId}`);
        const gameSnapshot = await get(gameRef);

        if (!gameSnapshot.exists()) {
          // Game doesn't exist, remove from user's list
          const userGameRef = ref(database, `userGames/${userId}/${gameId}`);
          await remove(userGameRef);
          abandonedGames.push(gameId);
        } else {
          const gameData = gameSnapshot.val() as FirebaseGameData;

          // Consider a game abandoned if:
          // 1. It has no hands played (stuck in setup)
          // 2. It hasn't been updated in over 30 days
          const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
          const lastUpdated = gameData.metadata.lastUpdated || gameData.metadata.createdAt;
          const hasNoProgress = !gameData.gameState?.hands || gameData.gameState.hands.length === 0;
          const isStale = lastUpdated < thirtyDaysAgo;

          if ((hasNoProgress && isStale) || gameData.metadata.status === 'completed') {
            try {
              await this.deleteGame(gameId);
              abandonedGames.push(gameId);
            } catch (error) {
              console.warn(`Failed to delete abandoned game ${gameId}:`, error);
            }
          }
        }
      }

      return { count: abandonedGames.length, deletedGames: abandonedGames };
    } catch (error) {
      console.error('Error cleaning up abandoned games:', error);
      return { count: 0, deletedGames: [] };
    }
  }

  // Delete all game data for a user
  static async deleteAllUserData(userId: string): Promise<boolean> {
    if (!isFirebaseConfigured()) return false;

    const database = getFirebaseDatabase();
    if (!database) return false;

    try {
      // Get all the user's games
      const userGamesRef = ref(database, `userGames/${userId}`);
      const snapshot = await get(userGamesRef);

      if (snapshot.exists()) {
        const gameIds = Object.keys(snapshot.val());

        // Delete each game (this will also clean up references)
        for (const gameId of gameIds) {
          try {
            await this.deleteGame(gameId);
          } catch (error) {
            console.warn(`Failed to delete game ${gameId} during user data cleanup:`, error);
          }
        }
      }

      // Remove the user's games list
      await remove(userGamesRef);

      // Remove the user's profile
      const userRef = ref(database, `users/${userId}`);
      await remove(userRef);

      return true;
    } catch (error) {
      console.error('Error deleting user data:', error);
      return false;
    }
  }

  // Series Management Methods
  // =========================

  // Create a new series in Firebase when converting to series mode
  private async createFirebaseSeries(): Promise<string> {
    if (!isFirebaseConfigured() || !this.gameId) return '';

    const database = getFirebaseDatabase();
    const currentUser = getCurrentUser();
    if (!database || !currentUser) return '';

    try {
      // First check if this game already has a series (race condition protection)
      const gameMetadataRef = ref(database, `games/${this.gameId}/metadata/seriesId`);
      const existingSeriesSnapshot = await get(gameMetadataRef);

      if (existingSeriesSnapshot.exists()) {
        // Another player already created the series
        const existingSeriesId = existingSeriesSnapshot.val() as string;
        this.seriesId = existingSeriesId;
        this.setupSeriesListener();
        return existingSeriesId;
      }

      // Get current game data to preserve player info
      const currentGameRef = ref(database, `games/${this.gameId}`);
      const currentGameSnapshot = await get(currentGameRef);

      if (!currentGameSnapshot.exists()) {
        console.error('Current game not found when creating series');
        return '';
      }

      const currentGameData = currentGameSnapshot.val() as FirebaseGameData;
      const seriesId = push(ref(database, 'series')).key!;

      const seriesData: FirebaseSeriesData = {
        metadata: {
          createdBy: currentUser.uid,
          createdAt: Date.now(),
          status: 'active'
        },
        // Use actual player data from the current game instead of generic array
        players: currentGameData.players,
        teams: this.state.teams as [string, string],
        currentGameId: this.gameId,
        gameIds: [this.gameId],
        seriesScores: this.state.seriesScores as [number, number] || [0, 0]
      };

      // Save series data
      const seriesRef = ref(database, `series/${seriesId}`);
      await set(seriesRef, seriesData);

      // Update current game to link to series
      const gameRef = ref(database, `games/${this.gameId}/metadata/seriesId`);
      await set(gameRef, seriesId);

      // Set up series listener
      this.seriesId = seriesId;
      this.setupSeriesListener();

      return seriesId;
    } catch (error) {
      console.error('Error creating Firebase series:', error);
      return '';
    }
  }

  // Set up listener for series changes (new games added)
  private setupSeriesListener() {
    if (!isFirebaseConfigured() || !this.seriesId) return;

    const database = getFirebaseDatabase();
    if (!database) return;

    const seriesRef = ref(database, `series/${this.seriesId}`);

    const unsubscribe = onValue(seriesRef, (snapshot) => {
      if (snapshot.exists()) {
        const seriesData = snapshot.val() as FirebaseSeriesData;

        // Check if there's a new current game
        if (seriesData.currentGameId !== this.gameId) {
          // Show notification about new game
          this.notifyNewGameInSeries(seriesData.currentGameId);
        }
      }
    });

    this.seriesListener = () => off(seriesRef, 'value', unsubscribe);
  }

  // Notify UI about new game in series
  private notifyNewGameInSeries(newGameId: string) {
    // Remove any existing game notifications to avoid spam
    const existingNotifications = document.querySelectorAll('.new-game-notification');
    existingNotifications.forEach(notif => notif.remove());

    const notification = document.createElement('div');
    notification.className = 'new-game-notification fixed top-4 right-4 bg-blue-600 text-white p-4 rounded-lg shadow-lg z-50 animate-bounce';
    notification.innerHTML = `
      <div class="flex items-center space-x-3">
        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path>
        </svg>
        <div>
          <p class="font-medium">🎮 New Game Started!</p>
          <p class="text-sm">A new game has been started in this series.</p>
        </div>
        <button onclick="this.parentElement.parentElement.remove()" class="text-white hover:text-gray-200">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
          </svg>
        </button>
      </div>
      <div class="mt-3 flex space-x-2">
        <button onclick="window.location.href='${getPath('/game?id=' + newGameId)}'" class="bg-white text-blue-600 px-3 py-1 rounded text-sm font-medium hover:bg-gray-100 transition-colors">
          Join Game
        </button>
        <button onclick="this.parentElement.parentElement.remove()" class="bg-blue-700 text-white px-3 py-1 rounded text-sm hover:bg-blue-800 transition-colors">
          Dismiss
        </button>
      </div>
    `;

    document.body.appendChild(notification);

    // Auto-dismiss after 20 seconds (longer for important notifications)
    setTimeout(() => {
      if (notification.parentElement) {
        notification.remove();
      }
    }, 20000);
  }

  // Override convertToSeries to create Firebase series
  override convertToSeries(): Promise<void> {
    // Create Firebase series if we don't have one
    if (!this.seriesId) {
      return this.createFirebaseSeries().then(seriesId => {
        if (seriesId) {
          console.log('Firebase series ready:', seriesId);
          // Only call super.convertToSeries() and sync after Firebase series is ready
          super.convertToSeries();
          this.syncToFirebase();
        } else {
          // Fallback to local series if Firebase fails
          super.convertToSeries();
          this.syncToFirebase();
        }
      }).catch(error => {
        console.error('Error creating Firebase series, falling back to local:', error);
        super.convertToSeries();
        this.syncToFirebase();
      });
    } else {
      // Series already exists, just convert locally
      super.convertToSeries();
      this.syncToFirebase();
      return Promise.resolve();
    }
  }

  // Override startNextGame to create a new Firebase game in the series. Fire-and-forget so the base
  // signature stays `void`; callers who need to sequence should use advanceSeriesAndNavigate()
  // directly. IMPORTANT: this method OWNS navigation — a caller must NOT also reload/navigate, or
  // the two race (the "Make it a Series did nothing but reload" bug: the caller's reload landed
  // before this navigation, bouncing the table back to the completed game every time).
  override startNextGame(): void {
    void this.advanceSeriesAndNavigate();
  }

  // Awaitable series advance: create the next game (or fall back to the same node) and navigate to
  // it. Shared by the normal Next Game flow and the host force-advance failsafe. Resolves once
  // navigation has been initiated (or the local fallback synced).
  public async advanceSeriesAndNavigate(): Promise<void> {
    if (!this.state.isSeries || !this.seriesId) {
      // Fallback path: the new game re-uses the current game node, so carry the sync version
      // forward (super.startNextGame() rebuilds state without a version; without this the
      // transaction would treat the higher-versioned completed game still on the node as "newer"
      // and revert our fresh game). Guard the advance so a double call can't throw.
      if (this.isGameComplete()) {
        const prevVersion = FirebaseGameManager.versionOf(this.state);
        super.startNextGame();
        this.state.version = prevVersion;
        await this.syncToFirebase();
      }
      window.location.reload();
      return;
    }

    const newGameId = await this.createNextGameInSeries();
    if (newGameId) {
      window.location.href = getPath('/game?id=' + newGameId);
    } else {
      // Same-node fallback — again guarded against a double advance.
      if (this.isGameComplete()) {
        const prevVersion = FirebaseGameManager.versionOf(this.state);
        super.startNextGame();
        this.state.version = prevVersion;
        await this.syncToFirebase();
      }
      window.location.reload();
    }
  }

  // Host force-advance failsafe (real-game feedback 2026-07-21): if the normal Next Game flow ever
  // gets stuck, the host can force it. If the series already advanced past this game (a next game
  // was created but the initiator never navigated), just GO there — don't spawn a duplicate.
  // Otherwise create the next game as usual. Safe to call repeatedly.
  public async forceAdvanceSeries(): Promise<void> {
    if (!isFirebaseConfigured()) { await this.advanceSeriesAndNavigate(); return; }
    const database = getFirebaseDatabase();
    if (!this.state.isSeries || !this.seriesId) { await this.convertToSeries(); }
    if (database && this.seriesId) {
      try {
        const snap = await get(ref(database, `series/${this.seriesId}/currentGameId`));
        const currentGameId = snap.exists() ? (snap.val() as string) : null;
        if (currentGameId && currentGameId !== this.gameId) {
          window.location.href = getPath('/game?id=' + currentGameId);
          return;
        }
      } catch (error) {
        console.error('Error checking series current game for force-advance:', error);
      }
    }
    await this.advanceSeriesAndNavigate();
  }

  // Create next game in Firebase series
  private async createNextGameInSeries(): Promise<string> {
    if (!isFirebaseConfigured() || !this.seriesId) return '';

    const database = getFirebaseDatabase();
    const currentUser = getCurrentUser();
    if (!database || !currentUser) return '';

    try {
      // Get the original game data to preserve player authentication info
      const originalGameRef = ref(database, `games/${this.gameId}`);
      const originalGameSnapshot = await get(originalGameRef);

      if (!originalGameSnapshot.exists()) {
        console.error('Original game not found when creating next game in series');
        return '';
      }

      const originalGameData = originalGameSnapshot.val() as FirebaseGameData;

      // Progress the series locally to get the fresh next-game state — but only if we haven't
      // already (a retried/forced call may find local state already advanced; advancing again would
      // throw "current game not complete").
      if (this.isGameComplete()) {
        super.startNextGame();
      }

      // Create new game in Firebase
      const newGameId = push(ref(database, 'games')).key!;

      const gameData: FirebaseGameData = {
        metadata: {
          createdBy: currentUser.uid,
          createdAt: Date.now(),
          status: 'active',
          seriesId: this.seriesId
        },
        // Preserve original player authentication info
        players: originalGameData.players,
        teams: this.state.teams as [string, string],
        gameState: this.state
      };

      // Save new game
      const gameRef = ref(database, `games/${newGameId}`);
      await set(gameRef, gameData);

      // Add the new game to all original participants' userGames collections
      // This is the critical fix - ensures all players can see the new series game
      const userGameUpdates: Promise<void>[] = [];

      for (const player of originalGameData.players) {
        if (player.userId) {
          const userGameRef = ref(database, `userGames/${player.userId}/${newGameId}`);
          userGameUpdates.push(set(userGameRef, true));
        }
      }

      // Also ensure the series creator is included
      if (!originalGameData.players.some(p => p.userId === currentUser.uid)) {
        const creatorGameRef = ref(database, `userGames/${currentUser.uid}/${newGameId}`);
        userGameUpdates.push(set(creatorGameRef, true));
      }

      // Wait for all user game additions to complete
      await Promise.all(userGameUpdates);

      // Update series to point to new game
      const seriesRef = ref(database, `series/${this.seriesId}`);
      const seriesSnapshot = await get(seriesRef);

      if (seriesSnapshot.exists()) {
        const seriesData = seriesSnapshot.val() as FirebaseSeriesData;

        const updatedSeries: FirebaseSeriesData = {
          ...seriesData,
          currentGameId: newGameId,
          gameIds: [...seriesData.gameIds, newGameId],
          seriesScores: this.state.seriesScores as [number, number],
          metadata: {
            ...seriesData.metadata,
            lastUpdated: Date.now()
          }
        };

        if (this.state.seriesWinner !== undefined) {
          updatedSeries.seriesWinner = this.state.seriesWinner;
          updatedSeries.metadata.status = 'completed';
        }

        await set(seriesRef, updatedSeries);
      }

      return newGameId;
    } catch (error) {
      console.error('Error creating next game in series:', error);
      return '';
    }
  }

  // Clean up all listeners
  public destroy() {
    // Clean up series listener
    if (this.seriesListener) {
      this.seriesListener();
      this.seriesListener = null;
    }

    // Clean up game listeners (this also unsubscribes the connection monitor, which is
    // registered in this.listeners by monitorConnection).
    this.listeners.forEach(unsubscribe => unsubscribe());
    this.listeners = [];
    this.connectionListener = null;
    this.stateChangeListeners = [];
    this.clearHostPromotion();
  }

  // Set up victory overlay listener to monitor for series creation by other players
  public setupVictoryOverlaySeriesListener() {
    if (!isFirebaseConfigured() || !this.gameId) return;

    const database = getFirebaseDatabase();
    if (!database) return;

    // Listen to changes in the current game's metadata for series creation
    const gameMetadataRef = ref(database, `games/${this.gameId}/metadata`);

    const unsubscribe = onValue(gameMetadataRef, (snapshot) => {
      if (snapshot.exists()) {
        const metadata = snapshot.val() as FirebaseGameMetadata;

        // If a seriesId was added and we don't have one yet, another player created the series
        if (metadata.seriesId && !this.seriesId) {
          this.seriesId = metadata.seriesId;
          this.setupVictoryOverlaySeriesWatcher(); // Set up series monitoring
          this.updateVictoryOverlayForExistingSeries(metadata.seriesId);
        }
      }
    });

    // Store the listener for cleanup
    this.listeners.push(() => off(gameMetadataRef, 'value', unsubscribe));

    // Also listen for changes in series data if we already have a series
    if (this.seriesId) {
      this.setupVictoryOverlaySeriesWatcher();
    }
  }

  // Enhanced series watcher specifically for victory overlay updates
  private setupVictoryOverlaySeriesWatcher() {
    if (!isFirebaseConfigured() || !this.seriesId) return;

    const database = getFirebaseDatabase();
    if (!database) return;

    const seriesRef = ref(database, `series/${this.seriesId}`);

    const unsubscribe = onValue(seriesRef, (snapshot) => {
      if (snapshot.exists()) {
        const seriesData = snapshot.val() as FirebaseSeriesData;

        // Check if a new game has been started in this series
        if (seriesData.currentGameId !== this.gameId) {
          // Another browser started the next game!
          this.showNextGameModal(seriesData.currentGameId);
        }
      }
    });

    // Store the listener for cleanup
    this.listeners.push(() => off(seriesRef, 'value', unsubscribe));
  }

  // Update victory overlay when series already exists
  private async updateVictoryOverlayForExistingSeries(seriesId: string) {
    try {
      const database = getFirebaseDatabase();
      if (!database) return;

      // Show notification that series was created
      this.showSeriesCreatedNotification(seriesId);

      // Get the series data to find the current game
      const seriesRef = ref(database, `series/${seriesId}`);
      const seriesSnapshot = await get(seriesRef);

      if (seriesSnapshot.exists()) {
        const seriesData = seriesSnapshot.val() as FirebaseSeriesData;

        // Update button text and functionality for both victory overlays
        this.updateSeriesButtons(seriesData.currentGameId);
      }
    } catch (error) {
      console.error('Error updating victory overlay for existing series:', error);
    }
  }

  // Update series button text and click handlers
  private updateSeriesButtons(currentGameId: string) {
    // Update regular victory buttons
    const victorySeriesBtn = document.getElementById('victory-series-btn');
    const victoryNewSeriesBtn = document.getElementById('victory-new-series-btn');

    // Update post-victory buttons
    const postVictorySeriesBtn = document.getElementById('post-victory-series-btn');
    const postVictoryNewSeriesBtn = document.getElementById('post-victory-new-series-btn');

    // Function to update a button to "Join Next Game"
    // eslint-disable-next-line @typescript-eslint/no-unused-vars, no-unused-vars
    const updateToJoinButton = (button: HTMLElement | null, _isPostVictory = false) => {
      if (!button) return;

      button.textContent = 'Join Next Game';
      button.className = 'px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors';

      // Remove existing event listeners by cloning the button
      const newButton = button.cloneNode(true) as HTMLElement;
      button.parentNode?.replaceChild(newButton, button);

      // Add new click handler to navigate to the new game
      newButton.addEventListener('click', () => {
        window.location.href = getPath(`/game?id=${currentGameId}`);
      });
    };

    // Function to update a button to show series is being created
    const updateToSeriesCreatingButton = (button: HTMLElement | null) => {
      if (!button) return;

      button.textContent = 'Another player is creating the series...';
      button.className = 'px-6 py-3 bg-yellow-600 text-white rounded-lg opacity-75 cursor-not-allowed';

      // Remove click handler
      const newButton = button.cloneNode(true) as HTMLElement;
      button.parentNode?.replaceChild(newButton, button);
    };

    // Check if current game is different from our game (meaning next game started)
    if (currentGameId !== this.gameId) {
      // Update all series buttons to "Join Next Game"
      updateToJoinButton(victorySeriesBtn);
      updateToJoinButton(victoryNewSeriesBtn);
      updateToJoinButton(postVictorySeriesBtn, true);
      updateToJoinButton(postVictoryNewSeriesBtn, true);

      // Also show a notification
      this.showSeriesJoinNotification(currentGameId);
    } else {
      // Series was created but we're still on the first game
      // Update "make it a series" buttons to indicate someone else is creating the series
      [victorySeriesBtn, postVictorySeriesBtn].forEach(button => {
        if (button && (button.textContent === 'Make it a Series' || button.textContent === 'Make it a Series!')) {
          updateToSeriesCreatingButton(button);
        }
      });
    }
  }

  // Show notification about joining the next game in series
  private showSeriesJoinNotification(newGameId: string) {
    // Remove any existing notifications to avoid duplicates
    const existingNotifications = document.querySelectorAll('.series-join-notification');
    existingNotifications.forEach(notif => notif.remove());

    const notification = document.createElement('div');
    notification.className = 'series-join-notification fixed top-4 left-1/2 transform -translate-x-1/2 bg-purple-600 text-white p-4 rounded-lg shadow-lg z-50 max-w-md animate-pulse';
    notification.innerHTML = `
      <div class="text-center">
        <div class="flex items-center justify-center space-x-2 mb-2">
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path>
          </svg>
          <p class="font-medium">🎮 New Game Started!</p>
        </div>
        <p class="text-sm mb-3">Another player started the next game in your series.</p>
        <div class="flex space-x-2 justify-center">
          <button onclick="window.location.href='${getPath('/game?id=' + newGameId)}'" class="bg-white text-purple-600 px-4 py-2 rounded font-medium hover:bg-gray-100 transition-colors">
            Join Next Game
          </button>
          <button onclick="this.parentElement.parentElement.parentElement.remove()" class="bg-purple-700 text-white px-4 py-2 rounded font-medium hover:bg-purple-800 transition-colors">
            Dismiss
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(notification);

    // Auto-dismiss after 30 seconds (longer for important notifications)
    setTimeout(() => {
      if (notification.parentElement) {
        notification.remove();
      }
    }, 30000);
  }

  // Helper method to convert local players to Firebase format
  private getFirebasePlayersArray(): FirebaseGamePlayer[] {
    return this.state.players.map((playerName, index) => ({
      displayName: playerName,
      isAuthenticated: false, // Will be updated when auth players join
      position: index
    }));
  }

  // Add a method to show notification when series is created by another player
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, no-unused-vars
  private showSeriesCreatedNotification(_seriesId: string) {
    // Remove any existing series notifications to avoid duplicates
    const existingNotifications = document.querySelectorAll('.series-created-notification');
    existingNotifications.forEach(notif => notif.remove());

    const notification = document.createElement('div');
    notification.className = 'series-created-notification fixed top-4 left-1/2 transform -translate-x-1/2 bg-green-600 text-white p-4 rounded-lg shadow-lg z-50 max-w-md';
    notification.innerHTML = `
      <div class="text-center">
        <div class="flex items-center justify-center space-x-2 mb-2">
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z"></path>
          </svg>
          <p class="font-medium">🎯 Series Created!</p>
        </div>
        <p class="text-sm mb-3">Another player converted this game to a series.</p>
        <button onclick="this.parentElement.parentElement.remove()" class="bg-white text-green-600 px-4 py-2 rounded font-medium hover:bg-gray-100 transition-colors">
          Got it!
        </button>
      </div>
    `;

    document.body.appendChild(notification);

    // Auto-dismiss after 10 seconds
    setTimeout(() => {
      if (notification.parentElement) {
        notification.remove();
      }
    }, 10000);
  }

  // Show modal when next game starts in series
  private showNextGameModal(newGameId: string) {
    // Remove any existing modals to avoid duplicates
    const existingModals = document.querySelectorAll('.next-game-modal');
    existingModals.forEach(modal => modal.remove());

    const modal = document.createElement('div');
    modal.className = 'next-game-modal fixed inset-0 bg-gray-900 bg-opacity-75 z-50 flex items-center justify-center';
    modal.innerHTML = `
      <div class="bg-white rounded-lg p-8 max-w-md mx-4 text-center shadow-2xl">
        <div class="mb-6">
          <div class="mx-auto w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mb-4">
            <svg class="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path>
            </svg>
          </div>
          <h3 class="text-xl font-bold text-gray-900 mb-2">🎮 Next Game Started!</h3>
          <p class="text-gray-600 mb-6">Another player has started the next game in your series.</p>
        </div>

        <div class="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            onclick="window.location.href='${getPath('/game?id=' + newGameId)}'"
            class="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
          >
            Join Next Game
          </button>
          <button
            onclick="this.closest('.next-game-modal').remove()"
            class="px-6 py-3 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 transition-colors font-medium"
          >
            Stay Here
          </button>
        </div>

        <p class="text-xs text-gray-500 mt-4">You can also refresh this page to join the new game.</p>
      </div>
    `;

    document.body.appendChild(modal);

    // Auto-dismiss after 30 seconds if no action taken
    setTimeout(() => {
      if (modal.parentElement) {
        modal.remove();
      }
    }, 30000);

    // Also update the victory overlay buttons
    this.updateVictoryButtonsForNextGame(newGameId);
  }

  // Update victory overlay buttons when next game is available
  private updateVictoryButtonsForNextGame(newGameId: string) {
    const buttonsToUpdate = [
      'victory-series-btn',
      'victory-new-series-btn',
      'post-victory-series-btn',
      'post-victory-new-series-btn'
    ];

    buttonsToUpdate.forEach(buttonId => {
      const button = document.getElementById(buttonId);
      if (button && button.textContent?.includes('Series')) {
        button.textContent = 'Join Next Game';
        button.className = 'px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors';

        // Remove existing event listeners by cloning
        const newButton = button.cloneNode(true) as HTMLElement;
        button.parentNode?.replaceChild(newButton, button);

        // Add new click handler
        newButton.addEventListener('click', () => {
          window.location.href = getPath(`/game?id=${newGameId}`);
        });
      }
    });
  }
}