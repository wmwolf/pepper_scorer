// src/lib/firebaseGameState.ts
import { ref, set, get, push, onValue, off, type DatabaseReference } from 'firebase/database';
import { getFirebaseDatabase, isFirebaseConfigured } from './firebase';
import { getCurrentUser } from './auth';
import { GameManager, type GameState } from './gameState';

export interface FirebaseGameMetadata {
  createdBy: string;
  createdAt: number;
  status: 'setup' | 'active' | 'completed';
  roomCode?: string;
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

// Generate room code for game
const generateRoomCode = (): string => {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
};

export class FirebaseGameManager extends GameManager {
  private gameId: string | null = null;
  private gameRef: DatabaseReference | null = null;
  private listeners: Array<() => void> = [];

  constructor(players: string[], teams: [string, string], gameId?: string) {
    super(players, teams);

    if (gameId) {
      this.gameId = gameId;
      this.setupFirebaseListeners();
    }
  }

  // Create new Firebase game
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

      // Restore game state
      manager.state = gameData.gameState;

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

    // Listen for game state changes
    const gameStateRef = ref(database, `games/${this.gameId}/gameState`);
    const unsubscribeGameState = onValue(gameStateRef, (snapshot) => {
      if (snapshot.exists()) {
        const newState = snapshot.val() as GameState;
        // Only update if this isn't our own change
        if (JSON.stringify(newState) !== JSON.stringify(this.state)) {
          this.state = newState;
          this.notifyStateChange();
        }
      }
    });

    this.listeners.push(() => off(gameStateRef, 'value', unsubscribeGameState));
  }

  // Sync state to Firebase
  private async syncToFirebase() {
    if (!this.gameId || !isFirebaseConfigured()) return;

    const database = getFirebaseDatabase();
    if (!database) return;

    try {
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

  override convertToSeries(): void {
    super.convertToSeries();
    this.syncToFirebase();
  }

  override startNextGame(): void {
    super.startNextGame();
    this.syncToFirebase();
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
  private stateChangeListeners: Array<(state: GameState) => void> = [];

  public onStateChange(callback: (state: GameState) => void): () => void {
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

  // Clean up listeners
  public destroy() {
    this.listeners.forEach(unsubscribe => unsubscribe());
    this.listeners = [];
    this.stateChangeListeners = [];
  }

  // Get user's active games
  static async getUserActiveGames(userId: string): Promise<Array<{ id: string; metadata: FirebaseGameMetadata; teams: [string, string] }>> {
    if (!isFirebaseConfigured()) return [];

    const database = getFirebaseDatabase();
    if (!database) return [];

    try {
      const userGamesRef = ref(database, `userGames/${userId}`);
      const snapshot = await get(userGamesRef);

      if (!snapshot.exists()) return [];

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
              teams: gameData.teams
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
}