import { describe, it, expect, beforeEach } from 'vitest';
import { GameManager } from '@/lib/gameState';

describe('Undo Integration', () => {
  let gameManager: GameManager;

  beforeEach(() => {
    gameManager = new GameManager(['Alice', 'Bob', 'Charlie', 'Dave']);
  });

  describe('Cross-Phase Undo Operations', () => {
    it('should handle undo from each game phase correctly', () => {
      // Start in bidder phase
      expect(gameManager.currentPhase).toBe('bidder');
      expect(gameManager.canUndo()).toBe(false); // Nothing to undo yet
      
      // Set bidder and move to bid phase
      gameManager.setBidder(1);
      expect(gameManager.currentPhase).toBe('bid');
      expect(gameManager.canUndo()).toBe(true);
      
      // Undo from bid phase back to bidder
      gameManager.undo();
      expect(gameManager.currentPhase).toBe('bidder');
      expect(gameManager.getCurrentBidder()).toBe(null);
      
      // Redo the bidder selection and continue
      gameManager.setBidder(2);
      gameManager.setBid(5);
      expect(gameManager.currentPhase).toBe('trump');
      expect(gameManager.getCurrentBid()).toBe(5);
      
      // Undo from trump phase back to bid
      gameManager.undo();
      expect(gameManager.currentPhase).toBe('bid');
      expect(gameManager.getCurrentBid()).toBe(null);
      expect(gameManager.getCurrentBidder()).toBe(2); // Bidder preserved
      
      // Continue forward again
      gameManager.setBid(6);
      gameManager.setTrump('H');
      expect(gameManager.currentPhase).toBe('decision');
      
      // Undo from decision phase back to trump
      gameManager.undo();
      expect(gameManager.currentPhase).toBe('trump');
      expect(gameManager.getCurrentTrump()).toBe(null);
      expect(gameManager.getCurrentBid()).toBe(6); // Bid preserved
      
      // Continue to tricks phase
      gameManager.setTrump('S');
      gameManager.setDecision('P', 1);
      expect(gameManager.currentPhase).toBe('tricks');
      
      // Undo from tricks phase back to decision
      gameManager.undo();
      expect(gameManager.currentPhase).toBe('decision');
      expect(gameManager.getCurrentDecision()).toBe(null);
      expect(gameManager.getCurrentFreeTricks()).toBe(0);
      expect(gameManager.getCurrentTrump()).toBe('S'); // Trump preserved
    });

    it('should handle undo across hand boundaries', () => {
      // Complete first hand
      gameManager.setBidder(1);
      gameManager.setBid(4);
      gameManager.setTrump('H');
      gameManager.setDecision('P', 0);
      gameManager.setTricks(2);
      
      expect(gameManager.currentHand).toBe(1);
      expect(gameManager.currentPhase).toBe('bidder');
      expect(gameManager.getScores()).toEqual([4, 0]);
      
      // Start second hand
      gameManager.setBidder(2);
      expect(gameManager.currentPhase).toBe('bid');
      
      // Undo should go back to tricks phase of previous hand
      gameManager.undo();
      expect(gameManager.currentHand).toBe(0);
      expect(gameManager.currentPhase).toBe('tricks');
      expect(gameManager.getCurrentBidder()).toBe(1);
      expect(gameManager.getCurrentBid()).toBe(4);
      expect(gameManager.getCurrentTrump()).toBe('H');
      expect(gameManager.getScores()).toEqual([0, 0]); // Scores reset
      
      // Can continue from where we were
      gameManager.setTricks(1); // Different result
      expect(gameManager.currentHand).toBe(1);
      expect(gameManager.getScores()).toEqual([0, 4]); // Different scores
    });

    it('should handle undo in folding scenarios', () => {
      gameManager.setBidder(1);
      gameManager.setBid(5);
      gameManager.setTrump('H');
      gameManager.setDecision('F'); // Fold
      
      // Folding should complete the hand
      expect(gameManager.currentHand).toBe(1);
      expect(gameManager.currentPhase).toBe('bidder');
      expect(gameManager.getScores()).toEqual([5, 0]); // Alice's team got 5 for the fold
      
      // Undo the fold
      gameManager.undo();
      expect(gameManager.currentHand).toBe(0);
      expect(gameManager.currentPhase).toBe('decision');
      expect(gameManager.getCurrentDecision()).toBe(null);
      expect(gameManager.getScores()).toEqual([0, 0]); // Scores reset
      
      // Choose to play instead
      gameManager.setDecision('P', 0);
      expect(gameManager.currentPhase).toBe('tricks');
      
      gameManager.setTricks(3); // Bidding team gets set
      expect(gameManager.getScores()).toEqual([0, 5]); // Different outcome
    });
  });

  describe('Undo with Game State Consistency', () => {
    it('should maintain consistent state during complex undo sequences', () => {
      // Build up a complex state
      gameManager.setBidder(3);
      gameManager.setBid('M'); // Moon bid
      gameManager.setTrump('N'); // No trump
      gameManager.setDecision('P', 2); // Play with 2 free tricks
      
      const beforeTricks = gameManager.toJSON();
      
      gameManager.setTricks(1); // Complete the hand
      expect(gameManager.currentHand).toBe(1);
      
      // Undo and verify state restoration
      gameManager.undo();
      const afterUndo = gameManager.toJSON();
      
      expect(afterUndo.currentHand).toBe(beforeTricks.currentHand);
      expect(afterUndo.currentPhase).toBe(beforeTricks.currentPhase);
      expect(afterUndo.hands).toEqual(beforeTricks.hands);
      expect(afterUndo.scores).toEqual(beforeTricks.scores);
      
      // Can make different choice
      gameManager.setTricks(6); // Different outcome
      expect(gameManager.getScores()).not.toEqual([0, 0]);
    });

    it('should handle undo with pepper rounds correctly', () => {
      // Play through pepper rounds with undo
      for (let round = 0; round < 4; round++) {
        expect(gameManager.isPepperRound(round)).toBe(true);
        
        const expectedBidder = (round % 4) + 1;
        gameManager.setBidder(expectedBidder);
        
        // Bid is auto-set in pepper rounds
        const expectedBid = round + 4;
        expect(gameManager.getCurrentBid()).toBe(expectedBid === 7 ? 'M' : expectedBid);
        
        gameManager.setTrump('H');
        gameManager.setDecision('P', 0);
        
        // Undo from tricks phase
        gameManager.undo();
        expect(gameManager.currentPhase).toBe('decision');
        expect(gameManager.isPepperRound(gameManager.currentHand)).toBe(true);
        
        // Redo the decision
        gameManager.setDecision('P', 0);
        gameManager.setTricks(2); // Complete the round
        
        if (round < 3) {
          expect(gameManager.currentHand).toBe(round + 1);
        }
      }
      
      // 5th hand should not be pepper round
      expect(gameManager.isPepperRound(4)).toBe(false);
    });
  });

  describe('Undo in Series Context', () => {
    it('should handle undo across game boundaries in series', () => {
      gameManager = new GameManager(['Alice', 'Bob', 'Charlie', 'Dave'], true);
      
      // Complete first game
      while (!gameManager.isGameComplete) {
        const bidder = ((gameManager.currentHand % 4) + 1);
        gameManager.setBidder(bidder);
        gameManager.setBid(6);
        gameManager.setTrump('H');
        gameManager.setDecision('P', 0);
        gameManager.setTricks(2);
      }
      
      expect(gameManager.games.length).toBe(1);
      expect(gameManager.seriesScores[0] + gameManager.seriesScores[1]).toBe(1);
      
      // Start next game
      gameManager.startNextGame();
      expect(gameManager.currentHand).toBe(0);
      expect(gameManager.currentPhase).toBe('bidder');
      
      // Make a move in new game
      gameManager.setBidder(1);
      expect(gameManager.currentPhase).toBe('bid');
      
      // Undo should work within current game, not cross game boundary
      gameManager.undo();
      expect(gameManager.currentPhase).toBe('bidder');
      expect(gameManager.games.length).toBe(1); // Previous game still exists
      expect(gameManager.currentHand).toBe(0); // Still in new game
    });

    it('should preserve series state through undo operations', () => {
      gameManager = new GameManager(['Alice', 'Bob', 'Charlie', 'Dave'], true);
      
      // Partially complete first game
      gameManager.setBidder(1);
      gameManager.setBid(6);
      gameManager.setTrump('H');
      gameManager.setDecision('P', 0);
      gameManager.setTricks(2); // Complete one hand
      
      expect(gameManager.currentHand).toBe(1);
      expect(gameManager.seriesScores).toEqual([0, 0]); // No games complete yet
      
      // Undo the hand
      gameManager.undo();
      expect(gameManager.currentHand).toBe(0);
      expect(gameManager.currentPhase).toBe('tricks');
      expect(gameManager.isSeries).toBe(true); // Series flag preserved
      expect(gameManager.seriesScores).toEqual([0, 0]); // Series scores preserved
      
      // Different outcome
      gameManager.setTricks(5); // Set the bid instead
      expect(gameManager.getScores()[1]).toBeGreaterThan(0);
    });
  });

  describe('Undo Error Handling', () => {
    it('should handle undo when no history exists', () => {
      expect(gameManager.canUndo()).toBe(false);
      expect(() => gameManager.undo()).toThrow();
    });

    it('should handle undo at game boundaries correctly', () => {
      // Complete a full game
      while (!gameManager.isGameComplete) {
        const bidder = ((gameManager.currentHand % 4) + 1);
        gameManager.setBidder(bidder);
        gameManager.setBid(6);
        gameManager.setTrump('H');
        gameManager.setDecision('P', 0);
        gameManager.setTricks(2);
      }
      
      expect(gameManager.isGameComplete).toBe(true);
      expect(gameManager.canUndo()).toBe(true);
      
      // Undo should go back to last incomplete state
      gameManager.undo();
      expect(gameManager.isGameComplete).toBe(false);
      expect(gameManager.currentPhase).toBe('tricks');
      
      // Can complete differently
      gameManager.setTricks(5); // Set the bid
      // Game might not be complete now depending on scores
    });
  });

  describe('Undo Performance and Memory', () => {
    it('should handle many undo operations efficiently', () => {
      const startTime = Date.now();
      
      // Build up history with many operations
      for (let i = 0; i < 20; i++) {
        gameManager.setBidder(((i % 4) + 1));
        if (gameManager.canUndo()) {
          gameManager.undo();
        }
        gameManager.setBidder(((i % 4) + 1));
        gameManager.setBid(4 + (i % 3));
        if (gameManager.canUndo()) {
          gameManager.undo();
        }
        gameManager.setBid(4 + (i % 3));
        gameManager.setTrump(['H', 'S', 'D', 'C'][i % 4]);
        if (gameManager.canUndo()) {
          gameManager.undo();
        }
      }
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      // Should be reasonably fast (under 100ms for 60 operations)
      expect(duration).toBeLessThan(100);
      expect(gameManager.canUndo()).toBe(true);
    });
  });
});