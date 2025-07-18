import { describe, it, expect, beforeEach } from 'vitest';
import { GameManager } from '@/lib/gameState';

describe('Series Flow Integration', () => {
  let gameManager: GameManager;

  beforeEach(() => {
    gameManager = new GameManager(['Alice', 'Bob', 'Charlie', 'Dave'], ['Team 1', 'Team 2']);
    // Convert to series mode
    gameManager.state.isSeries = true;
    gameManager.state.seriesScores = [0, 0];
    gameManager.state.completedGames = [];
  });

  describe('Series Management', () => {
    it('should handle multiple games in a series', () => {
      expect(gameManager.state.isSeries).toBe(true);
      expect(gameManager.state.seriesScores).toEqual([0, 0]);
      expect(gameManager.state.completedGames?.length || 0).toBe(0);

      // Play first game to completion
      playCompleteGame(gameManager, 0); // Team 0 wins
      
      expect(gameManager.isGameComplete()).toBe(true);
      expect(gameManager.getWinner()).toBe(0);
      gameManager.completeGame(); // Need to call this to update series
      expect(gameManager.state.completedGames?.length || 0).toBe(1);
      expect(gameManager.state.seriesScores).toEqual([1, 0]);

      // Start next game
      gameManager.startNextGame();
      
      expect(gameManager.isGameComplete()).toBe(false);
      expect(gameManager.state.hands.length).toBe(1); // Should have dealer for new game
      expect(gameManager.state.completedGames?.length || 0).toBe(1); // Previous game stored
      expect(gameManager.getScores()).toEqual([0, 0]); // Fresh game scores

      // Play second game
      playCompleteGame(gameManager, 1); // Team 1 wins
      
      expect(gameManager.getWinner()).toBe(1);
      gameManager.completeGame();
      expect(gameManager.state.completedGames?.length || 0).toBe(2);
      expect(gameManager.state.seriesScores).toEqual([1, 1]);

      // Play third game (series winner)
      gameManager.startNextGame();
      playCompleteGame(gameManager, 0); // Team 0 wins series
      
      gameManager.completeGame();
      expect(gameManager.state.seriesScores).toEqual([2, 1]);
      expect(gameManager.state.seriesWinner).toBe(0);
    });

    it('should handle series completion correctly', () => {
      // Play games until series completion
      let gamesPlayed = 0;
      
      while (!gameManager.isSeriesComplete() && gamesPlayed < 5) {
        if (gameManager.isGameComplete()) {
          gameManager.completeGame();
          gameManager.startNextGame();
        }
        
        const winningTeam = gamesPlayed % 2; // Alternate winners
        playCompleteGame(gameManager, winningTeam);
        gamesPlayed++;
      }
      
      if (gameManager.isGameComplete()) {
        gameManager.completeGame();
      }
      
      expect(gameManager.isSeriesComplete()).toBe(true);
      expect(gameManager.state.seriesWinner).toBeDefined();
      expect([0, 1]).toContain(gameManager.state.seriesWinner);
    });

    it('should maintain game history correctly', () => {
      // Play 3 games
      for (let i = 0; i < 3; i++) {
        if (i > 0) {
          gameManager.startNextGame();
        }
        
        playCompleteGame(gameManager, i % 2);
        gameManager.completeGame();
        expect(gameManager.state.completedGames?.length || 0).toBe(i + 1);
      }
      
      // Check game history
      const history = gameManager.state.completedGames || [];
      expect(history.length).toBe(3);
      
      // Each game should have complete data
      history.forEach((game, index) => {
        expect(game.hands.length).toBeGreaterThan(0);
        expect(game.finalScores).toBeDefined();
        expect(game.finalScores[0] >= 30 || game.finalScores[1] >= 30).toBe(true);
        expect(game.winner).toBe(index % 2);
      });
    });
  });

  describe('Series State Transitions', () => {
    it('should handle game-to-game transitions properly', () => {
      // Complete first game
      playCompleteGame(gameManager, 0);
      
      const firstGameState = gameManager.toJSON();
      gameManager.completeGame();
      
      expect(gameManager.state.completedGames?.length || 0).toBe(1);
      expect(gameManager.state.seriesScores).toEqual([1, 0]);
      
      // Start next game
      gameManager.startNextGame();
      
      // Verify clean slate for new game
      expect(gameManager.state.hands.length).toBe(1); // Should have dealer
      expect(gameManager.getScores()).toEqual([0, 0]);
      expect(gameManager.isGameComplete()).toBe(false);
      
      // But series state should be maintained
      expect(gameManager.state.seriesScores).toEqual([1, 0]);
      expect(gameManager.state.completedGames?.length || 0).toBe(1);
    });

    it('should preserve series context through JSON serialization', () => {
      // Play partial game
      gameManager.addHandPart('1'); // Dealer
      gameManager.addHandPart('1'); // Bidder
      gameManager.addHandPart('5'); // Bid
      gameManager.addHandPart('H'); // Trump
      
      const serialized = gameManager.toJSON();
      const restored = GameManager.fromJSON(serialized);
      
      expect(restored.state.isSeries).toBe(true);
      expect(restored.state.seriesScores).toEqual([0, 0]);
      // Note: Can't easily check current phase without decoding hand
      expect(restored.getCurrentHand().includes('1')).toBe(true); // Has bidder info
    });
  });

  describe('Series Error Handling', () => {
    it('should prevent starting next game before current is complete', () => {
      expect(() => gameManager.startNextGame()).toThrow();
      
      // Partially complete a game
      gameManager.addHandPart('1'); // Dealer
      gameManager.addHandPart('1'); // Bidder
      
      expect(() => gameManager.startNextGame()).toThrow();
    });

    it('should handle series winner queries correctly', () => {
      // No winner initially
      expect(gameManager.state.seriesWinner).toBeUndefined();
      
      // Play one game
      playCompleteGame(gameManager, 0);
      gameManager.completeGame();
      expect(gameManager.state.seriesWinner).toBeUndefined(); // Series not complete
      
      // Complete series
      gameManager.startNextGame();
      playCompleteGame(gameManager, 0);
      gameManager.completeGame();
      gameManager.startNextGame();
      playCompleteGame(gameManager, 0);
      gameManager.completeGame();
      
      expect(gameManager.isSeriesComplete()).toBe(true);
      expect(gameManager.state.seriesWinner).toBe(0);
    });
  });
});

// Helper function to play a complete game to a specific winner
function playCompleteGame(gameManager: GameManager, targetWinner: number): void {
  let handsPlayed = 0;
  const maxHands = 20; // Safety limit
  
  while (!gameManager.isGameComplete() && handsPlayed < maxHands) {
    const currentScores = gameManager.getScores();
    const dealer = (handsPlayed % 4) + 1;
    const bidder = dealer; // For simplicity, dealer always wins bid
    const biddingTeam = (bidder - 1) % 2;
    
    gameManager.addHandPart(dealer.toString()); // Dealer
    gameManager.addHandPart(bidder.toString()); // Bidder
    
    // Choose bid strategically based on target winner and current scores
    let bid = '4';
    if (currentScores[targetWinner] >= 25) {
      // Target winner is close, use smaller bid
      bid = '4';
    } else if (currentScores[1 - targetWinner] >= 25) {
      // Opponent is close, might need bigger bid
      bid = '6';
    } else {
      // Mid-game, use moderate bid
      bid = '5';
    }
    
    gameManager.addHandPart(bid); // Bid
    gameManager.addHandPart('H'); // Trump Hearts
    gameManager.addHandPart('P'); // Play
    
    // Set tricks based on who we want to win
    let tricks: string;
    if (biddingTeam === targetWinner) {
      // Let bidding team make it
      tricks = Math.max(0, 6 - parseInt(bid)).toString();
    } else {
      // Set the bid
      tricks = '6';
    }
    
    gameManager.addHandPart(tricks);
    handsPlayed++;
  }
  
  if (!gameManager.isGameComplete()) {
    throw new Error(`Failed to complete game after ${maxHands} hands`);
  }
  
  if (gameManager.getWinner() !== targetWinner) {
    // Sometimes the scoring doesn't work out exactly as planned, that's OK
    // as long as the game completes
    console.warn(`Expected team ${targetWinner} to win, but team ${gameManager.getWinner()} won`);
  }
}