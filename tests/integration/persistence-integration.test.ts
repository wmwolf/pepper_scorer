import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GameManager } from '@/lib/gameState';

// Mock localStorage for testing
class MockLocalStorage {
  private store: { [key: string]: string } = {};

  getItem(key: string): string | null {
    return this.store[key] || null;
  }

  setItem(key: string, value: string): void {
    this.store[key] = value;
  }

  removeItem(key: string): void {
    delete this.store[key];
  }

  clear(): void {
    this.store = {};
  }

  get length(): number {
    return Object.keys(this.store).length;
  }

  key(index: number): string | null {
    const keys = Object.keys(this.store);
    return keys[index] || null;
  }
}

describe('Persistence Integration', () => {
  let mockLocalStorage: MockLocalStorage;
  let originalLocalStorage: Storage;

  beforeEach(() => {
    mockLocalStorage = new MockLocalStorage();
    originalLocalStorage = global.localStorage;
    global.localStorage = mockLocalStorage as any;
  });

  afterEach(() => {
    global.localStorage = originalLocalStorage;
  });

  describe('Game State Serialization', () => {
    it('should serialize and restore complete game state', () => {
      const gameManager = new GameManager(['Alice', 'Bob', 'Charlie', 'Dave']);
      
      // Build up complex game state
      gameManager.setBidder(2);
      gameManager.setBid('M');
      gameManager.setTrump('N');
      gameManager.setDecision('P', 1);
      gameManager.setTricks(2);
      
      // Complete another hand
      gameManager.setBidder(3);
      gameManager.setBid(6);
      gameManager.setTrump('H');
      gameManager.setDecision('F'); // Fold
      
      // Save state to localStorage (simulate what the UI would do)
      const gameState = gameManager.toJSON();
      localStorage.setItem('pepperGame', JSON.stringify(gameState));
      
      // Restore from localStorage
      const savedState = JSON.parse(localStorage.getItem('pepperGame')!);
      const restoredManager = GameManager.fromJSON(savedState);
      
      // Verify complete restoration
      expect(restoredManager.players).toEqual(gameManager.players);
      expect(restoredManager.currentHand).toBe(gameManager.currentHand);
      expect(restoredManager.currentPhase).toBe(gameManager.currentPhase);
      expect(restoredManager.getScores()).toEqual(gameManager.getScores());
      expect(restoredManager.hands).toEqual(gameManager.hands);
      expect(restoredManager.isSeries).toBe(gameManager.isSeries);
      
      // Should be able to continue gameplay
      restoredManager.setBidder(4);
      expect(restoredManager.currentPhase).toBe('bid');
    });

    it('should handle serialization of series with multiple games', () => {
      const gameManager = new GameManager(['Alice', 'Bob', 'Charlie', 'Dave'], true);
      
      // Complete first game
      while (!gameManager.isGameComplete) {
        const bidder = ((gameManager.currentHand % 4) + 1);
        gameManager.setBidder(bidder);
        gameManager.setBid(5);
        gameManager.setTrump('H');
        gameManager.setDecision('P', 0);
        gameManager.setTricks(2);
      }
      
      const firstGameWinner = gameManager.getWinningTeam();
      
      // Start second game
      gameManager.startNextGame();
      gameManager.setBidder(1);
      gameManager.setBid(4);
      gameManager.setTrump('S');
      
      // Save mid-game state
      const gameState = gameManager.toJSON();
      localStorage.setItem('pepperSeries', JSON.stringify(gameState));
      
      // Restore
      const savedState = JSON.parse(localStorage.getItem('pepperSeries')!);
      const restoredManager = GameManager.fromJSON(savedState);
      
      // Verify series state
      expect(restoredManager.isSeries).toBe(true);
      expect(restoredManager.games.length).toBe(1);
      expect(restoredManager.games[0].winningTeam).toBe(firstGameWinner);
      expect(restoredManager.seriesScores[firstGameWinner]).toBe(1);
      expect(restoredManager.seriesScores[1 - firstGameWinner]).toBe(0);
      
      // Verify current game state
      expect(restoredManager.currentHand).toBe(0);
      expect(restoredManager.currentPhase).toBe('trump');
      expect(restoredManager.getCurrentBidder()).toBe(1);
      expect(restoredManager.getCurrentBid()).toBe(4);
      expect(restoredManager.getScores()).toEqual([0, 0]); // Fresh game scores
      
      // Continue gameplay
      restoredManager.setTrump('D');
      expect(restoredManager.currentPhase).toBe('decision');
    });

    it('should preserve undo history through serialization', () => {
      const gameManager = new GameManager(['Alice', 'Bob', 'Charlie', 'Dave']);
      
      // Build up some history
      gameManager.setBidder(1);
      gameManager.setBid(5);
      gameManager.setTrump('H');
      
      expect(gameManager.canUndo()).toBe(true);
      
      // Serialize
      const gameState = gameManager.toJSON();
      const restoredManager = GameManager.fromJSON(gameState);
      
      // Undo should still work
      expect(restoredManager.canUndo()).toBe(true);
      restoredManager.undo();
      expect(restoredManager.currentPhase).toBe('trump');
      expect(restoredManager.getCurrentTrump()).toBe(null);
      
      restoredManager.undo();
      expect(restoredManager.currentPhase).toBe('bid');
      expect(restoredManager.getCurrentBid()).toBe(null);
    });
  });

  describe('Persistence Error Handling', () => {
    it('should handle corrupted localStorage data gracefully', () => {
      // Invalid JSON
      localStorage.setItem('pepperGame', 'invalid json');
      
      expect(() => {
        const savedState = JSON.parse(localStorage.getItem('pepperGame')!);
        GameManager.fromJSON(savedState);
      }).toThrow();
      
      // Missing required fields
      localStorage.setItem('pepperGame', JSON.stringify({ players: ['Alice'] }));
      
      expect(() => {
        const savedState = JSON.parse(localStorage.getItem('pepperGame')!);
        GameManager.fromJSON(savedState);
      }).toThrow();
    });

    it('should handle localStorage quota exceeded', () => {
      const gameManager = new GameManager(['Alice', 'Bob', 'Charlie', 'Dave']);
      
      // Mock localStorage.setItem to throw quota exceeded error
      const originalSetItem = localStorage.setItem;
      localStorage.setItem = () => {
        throw new Error('QuotaExceededError');
      };
      
      // Should not crash when trying to save
      expect(() => {
        const gameState = gameManager.toJSON();
        try {
          localStorage.setItem('pepperGame', JSON.stringify(gameState));
        } catch (error) {
          // In real app, this would be handled by showing user message
          expect(error.message).toContain('QuotaExceededError');
        }
      }).not.toThrow();
      
      localStorage.setItem = originalSetItem;
    });

    it('should handle version compatibility issues', () => {
      // Simulate old version data format
      const oldFormatData = {
        players: ['Alice', 'Bob', 'Charlie', 'Dave'],
        hands: ['1,4,H,P,0,2'], // Old encoding format
        currentHand: 1,
        scores: [4, 0],
        // Missing newer fields like currentPhase, history, etc.
      };
      
      localStorage.setItem('pepperGame', JSON.stringify(oldFormatData));
      
      // Should either handle gracefully or provide clear error
      expect(() => {
        const savedState = JSON.parse(localStorage.getItem('pepperGame')!);
        GameManager.fromJSON(savedState);
      }).toThrow(); // Expected to throw due to format incompatibility
    });
  });

  describe('Data Integrity', () => {
    it('should maintain data consistency across save/load cycles', () => {
      const gameManager = new GameManager(['Alice', 'Bob', 'Charlie', 'Dave'], true);
      
      // Play complex series with various scenarios
      const scenarios = [
        { bidder: 1, bid: 'M', trump: 'N', decision: 'P', tricks: 0 }, // Moon make
        { bidder: 2, bid: 6, trump: 'H', decision: 'P', tricks: 6 },   // Set
        { bidder: 3, bid: 4, trump: 'S', decision: 'F' },              // Fold
        { bidder: 4, bid: 'D', trump: 'C', decision: 'P', tricks: 0 }  // Double Moon
      ];
      
      scenarios.forEach((scenario, index) => {
        gameManager.setBidder(scenario.bidder);
        gameManager.setBid(scenario.bid);
        gameManager.setTrump(scenario.trump);
        gameManager.setDecision(scenario.decision, 0);
        if (scenario.decision === 'P') {
          gameManager.setTricks(scenario.tricks);
        }
        
        // Save and restore after each move
        const gameState = gameManager.toJSON();
        localStorage.setItem(`pepperGame_${index}`, JSON.stringify(gameState));
        
        const savedState = JSON.parse(localStorage.getItem(`pepperGame_${index}`)!);
        const restoredManager = GameManager.fromJSON(savedState);
        
        // Verify no data corruption
        expect(restoredManager.hands.length).toBe(gameManager.hands.length);
        expect(restoredManager.getScores()).toEqual(gameManager.getScores());
        expect(restoredManager.currentHand).toBe(gameManager.currentHand);
      });
    });

    it('should handle large game histories efficiently', () => {
      const gameManager = new GameManager(['Alice', 'Bob', 'Charlie', 'Dave'], true);
      
      // Play multiple complete games
      for (let game = 0; game < 3; game++) {
        if (game > 0) {
          gameManager.startNextGame();
        }
        
        // Play 10+ hands per game
        for (let hand = 0; hand < 15 && !gameManager.isGameComplete; hand++) {
          const bidder = ((hand % 4) + 1);
          gameManager.setBidder(bidder);
          gameManager.setBid(4 + (hand % 3));
          gameManager.setTrump(['H', 'S', 'D', 'C'][hand % 4]);
          gameManager.setDecision('P', 0);
          gameManager.setTricks(2 + (hand % 3));
        }
      }
      
      // Serialize large state
      const startTime = Date.now();
      const gameState = gameManager.toJSON();
      const serialized = JSON.stringify(gameState);
      const serializeTime = Date.now() - startTime;
      
      // Should be reasonably fast (under 50ms)
      expect(serializeTime).toBeLessThan(50);
      
      // Should not be excessively large (under 100KB for 3 games)
      expect(serialized.length).toBeLessThan(100000);
      
      // Restore and verify
      const restoreStartTime = Date.now();
      const restoredManager = GameManager.fromJSON(JSON.parse(serialized));
      const restoreTime = Date.now() - restoreStartTime;
      
      expect(restoreTime).toBeLessThan(50);
      expect(restoredManager.games.length).toBe(gameManager.games.length);
      expect(restoredManager.seriesScores).toEqual(gameManager.seriesScores);
    });
  });

  describe('Real-World Usage Patterns', () => {
    it('should handle browser refresh during gameplay', () => {
      const gameManager = new GameManager(['Alice', 'Bob', 'Charlie', 'Dave']);
      
      // User starts game, makes some moves
      gameManager.setBidder(1);
      gameManager.setBid(5);
      gameManager.setTrump('H');
      
      // App saves state (simulating auto-save)
      localStorage.setItem('currentGame', JSON.stringify(gameManager.toJSON()));
      
      // User refreshes browser (simulated by creating new instance)
      const restoredGame = GameManager.fromJSON(
        JSON.parse(localStorage.getItem('currentGame')!)
      );
      
      // User should be able to continue exactly where they left off
      expect(restoredGame.currentPhase).toBe('decision');
      expect(restoredGame.getCurrentBidder()).toBe(1);
      expect(restoredGame.getCurrentBid()).toBe(5);
      expect(restoredGame.getCurrentTrump()).toBe('H');
      
      // Continue gameplay
      restoredGame.setDecision('P', 0);
      restoredGame.setTricks(3);
      
      expect(restoredGame.currentHand).toBe(1);
      expect(restoredGame.getScores()[1]).toBeGreaterThan(0); // Bob's team set Alice
    });

    it('should handle multiple browser tabs gracefully', () => {
      const gameManager1 = new GameManager(['Alice', 'Bob', 'Charlie', 'Dave']);
      
      // Tab 1 makes some moves
      gameManager1.setBidder(1);
      gameManager1.setBid(4);
      localStorage.setItem('sharedGame', JSON.stringify(gameManager1.toJSON()));
      
      // Tab 2 loads same game
      const gameManager2 = GameManager.fromJSON(
        JSON.parse(localStorage.getItem('sharedGame')!)
      );
      
      // Tab 2 continues gameplay
      gameManager2.setTrump('H');
      gameManager2.setDecision('P', 0);
      localStorage.setItem('sharedGame', JSON.stringify(gameManager2.toJSON()));
      
      // Tab 1 refreshes and loads updated state
      const updatedState = GameManager.fromJSON(
        JSON.parse(localStorage.getItem('sharedGame')!)
      );
      
      expect(updatedState.currentPhase).toBe('tricks');
      expect(updatedState.getCurrentTrump()).toBe('H');
      expect(updatedState.getCurrentDecision()).toBe('P');
    });

    it('should handle game completion and restart cycle', () => {
      let gameManager = new GameManager(['Alice', 'Bob', 'Charlie', 'Dave']);
      
      // Complete a full game
      while (!gameManager.isGameComplete) {
        const bidder = ((gameManager.currentHand % 4) + 1);
        gameManager.setBidder(bidder);
        gameManager.setBid(6);
        gameManager.setTrump('H');
        gameManager.setDecision('P', 0);
        gameManager.setTricks(2);
      }
      
      // Save completed game
      localStorage.setItem('completedGame', JSON.stringify(gameManager.toJSON()));
      
      // User starts new game (clearing old data)
      localStorage.removeItem('completedGame');
      gameManager = new GameManager(['Alice', 'Bob', 'Charlie', 'Dave']);
      
      // Verify clean slate
      expect(gameManager.currentHand).toBe(0);
      expect(gameManager.getScores()).toEqual([0, 0]);
      expect(gameManager.hands.length).toBe(0);
      expect(gameManager.isGameComplete).toBe(false);
      
      // Should be able to start fresh
      gameManager.setBidder(1);
      expect(gameManager.currentPhase).toBe('bid');
    });
  });
});