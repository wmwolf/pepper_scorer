// src/lib/firebaseGameState.ts
import { ref, set, get, push, onValue, off, remove, type DatabaseReference } from 'firebase/database';
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
  private lastSyncTime = 0;
  private uiUpdateCallback: ((_state: GameState) => void) | null = null;
  private seriesId: string | null = null;
  private seriesListener: (() => void) | null = null;

  constructor(players: string[], teams: [string, string], gameId?: string) {
    super(players, teams);

    if (gameId) {
      this.gameId = gameId;
      this.setupFirebaseListeners();
    }
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
          startTime: Date.now()
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
      // Merge Firebase game state with defaults
      const baseState = {
        players: gameData.players?.map(p => p.displayName) || [],
        teams: gameData.teams || ['Team 1', 'Team 2'],
        hands: [],
        scores: [0, 0],
        isComplete: false,
        isSeries: false,
        startTime: Date.now(),
        firebaseGameId: gameId
      };

      manager.state = {
        ...baseState,
        ...gameData.gameState
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

    // Listen for game state changes with UI update support
    const gameStateRef = ref(database, `games/${this.gameId}/gameState`);
    const unsubscribeGameState = onValue(gameStateRef, (snapshot) => {
      if (snapshot.exists()) {
        const newState = snapshot.val() as GameState;
        const now = Date.now();

        // Skip if this is likely our own update (within 1 second of our last sync)
        if (this.lastSyncTime && (now - this.lastSyncTime) < 1000) {
          return;
        }

        // Only update if this is different from our current state
        if (JSON.stringify(newState) !== JSON.stringify(this.state)) {
          // Update local state
          this.state = newState;
          this.notifyStateChange();

          // Update localStorage
          localStorage.setItem('currentGame', JSON.stringify(newState));

          // Call UI update callback if set
          if (this.uiUpdateCallback) {
            this.uiUpdateCallback(newState);
          }
        }
      }
    });

    this.listeners.push(() => off(gameStateRef, 'value', unsubscribeGameState));
  }

  // Sync state to Firebase
  private async syncToFirebase() {
    if (!this.gameId || !isFirebaseConfigured()) {
      return;
    }

    const database = getFirebaseDatabase();
    if (!database) {
      return;
    }

    try {
      this.lastSyncTime = Date.now();
      const gameStateRef = ref(database, `games/${this.gameId}/gameState`);
      await set(gameStateRef, this.state);
    } catch (error) {
      console.error('Error syncing to Firebase:', error);
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
        const newState = snapshot.val() as GameState;
        const now = Date.now();

        // Skip if this is likely our own update (within 1 second of our last sync)
        if (this.lastSyncTime && (now - this.lastSyncTime) < 1000) {
          return;
        }

        // Only update if the state is actually different
        if (JSON.stringify(newState) !== JSON.stringify(this.state)) {
          this.state = newState;
          this.notifyStateChange();

          // Update localStorage
          localStorage.setItem('currentGame', JSON.stringify(newState));

          // Call UI update callback if set
          if (this.uiUpdateCallback) {
            this.uiUpdateCallback(newState);
          }
        }
      }
    });

    // Store the unsubscribe function
    this.listeners.push(() => off(gameStateRef, 'value', unsubscribe));

    return () => off(gameStateRef, 'value', unsubscribe);
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

      const seriesId = push(ref(database, 'series')).key!;

      const seriesData: FirebaseSeriesData = {
        metadata: {
          createdBy: currentUser.uid,
          createdAt: Date.now(),
          status: 'active'
        },
        players: this.getFirebasePlayersArray(),
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
    const notification = document.createElement('div');
    notification.className = 'fixed top-4 right-4 bg-blue-600 text-white p-4 rounded-lg shadow-lg z-50';
    notification.innerHTML = `
      <div class="flex items-center space-x-3">
        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path>
        </svg>
        <div>
          <p class="font-medium">New Game Started!</p>
          <p class="text-sm">A new game has been started in this series.</p>
        </div>
        <button onclick="this.parentElement.parentElement.remove()" class="text-white hover:text-gray-200">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
          </svg>
        </button>
      </div>
      <div class="mt-3 flex space-x-2">
        <button onclick="window.location.href='${getPath('/game?id=' + newGameId)}'" class="bg-white text-blue-600 px-3 py-1 rounded text-sm font-medium">
          Join Game
        </button>
        <button onclick="this.parentElement.parentElement.remove()" class="bg-blue-700 text-white px-3 py-1 rounded text-sm">
          Dismiss
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

  // Override convertToSeries to create Firebase series
  override convertToSeries(): void {
    // Create Firebase series if we don't have one
    if (!this.seriesId) {
      this.createFirebaseSeries().then(seriesId => {
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
    }
  }

  // Override startNextGame to create new Firebase game in series
  override startNextGame(): void {
    if (!this.state.isSeries || !this.seriesId) {
      super.startNextGame();
      this.syncToFirebase();
      return;
    }

    // Create new Firebase game for the series
    this.createNextGameInSeries().then(newGameId => {
      if (newGameId) {
        // Navigate to new game
        window.location.href = getPath('/game?id=' + newGameId);
      } else {
        // Fallback to local series progression
        super.startNextGame();
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
        players: this.getFirebasePlayersArray(),
        teams: this.state.teams as [string, string],
        gameState: this.state
      };

      // Save new game
      const gameRef = ref(database, `games/${newGameId}`);
      await set(gameRef, gameData);

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

    // Clean up game listeners
    this.listeners.forEach(unsubscribe => unsubscribe());
    this.listeners = [];
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
          this.updateVictoryOverlayForExistingSeries(metadata.seriesId);
        }
      }
    });

    // Store the listener for cleanup
    this.listeners.push(() => off(gameMetadataRef, 'value', unsubscribe));
  }

  // Update victory overlay when series already exists
  private async updateVictoryOverlayForExistingSeries(seriesId: string) {
    try {
      const database = getFirebaseDatabase();
      if (!database) return;

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
      // Update buttons to indicate series mode
      [victorySeriesBtn, postVictorySeriesBtn].forEach(button => {
        if (button) {
          button.textContent = 'Series Created!';
          button.className = 'px-6 py-3 bg-green-600 text-white rounded-lg opacity-75 cursor-not-allowed';

          // Remove click handler
          const newButton = button.cloneNode(true) as HTMLElement;
          button.parentNode?.replaceChild(newButton, button);
        }
      });
    }
  }

  // Show notification about joining the next game in series
  private showSeriesJoinNotification(newGameId: string) {
    const notification = document.createElement('div');
    notification.className = 'fixed top-4 left-1/2 transform -translate-x-1/2 bg-purple-600 text-white p-4 rounded-lg shadow-lg z-50 max-w-md';
    notification.innerHTML = `
      <div class="text-center">
        <div class="flex items-center justify-center space-x-2 mb-2">
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z"></path>
          </svg>
          <p class="font-medium">Series Started!</p>
        </div>
        <p class="text-sm mb-3">Another player started the next game in your series.</p>
        <button onclick="window.location.href='${getPath('/game?id=' + newGameId)}'" class="bg-white text-purple-600 px-4 py-2 rounded font-medium hover:bg-gray-100 transition-colors">
          Join Next Game
        </button>
      </div>
    `;

    document.body.appendChild(notification);

    // Auto-dismiss after 15 seconds
    setTimeout(() => {
      if (notification.parentElement) {
        notification.remove();
      }
    }, 15000);
  }

  // Helper method to convert local players to Firebase format
  private getFirebasePlayersArray(): FirebaseGamePlayer[] {
    return this.state.players.map((playerName, index) => ({
      displayName: playerName,
      isAuthenticated: false, // Will be updated when auth players join
      position: index
    }));
  }
}