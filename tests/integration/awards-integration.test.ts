import { describe, it, expect, beforeEach } from 'vitest';
import { GameManager } from '@/lib/gameState';
import { selectGameAwards, selectSeriesAwards } from '@/lib/pepper-awards';
import { trackAwardData } from '@/lib/statistics-util';

describe('Awards Integration', () => {
  let gameManager: GameManager;

  beforeEach(() => {
    gameManager = new GameManager(['Alice', 'Bob', 'Charlie', 'Dave']);
  });

  describe('Game Awards Integration', () => {
    it('should generate relevant awards for completed games', () => {
      // Play a game with specific patterns to trigger awards
      
      // Hand 1: Alice bids Moon and makes it (Bold Bidding)
      gameManager.setBidder(1);
      gameManager.setBid('M');
      gameManager.setTrump('N'); // No trump
      gameManager.setDecision('P', 0);
      gameManager.setTricks(0); // Alice's team takes all 6 tricks
      
      // Hand 2: Bob bids 6 and gets set (Defensive Prowess)
      gameManager.setBidder(2);
      gameManager.setBid(6);
      gameManager.setTrump('H');
      gameManager.setDecision('P', 0);
      gameManager.setTricks(6); // Bob gets set badly
      
      // Hand 3: Charlie bids 4 and makes it exactly
      gameManager.setBidder(3);
      gameManager.setBid(4);
      gameManager.setTrump('S');
      gameManager.setDecision('P', 0);
      gameManager.setTricks(2); // Charlie's team gets exactly 4 tricks
      
      // Complete the game
      while (!gameManager.isGameComplete) {
        const bidder = ((gameManager.currentHand % 4) + 1);
        gameManager.setBidder(bidder);
        gameManager.setBid(4);
        gameManager.setTrump('H');
        gameManager.setDecision('P', 0);
        gameManager.setTricks(2);
      }
      
      // Generate award data and select awards
      const awardData = trackAwardData(gameManager.hands, gameManager.players);
      const selectedAwards = selectGameAwards(awardData, gameManager.players);
      
      expect(selectedAwards.length).toBeGreaterThan(0);
      expect(selectedAwards.length).toBeLessThanOrEqual(5);
      
      // Check that awards have proper structure
      selectedAwards.forEach(award => {
        expect(award).toHaveProperty('title');
        expect(award).toHaveProperty('recipient');
        expect(award).toHaveProperty('description');
        expect(gameManager.players).toContain(award.recipient);
      });
      
      // Look for specific awards we expect
      const awardTitles = selectedAwards.map(a => a.title);
      const moonAward = selectedAwards.find(a => a.title.includes('Bold') || a.title.includes('Moon'));
      if (moonAward) {
        expect(moonAward.recipient).toBe('Alice');
      }
    });

    it('should handle edge cases in award generation', () => {
      // Play a very short game (everyone folds immediately)
      gameManager.setBidder(1);
      gameManager.setBid(4);
      gameManager.setTrump('H');
      gameManager.setDecision('F'); // Fold immediately
      
      // Continue until game ends
      while (!gameManager.isGameComplete) {
        const bidder = ((gameManager.currentHand % 4) + 1);
        gameManager.setBidder(bidder);
        gameManager.setBid(4);
        gameManager.setTrump('H');
        gameManager.setDecision('F'); // Keep folding
      }
      
      const awardData = trackAwardData(gameManager.hands, gameManager.players);
      const selectedAwards = selectGameAwards(awardData, gameManager.players);
      
      // Should still generate some awards, even with unusual gameplay
      expect(selectedAwards.length).toBeGreaterThan(0);
      expect(selectedAwards.every(award => 
        gameManager.players.includes(award.recipient)
      )).toBe(true);
    });
  });

  describe('Series Awards Integration', () => {
    it('should generate series awards after multiple games', () => {
      // Convert to series mode
      gameManager = new GameManager(['Alice', 'Bob', 'Charlie', 'Dave'], true);
      
      // Play first game with Alice dominating
      playGameWithPattern(gameManager, [
        { bidder: 1, bid: 'M', result: 'make' }, // Alice Moon
        { bidder: 1, bid: 6, result: 'make' },   // Alice 6
        { bidder: 1, bid: 'D', result: 'make' }  // Alice Double Moon (wins game)
      ]);
      
      expect(gameManager.isGameComplete).toBe(true);
      expect(gameManager.getWinningTeam()).toBe(0); // Alice's team
      
      // Start second game
      gameManager.startNextGame();
      
      // Play second game with Bob's team winning
      playGameWithPattern(gameManager, [
        { bidder: 2, bid: 6, result: 'make' },
        { bidder: 2, bid: 6, result: 'make' },
        { bidder: 2, bid: 6, result: 'make' }
      ]);
      
      expect(gameManager.getWinningTeam()).toBe(1); // Bob's team
      
      // Start third game to complete series
      gameManager.startNextGame();
      playGameWithPattern(gameManager, [
        { bidder: 3, bid: 5, result: 'make' },
        { bidder: 3, bid: 5, result: 'make' },
        { bidder: 3, bid: 5, result: 'make' },
        { bidder: 3, bid: 5, result: 'make' }
      ]);
      
      expect(gameManager.isSeriesComplete()).toBe(true);
      
      // Generate series awards
      const awardData = trackAwardData(
        gameManager.games.flatMap(g => g.hands),
        gameManager.players,
        gameManager.games
      );
      const seriesAwards = selectSeriesAwards(awardData, gameManager.players, gameManager.games);
      
      expect(seriesAwards.length).toBeGreaterThan(0);
      expect(seriesAwards.length).toBeLessThanOrEqual(8);
      
      // Verify award structure
      seriesAwards.forEach(award => {
        expect(award).toHaveProperty('title');
        expect(award).toHaveProperty('recipient');
        expect(award).toHaveProperty('description');
        expect(gameManager.players).toContain(award.recipient);
      });
      
      // Look for series-specific awards
      const awardTitles = seriesAwards.map(a => a.title);
      expect(awardTitles.some(title => 
        title.includes('MVP') || 
        title.includes('Specialist') || 
        title.includes('Series')
      )).toBe(true);
    });

    it('should integrate award data with game statistics', () => {
      gameManager = new GameManager(['Alice', 'Bob', 'Charlie', 'Dave'], true);
      
      // Play a game with varied bidding patterns
      const hands = [
        { bidder: 1, bid: 4, trump: 'H', decision: 'P', tricks: 2 }, // Alice makes 4
        { bidder: 2, bid: 5, trump: 'S', decision: 'P', tricks: 5 }, // Bob gets set
        { bidder: 3, bid: 'M', trump: 'N', decision: 'P', tricks: 0 }, // Charlie makes Moon
        { bidder: 4, bid: 6, trump: 'D', decision: 'P', tricks: 1 }, // Dave makes 6
        { bidder: 1, bid: 'D', trump: 'C', decision: 'P', tricks: 0 }  // Alice makes Double Moon (wins)
      ];
      
      hands.forEach(hand => {
        gameManager.setBidder(hand.bidder);
        gameManager.setBid(hand.bid);
        gameManager.setTrump(hand.trump);
        gameManager.setDecision(hand.decision, 0);
        gameManager.setTricks(hand.tricks);
      });
      
      expect(gameManager.isGameComplete).toBe(true);
      
      const awardData = trackAwardData(gameManager.hands, gameManager.players);
      
      // Verify award data contains expected statistics
      expect(awardData.playerStats.Alice.totalBids).toBeGreaterThan(0);
      expect(awardData.playerStats.Alice.successfulBids).toBeGreaterThan(0);
      expect(awardData.playerStats.Bob.totalBids).toBeGreaterThan(0);
      expect(awardData.playerStats.Charlie.moonBids.attempts).toBe(1);
      expect(awardData.playerStats.Charlie.moonBids.successes).toBe(1);
      
      // Verify team statistics
      expect(awardData.teamStats[0].totalPoints).toBeGreaterThan(0);
      expect(awardData.teamStats[1].totalPoints).toBeGreaterThan(0);
      
      const selectedAwards = selectGameAwards(awardData, gameManager.players);
      expect(selectedAwards.length).toBeGreaterThan(0);
    });
  });

  describe('Awards Performance Integration', () => {
    it('should handle large series efficiently', () => {
      gameManager = new GameManager(['Alice', 'Bob', 'Charlie', 'Dave'], true);
      
      const startTime = Date.now();
      
      // Play 5 complete games quickly
      for (let game = 0; game < 5; game++) {
        if (game > 0) {
          gameManager.startNextGame();
        }
        
        // Quick game completion
        while (!gameManager.isGameComplete) {
          const bidder = ((gameManager.currentHand % 4) + 1);
          gameManager.setBidder(bidder);
          gameManager.setBid(6);
          gameManager.setTrump('H');
          gameManager.setDecision('P', 0);
          gameManager.setTricks(2); // Make the bid
        }
      }
      
      // Generate awards for entire series
      const allHands = gameManager.games.flatMap(g => g.hands);
      const awardData = trackAwardData(allHands, gameManager.players, gameManager.games);
      const seriesAwards = selectSeriesAwards(awardData, gameManager.players, gameManager.games);
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      // Awards generation should be reasonably fast (under 1 second for 5 games)
      expect(duration).toBeLessThan(1000);
      expect(seriesAwards.length).toBeGreaterThan(0);
      expect(allHands.length).toBeGreaterThan(20); // Should have played many hands
    });
  });
});

// Helper function to play a game with specific patterns
function playGameWithPattern(gameManager: GameManager, pattern: Array<{bidder: number, bid: number | string, result: 'make' | 'set'}>) {
  let patternIndex = 0;
  
  while (!gameManager.isGameComplete && patternIndex < pattern.length) {
    const { bidder, bid, result } = pattern[patternIndex];
    
    gameManager.setBidder(bidder);
    gameManager.setBid(bid);
    gameManager.setTrump('H');
    gameManager.setDecision('P', 0);
    
    if (result === 'make') {
      // Set tricks so bidding team makes the bid
      const bidValue = typeof bid === 'string' ? 
        (bid === 'M' ? 7 : bid === 'D' ? 14 : 4) : bid;
      gameManager.setTricks(Math.max(0, 6 - bidValue));
    } else {
      // Set tricks so bidding team gets set
      gameManager.setTricks(6);
    }
    
    patternIndex++;
  }
  
  // Fill in remaining hands if game isn't complete
  while (!gameManager.isGameComplete) {
    const bidder = ((gameManager.currentHand % 4) + 1);
    gameManager.setBidder(bidder);
    gameManager.setBid(4);
    gameManager.setTrump('H');
    gameManager.setDecision('P', 0);
    gameManager.setTricks(2);
  }
}