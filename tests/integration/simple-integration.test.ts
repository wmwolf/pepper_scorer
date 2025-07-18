import { describe, it, expect, beforeEach } from 'vitest';
import { GameManager, getCurrentPhase, isHandComplete, calculateScore } from '@/lib/gameState';

describe('Simple Integration Tests', () => {
  let gameManager: GameManager;

  beforeEach(() => {
    gameManager = new GameManager(['Alice', 'Bob', 'Charlie', 'Dave'], ['Team 1', 'Team 2']);
  });

  describe('Basic Game Flow', () => {
    it('should handle a complete hand properly', () => {
      // Initially empty
      expect(gameManager.state.hands.length).toBe(0);
      expect(gameManager.getScores()).toEqual([0, 0]);
      
      // Start first hand - Alice deals, Alice bids 4
      gameManager.addHandPart('1'); // Dealer: Alice
      expect(gameManager.state.hands.length).toBe(1);
      expect(getCurrentPhase(gameManager.getCurrentHand())).toBe('bidder');
      
      gameManager.addHandPart('1'); // Bidder: Alice wins bid
      expect(getCurrentPhase(gameManager.getCurrentHand())).toBe('bid');
      
      gameManager.addHandPart('4'); // Bid: 4
      expect(getCurrentPhase(gameManager.getCurrentHand())).toBe('trump');
      
      gameManager.addHandPart('H'); // Trump: Hearts
      expect(getCurrentPhase(gameManager.getCurrentHand())).toBe('decision');
      
      gameManager.addHandPart('P'); // Decision: Play
      expect(getCurrentPhase(gameManager.getCurrentHand())).toBe('tricks');
      
      gameManager.addHandPart('2'); // Tricks: Defending team gets 2, bidding team gets 4
      
      // Hand should be complete now and next hand started
      expect(gameManager.state.hands.length).toBe(2); // Completed hand + next dealer
      expect(isHandComplete(gameManager.state.hands[0])).toBe(true);
      expect(gameManager.state.hands[0]).toBe('114HP2'); // Complete hand
      expect(gameManager.state.hands[1]).toBe('2'); // Next dealer (Bob)
      
      // Scores should be updated
      const scores = gameManager.getScores();
      expect(scores[0]).toBe(4); // Alice's team made their bid
      expect(scores[1]).toBe(2); // Bob's team got 2 tricks
    });

    it('should handle folding correctly', () => {
      // Start hand
      gameManager.addHandPart('1'); // Dealer: Alice
      gameManager.addHandPart('2'); // Bidder: Bob wins bid
      gameManager.addHandPart('5'); // Bid: 5
      gameManager.addHandPart('S'); // Trump: Spades
      gameManager.addHandPart('F'); // Decision: Fold
      gameManager.addHandPart('0'); // Tricks: 0 for fold
      
      // Folding should complete the hand
      expect(gameManager.state.hands.length).toBe(2); // Completed hand + next dealer
      expect(isHandComplete(gameManager.state.hands[0])).toBe(true);
      expect(gameManager.state.hands[0]).toBe('125SF0'); // Complete hand with 0 tricks for fold
      
      // Scores: Bob's team gets 5 points for the fold
      const scores = gameManager.getScores();
      expect(scores[1]).toBe(5); // Bob's team (bidding team gets bid when defending team folds)
      expect(scores[0]).toBe(0); // Alice's team gets 0
    });

    it('should handle throw-ins correctly', () => {
      // Start hand with throw-in
      gameManager.addHandPart('1'); // Dealer: Alice
      gameManager.addHandPart('0'); // Bidder: Throw-in (no bidder)
      
      // Throw-in should be complete immediately
      expect(gameManager.state.hands.length).toBe(2); // Completed throw-in + next dealer
      expect(isHandComplete(gameManager.state.hands[0])).toBe(true);
      expect(gameManager.state.hands[0]).toBe('10'); // Complete throw-in
      
      // Scores should be unchanged for throw-in
      const scores = gameManager.getScores();
      expect(scores).toEqual([0, 0]);
    });

    it('should detect game completion', () => {
      expect(gameManager.isGameComplete()).toBe(false);
      
      // Play several high-scoring hands to reach 42+ points
      // Hand 1: Alice bids Moon (7) and makes it
      gameManager.addHandPart('1'); // Dealer
      gameManager.addHandPart('1'); // Bidder: Alice
      gameManager.addHandPart('M'); // Bid: Moon
      gameManager.addHandPart('N'); // Trump: No trump
      gameManager.addHandPart('P'); // Decision: Play
      gameManager.addHandPart('0'); // Tricks: Alice takes all 6
      
      let scores = gameManager.getScores();
      expect(scores[0]).toBe(7); // Alice's team gets 7 for Moon
      expect(gameManager.isGameComplete()).toBe(false);
      
      // Hand 2: Bob bids Double Moon (14) and makes it
      gameManager.addHandPart('2'); // Bidder: Bob
      gameManager.addHandPart('D'); // Bid: Double Moon
      gameManager.addHandPart('C'); // Trump: Clubs
      gameManager.addHandPart('P'); // Decision: Play
      gameManager.addHandPart('0'); // Tricks: Bob takes all 6
      
      scores = gameManager.getScores();
      console.log('All hands after Bob Double Moon:', gameManager.state.hands);
      console.log('Final scores:', scores);
      
      // Debug individual hand calculations
      const hand1Scores = calculateScore(gameManager.state.hands[0]);
      const hand2Scores = calculateScore(gameManager.state.hands[1]);
      console.log('Hand 1 scores:', hand1Scores);
      console.log('Hand 2 scores:', hand2Scores);
      console.log('Expected combined:', [hand1Scores[0] + hand2Scores[0], hand1Scores[1] + hand2Scores[1]]);
      
      // Alice made Moon: [+7, -7] (Alice's team +7, Bob's team -7)
      // Bob made Double Moon: [-14, +14] (Alice's team -14, Bob's team +14)  
      // Combined: [7 + (-14), (-7) + 14] = [-7, 7]
      expect(scores[0]).toBe(-7); // Alice's team: 7 - 14 = -7
      expect(scores[1]).toBe(7);  // Bob's team: -7 + 14 = 7
      expect(gameManager.isGameComplete()).toBe(false);
      
      // Hand 3: Charlie bids Double Moon (14) and makes it to win
      gameManager.addHandPart('3'); // Bidder: Charlie
      gameManager.addHandPart('D'); // Bid: Double Moon
      gameManager.addHandPart('H'); // Trump: Hearts
      gameManager.addHandPart('P'); // Decision: Play
      gameManager.addHandPart('0'); // Tricks: Charlie takes all 6
      
      scores = gameManager.getScores();
      expect(scores[0]).toBe(21); // Alice's team: 7 + 14 = 21
      expect(gameManager.isGameComplete()).toBe(false); // Still under 30
      
      // Hand 4: Alice bids 6 and makes it to go over 30
      gameManager.addHandPart('1'); // Bidder: Alice
      gameManager.addHandPart('6'); // Bid: 6
      gameManager.addHandPart('D'); // Trump: Diamonds
      gameManager.addHandPart('P'); // Decision: Play
      gameManager.addHandPart('0'); // Tricks: Alice takes all 6
      
      scores = gameManager.getScores();
      expect(scores[0]).toBe(27); // Alice's team: 21 + 6 = 27
      expect(gameManager.isGameComplete()).toBe(false); // Still need more
      
      // Hand 5: Alice bids 6 again
      gameManager.addHandPart('1'); // Bidder: Alice
      gameManager.addHandPart('6'); // Bid: 6
      gameManager.addHandPart('S'); // Trump: Spades
      gameManager.addHandPart('P'); // Decision: Play
      gameManager.addHandPart('0'); // Tricks: Alice takes all 6
      
      scores = gameManager.getScores();
      expect(scores[0]).toBe(33); // Alice's team: 27 + 6 = 33
      expect(gameManager.isGameComplete()).toBe(false); // Still under 42
      
      // Hand 6: Alice bids another 6 to win
      gameManager.addHandPart('1'); // Bidder: Alice
      gameManager.addHandPart('6'); // Bid: 6
      gameManager.addHandPart('C'); // Trump: Clubs
      gameManager.addHandPart('P'); // Decision: Play
      gameManager.addHandPart('0'); // Tricks: Alice takes all 6
      
      scores = gameManager.getScores();
      expect(scores[0]).toBe(39); // Alice's team: 33 + 6 = 39
      expect(gameManager.isGameComplete()).toBe(false); // Still under 42
      
      // Hand 7: Alice bids 4 to go over 42
      gameManager.addHandPart('1'); // Bidder: Alice
      gameManager.addHandPart('4'); // Bid: 4
      gameManager.addHandPart('H'); // Trump: Hearts
      gameManager.addHandPart('P'); // Decision: Play
      gameManager.addHandPart('2'); // Tricks: Alice makes the bid
      
      scores = gameManager.getScores();
      expect(scores[0]).toBe(43); // Alice's team: 39 + 4 = 43
      expect(gameManager.isGameComplete()).toBe(true); // Game complete!
      expect(gameManager.getWinner()).toBe(0); // Alice's team wins
    });
  });

  describe('Series Integration', () => {
    it('should convert completed game to series', () => {
      // Complete a game first
      while (!gameManager.isGameComplete()) {
        const handCount = gameManager.state.hands.length;
        const dealer = handCount === 0 ? 1 : (handCount % 4) + 1;
        
        if (handCount === 0 || !isHandComplete(gameManager.getCurrentHand())) {
          gameManager.addHandPart(dealer.toString()); // Dealer
        }
        gameManager.addHandPart('1'); // Alice always wins bid
        gameManager.addHandPart('6'); // Bid 6
        gameManager.addHandPart('H'); // Trump Hearts
        gameManager.addHandPart('P'); // Play
        gameManager.addHandPart('0'); // Alice takes all tricks
      }
      
      expect(gameManager.isGameComplete()).toBe(true);
      expect(gameManager.getWinner()).toBe(0);
      
      // Convert to series
      gameManager.convertToSeries();
      
      expect(gameManager.state.isSeries).toBe(true);
      expect(gameManager.state.seriesScores).toEqual([1, 0]); // Alice's team has 1 win
      expect(gameManager.state.completedGames?.length).toBe(1);
      
      // Start next game
      gameManager.startNextGame();
      
      expect(gameManager.isGameComplete()).toBe(false);
      expect(gameManager.getScores()).toEqual([0, 0]); // Fresh game
      expect(gameManager.state.seriesScores).toEqual([1, 0]); // Series scores preserved
    });
  });

  describe('JSON Serialization', () => {
    it('should preserve state through serialization', () => {
      // Play partial game
      gameManager.addHandPart('1'); // Dealer
      gameManager.addHandPart('2'); // Bidder: Bob
      gameManager.addHandPart('5'); // Bid: 5
      gameManager.addHandPart('H'); // Trump: Hearts
      
      const serialized = gameManager.toJSON();
      const restored = GameManager.fromJSON(serialized);
      
      expect(restored.state.players).toEqual(gameManager.state.players);
      expect(restored.state.hands).toEqual(gameManager.state.hands);
      expect(restored.getCurrentHand()).toBe('125H');
      expect(getCurrentPhase(restored.getCurrentHand())).toBe('decision');
      
      // Should be able to continue gameplay
      restored.addHandPart('P');
      restored.addHandPart('3');
      
      expect(restored.state.hands.length).toBe(2); // Completed hand + next dealer
      expect(restored.getScores()[1]).toBeGreaterThan(0); // Bob's team scored
    });
  });
});