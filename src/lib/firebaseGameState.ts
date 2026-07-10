// src/lib/firebaseGameState.ts
import { ref, set, get, push, onValue, off, remove, runTransaction, type DatabaseReference } from 'firebase/database';
import { getFirebaseDatabase, isFirebaseConfigured } from './firebase';
import { getCurrentUser } from './auth';
import { GameManager, type GameState } from './gameState';
import { getPath } from './path-utils';

export interface FirebaseGameMetadata {
  createdBy: string;
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
  bidding?: {
    active: boolean;
    dealerIndex: number;
    currentBidder: number;
    bids: Record<number, { value: string; suit?: string; revealed: boolean }>;
    phase: 'bidding' | 'trump' | 'decision';
  };
}

export interface FirebaseSeriesData {
  metadata: {
    createdBy: string;
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
  // and our local state, either defer to a strictly-newer remote, or commit our state
  // stamped with a bumped, monotonically-increasing version. Exposed static for testing.
  static resolveSyncWrite(
    remote: GameState | null,
    local: GameState
  ): { defer: true } | { commit: GameState } {
    if (remote && FirebaseGameManager.isRemoteNewer(remote, local)) {
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
  private applyRemoteState(newState: GameState | null): boolean {
    if (!newState) return false;

    if (!FirebaseGameManager.isRemoteNewer(newState, this.state)) return false;

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

    try {
      localStorage.setItem('currentGame', JSON.stringify(this.state));
    } catch {
      // localStorage may be unavailable (private mode / quota); non-fatal.
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
      // Create game data
      const gameData: FirebaseGameData = {
        metadata: {
          createdBy: gameCreator,
          createdAt: Date.now(),
          status: 'setup',
          roomCode: generateRoomCode()
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

      // Save to Firebase
      const gamesRef = ref(database, 'games');
      const newGameRef = push(gamesRef);
      const gameId = newGameRef.key!;

      await set(newGameRef, gameData);

      // Set this instance as Firebase-enabled
      this.gameId = gameId;
      this.state.firebaseGameId = gameId;

      // Add to creator's active games
      const userGameRef = ref(database, `userGames/${gameCreator}/${gameId}`);
      await set(userGameRef, true);

      // Add authenticated players to their userGames
      for (const authPlayer of authenticatedPlayers) {
        if (authPlayer.userId && authPlayer.userId !== gameCreator) {
          const playerGameRef = ref(database, `userGames/${authPlayer.userId}/${gameId}`);
          await set(playerGameRef, true);
        }
      }

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

      // Save to Firebase
      const gamesRef = ref(database, 'games');
      const newGameRef = push(gamesRef);
      const gameId = newGameRef.key!;

      await set(newGameRef, gameData);

      // Add to user's active games
      const userGameRef = ref(database, `userGames/${currentUser.uid}/${gameId}`);
      await set(userGameRef, true);

      // Add authenticated players to their userGames
      for (const authPlayer of authenticatedPlayers) {
        if (authPlayer.userId !== currentUser.uid) {
          const playerGameRef = ref(database, `userGames/${authPlayer.userId}/${gameId}`);
          await set(playerGameRef, true);
        }
      }

      console.log('Firebase game created with ID:', gameId);
      return new FirebaseGameManager(players, teams, gameId);

    } catch (error) {
      console.error('Error creating Firebase game:', error);
      return new FirebaseGameManager(players, teams);
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
        // Track the version we just committed so our echo is recognized as our own.
        this.state.version = FirebaseGameManager.versionOf(result.snapshot.val());
        this.touchLastUpdated();
      } else if (!result.committed && result.snapshot.exists()) {
        // A newer remote state won the transaction; pull it in rather than reverting it.
        this.applyRemoteState(result.snapshot.val() as GameState);
      }
    } catch (error) {
      console.error('Error syncing to Firebase:', error);
    }
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

  // Override methods to sync to Firebase
  override addHandPart(part: string): void {
    super.addHandPart(part);
    this.syncToFirebase();
  }

  override undo(): void {
    super.undo();
    this.syncToFirebase();
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

  // Override startNextGame to create new Firebase game in series
  override startNextGame(): void {
    if (!this.state.isSeries || !this.seriesId) {
      // Fallback path: the new game re-uses the current game node, so carry the sync
      // version forward. super.startNextGame() rebuilds state without a version, and
      // without this the transaction would treat the (higher-versioned) completed game
      // still on the node as "newer" and revert our fresh game.
      const prevVersion = FirebaseGameManager.versionOf(this.state);
      super.startNextGame();
      this.state.version = prevVersion;
      this.syncToFirebase();
      return;
    }

    // Create new Firebase game for the series
    this.createNextGameInSeries().then(newGameId => {
      if (newGameId) {
        // Navigate to new game
        window.location.href = getPath('/game?id=' + newGameId);
      } else {
        // Fallback to local series progression on the same game node — carry the
        // version forward for the same reason as above.
        const prevVersion = FirebaseGameManager.versionOf(this.state);
        super.startNextGame();
        this.state.version = prevVersion;
        this.syncToFirebase();
        window.location.reload();
      }
    });
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

      // Progress the series locally first to get updated state
      super.startNextGame();

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