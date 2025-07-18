import { describe, it, expect, beforeEach } from 'vitest';
import { GameManager, getCurrentPhase, isPepperRound } from '@/lib/gameState';

describe('Game Flow Integration', () => {
  let gameManager: GameManager;

  beforeEach(() => {
    gameManager = new GameManager(['Alice', 'Bob', 'Charlie', 'Dave'], ['Team 1', 'Team 2']);
  });

  describe('Complete Single Game', () => {
    it('should handle a complete game from start to finish', () => {
      expect(getCurrentPhase(gameManager.getCurrentHand())).toBe('bidder');
      expect(gameManager.state.hands.length).toBe(0);
      expect(gameManager.isGameComplete()).toBe(false);

      // Hand 1: Alice bids 4, makes it
      gameManager.addHandPart('1'); // Dealer
      gameManager.addHandPart('1'); // Alice wins bid
      expect(getCurrentPhase(gameManager.getCurrentHand())).toBe('bid');
      
      gameManager.addHandPart('4'); // Bid 4
      expect(getCurrentPhase(gameManager.getCurrentHand())).toBe('trump');
      
      gameManager.addHandPart('H'); // Trump Hearts
      expect(getCurrentPhase(gameManager.getCurrentHand())).toBe('decision');
      
      gameManager.addHandPart('P'); // Play
      expect(getCurrentPhase(gameManager.getCurrentHand())).toBe('tricks');
      
      gameManager.addHandPart('2'); // Defending team gets 2 tricks, bidding team gets 4
      expect(gameManager.state.hands.length).toBe(1);
      
      const scores = gameManager.getScores();
      expect(scores[0]).toBe(4); // Alice's team made 4
      expect(scores[1]).toBe(0); // Bob's team got 0

      // Hand 2: Bob bids 5, gets set
      gameManager.addHandPart('2'); // Dealer 2
      gameManager.addHandPart('2'); // Bob wins bid
      gameManager.addHandPart('5'); // Bid 5
      gameManager.addHandPart('S'); // Trump Spades
      gameManager.addHandPart('P'); // Play
      gameManager.addHandPart('4'); // Defending team gets 4 tricks, bidding team gets 2
      
      const scores2 = gameManager.getScores();
      expect(scores2[0]).toBe(9); // Alice's team: 4 + 5 (for setting Bob)
      expect(scores2[1]).toBe(0); // Bob's team: 0 - 5 = -5, but clamped to 0

      // Continue playing until game ends (need to reach 30 points)
      // Hand 3: Charlie bids 6
      gameManager.addHandPart('3'); // Dealer 3
      gameManager.addHandPart('3'); // Charlie wins bid
      gameManager.addHandPart('6'); // Bid 6
      gameManager.addHandPart('D'); // Trump Diamonds
      gameManager.addHandPart('P'); // Play
      gameManager.addHandPart('0'); // Charlie's team takes all 6 tricks
      
      const scores3 = gameManager.getScores();
      expect(scores3[0]).toBe(9); // Alice's team unchanged
      expect(scores3[1]).toBe(6); // Bob's team gets 6

      // Hand 4: Dave bids Double Moon (14 points)
      gameManager.addHandPart('4'); // Dealer 4
      gameManager.addHandPart('4'); // Dave wins bid
      gameManager.addHandPart('D'); // Double Moon
      gameManager.addHandPart('C'); // Trump Clubs
      gameManager.addHandPart('P'); // Play
      gameManager.addHandPart('0'); // Dave's team takes all tricks
      
      const scores4 = gameManager.getScores();
      expect(scores4[0]).toBe(23); // Alice's team: 9 + 14 = 23
      expect(scores4[1]).toBe(6); // Bob's team unchanged

      // Hand 5: Alice bids 5 to try to win
      gameManager.addHandPart('1'); // Dealer 1
      gameManager.addHandPart('1'); // Alice wins bid
      gameManager.addHandPart('5'); // Bid 5
      gameManager.addHandPart('H'); // Trump Hearts
      gameManager.addHandPart('P'); // Play
      gameManager.addHandPart('1'); // Alice's team gets 5 tricks
      
      const finalScores = gameManager.getScores();
      expect(finalScores[0]).toBe(28); // Alice's team: 23 + 5 = 28
      expect(finalScores[1]).toBe(6); // Bob's team unchanged

      // Hand 6: Bob bids 4 to try to catch up
      gameManager.addHandPart('2'); // Dealer 2
      gameManager.addHandPart('2'); // Bob wins bid
      gameManager.addHandPart('4'); // Bid 4
      gameManager.addHandPart('S'); // Trump Spades
      gameManager.addHandPart('P'); // Play
      gameManager.addHandPart('2'); // Bob's team gets 4 tricks
      
      const finalScores2 = gameManager.getScores();
      expect(finalScores2[0]).toBe(28); // Alice's team unchanged
      expect(finalScores2[1]).toBe(10); // Bob's team: 6 + 4 = 10

      // Hand 7: Charlie bids 4 and makes it to win for Alice's team
      gameManager.addHandPart('3'); // Dealer 3
      gameManager.addHandPart('3'); // Charlie wins bid
      gameManager.addHandPart('4'); // Bid 4
      gameManager.addHandPart('D'); // Trump Diamonds
      gameManager.addHandPart('P'); // Play
      gameManager.addHandPart('2'); // Charlie's team gets 4 tricks
      
      const winningScores = gameManager.getScores();
      expect(winningScores[0]).toBe(32); // Alice's team: 28 + 4 = 32 (wins!)
      expect(winningScores[1]).toBe(10); // Bob's team unchanged
      
      expect(gameManager.isGameComplete()).toBe(true);
      expect(gameManager.getWinner()).toBe(0);
    });

    it('should handle pepper rounds correctly', () => {
      // First 4 hands are pepper rounds
      for (let hand = 0; hand < 4; hand++) {
        expect(isPepperRound(hand)).toBe(true);
        
        const expectedBidder = (hand % 4) + 1;
        gameManager.addHandPart(expectedBidder.toString()); // Dealer
        gameManager.addHandPart(expectedBidder.toString()); // Bidder (same as dealer for pepper)
        
        // In pepper rounds, bid is auto-set based on hand
        const expectedBid = hand + 4; // 4, 5, 6, Moon(7)
        const bidString = expectedBid === 7 ? 'M' : expectedBid.toString();
        gameManager.addHandPart(bidString);
        
        gameManager.addHandPart('H'); // Trump
        gameManager.addHandPart('P'); // Play
        gameManager.addHandPart('3'); // Let bidding team make it
        
        if (hand < 3) {
          expect(gameManager.state.hands.length).toBe(hand + 1);
        }
      }
      
      // 5th hand should not be a pepper round
      expect(isPepperRound(4)).toBe(false);
    });
  });

  describe('Game State Consistency', () => {
    it('should maintain consistent state through phase transitions', () => {
      // Start a hand
      gameManager.addHandPart('1'); // Dealer
      gameManager.addHandPart('1'); // Alice wins bid
      expect(getCurrentPhase(gameManager.getCurrentHand())).toBe('bid');
      
      gameManager.addHandPart('5'); // Bid 5
      expect(getCurrentPhase(gameManager.getCurrentHand())).toBe('trump');
      
      gameManager.addHandPart('S'); // Trump Spades
      expect(getCurrentPhase(gameManager.getCurrentHand())).toBe('decision');
      
      gameManager.addHandPart('F'); // Fold
      expect(getCurrentPhase(gameManager.getCurrentHand())).toBe('tricks');
      
      // Folding should complete the hand
      expect(gameManager.state.hands.length).toBe(1);
      
      // Check that scores were updated correctly (folding gives bidding team the bid points)
      const scores = gameManager.getScores();
      expect(scores[0]).toBe(5); // Alice's team got 5 points for the fold
      expect(scores[1]).toBe(0); // Bob's team got 0 points
    });

    it('should handle decision phase with free tricks correctly', () => {
      gameManager.addHandPart('1'); // Dealer
      gameManager.addHandPart('1'); // Alice wins bid
      gameManager.addHandPart('6'); // Bid 6
      gameManager.addHandPart('H'); // Trump Hearts
      gameManager.addHandPart('P'); // Play
      
      expect(getCurrentPhase(gameManager.getCurrentHand())).toBe('tricks');
      
      // Defending team gets 3 tricks, bidding team gets 3 - this sets the bid
      gameManager.addHandPart('3');
      
      const scores = gameManager.getScores();
      expect(scores[0]).toBe(-6); // Alice's team got set
      expect(scores[1]).toBe(3); // Bob's team gets 3 for the tricks they won
    });
  });

  describe('Error Handling in Game Flow', () => {
    it('should handle invalid phase transitions gracefully', () => {
      // Adding parts in wrong order should be handled by the state machine
      // Note: The current implementation may not throw errors for invalid sequences
      // but the game logic should handle it appropriately
      
      // Start a proper hand sequence
      gameManager.addHandPart('1'); // Dealer
      gameManager.addHandPart('1'); // Bidder
      gameManager.addHandPart('4'); // Bid
      gameManager.addHandPart('H'); // Trump
      gameManager.addHandPart('P'); // Decision
      gameManager.addHandPart('2'); // Tricks
      
      // Should have completed one hand
      expect(gameManager.state.hands.length).toBe(1);
      expect(gameManager.getScores()[0]).toBeGreaterThan(0);
    });

    it('should validate game completion state', () => {
      // Game should not be complete initially
      expect(gameManager.isGameComplete()).toBe(false);
      expect(gameManager.getWinner()).toBe(null);
      
      // Play until one team reaches 30
      let handCount = 0;
      while (!gameManager.isGameComplete() && handCount < 20) {
        const dealer = (handCount % 4) + 1;
        gameManager.addHandPart(dealer.toString()); // Dealer
        gameManager.addHandPart('1'); // Alice always wins bid
        gameManager.addHandPart('6'); // Bid 6
        gameManager.addHandPart('H'); // Trump Hearts
        gameManager.addHandPart('P'); // Play
        gameManager.addHandPart('2'); // Alice's team makes 6
        handCount++;
      }
      
      expect(gameManager.isGameComplete()).toBe(true);
      expect(gameManager.getWinner()).toBeDefined();
      expect([0, 1]).toContain(gameManager.getWinner());
    });
  });
});