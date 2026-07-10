import { describe, it, expect, beforeEach } from 'vitest';
import { GameManager, getCurrentPhase, isHandComplete } from '@/lib/gameState';

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

      // Reinterpretation note: the original version had a team-1 player (Bob, seat 2)
      // bid a double moon between Alice's hands. Under the real scoring that SUBTRACTS
      // 14 from team 0, so team 0 never actually reached 42. To preserve the test's
      // intent (drive team 0 to a win and detect completion) every bidder here is a
      // team-0 player (seats 1 & 3), so team 0's score climbs monotonically.
      //
      // Every "play, defenders take 0 tricks" hand SETS the defenders:
      //   bidding team +bidValue, defending team -bidValue.

      // Hand 1: Alice (seat 1) bids Moon (7), plays, defenders shut out -> +7.
      gameManager.addHandPart('1'); // Dealer: Alice
      gameManager.addHandPart('1'); // Bidder: Alice (team 0)
      gameManager.addHandPart('M'); // Bid: Moon
      gameManager.addHandPart('N'); // Trump: No trump
      gameManager.addHandPart('P'); // Decision: Play
      gameManager.addHandPart('0'); // Defenders take 0 tricks

      let scores = gameManager.getScores();
      expect(scores).toEqual([7, -7]); // Alice's team +7, defenders set -7
      expect(gameManager.isGameComplete()).toBe(false);

      // Hand 2: Charlie (seat 3, also team 0) bids Double Moon (14), plays, +14.
      // (Dealer for this hand was auto-seeded when hand 1 completed.)
      gameManager.addHandPart('3'); // Bidder: Charlie (team 0)
      gameManager.addHandPart('D'); // Bid: Double Moon
      gameManager.addHandPart('C'); // Trump: Clubs
      gameManager.addHandPart('P'); // Decision: Play
      gameManager.addHandPart('0'); // Defenders take 0 tricks

      scores = gameManager.getScores();
      expect(scores).toEqual([21, -21]); // 7 + 14 = 21
      expect(gameManager.isGameComplete()).toBe(false);

      // Hand 3: Alice bids Double Moon (14) again, plays, +14.
      gameManager.addHandPart('1'); // Bidder: Alice
      gameManager.addHandPart('D'); // Bid: Double Moon
      gameManager.addHandPart('H'); // Trump: Hearts
      gameManager.addHandPart('P'); // Decision: Play
      gameManager.addHandPart('0'); // Defenders take 0 tricks

      scores = gameManager.getScores();
      expect(scores).toEqual([35, -35]); // 21 + 14 = 35
      expect(gameManager.isGameComplete()).toBe(false); // Still under 42

      // Hand 4: Charlie bids 6, plays, +6 -> 41, still just under 42.
      gameManager.addHandPart('3'); // Bidder: Charlie
      gameManager.addHandPart('6'); // Bid: 6
      gameManager.addHandPart('D'); // Trump: Diamonds
      gameManager.addHandPart('P'); // Decision: Play
      gameManager.addHandPart('0'); // Defenders take 0 tricks

      scores = gameManager.getScores();
      expect(scores).toEqual([41, -41]); // 35 + 6 = 41
      expect(gameManager.isGameComplete()).toBe(false); // 41 < 42

      // Hand 5: Alice bids 4 and simply makes it (defenders take 2 of the 6 tricks)
      // -> bidding +4, defending +2, pushing team 0 to 45 and winning.
      gameManager.addHandPart('1'); // Bidder: Alice
      gameManager.addHandPart('4'); // Bid: 4
      gameManager.addHandPart('H'); // Trump: Hearts
      gameManager.addHandPart('P'); // Decision: Play
      gameManager.addHandPart('2'); // Defenders take 2 -> bid made

      scores = gameManager.getScores();
      expect(scores).toEqual([45, -39]); // 41 + 4 = 45 (team 0); -41 + 2 = -39 (team 1)
      expect(gameManager.isGameComplete()).toBe(true); // Game complete!
      expect(gameManager.getWinner()).toBe(0); // Alice's team wins
    });
  });

  describe('Series Integration', () => {
    it('should convert completed game to series', () => {
      // Complete a game first. Alice (seat 1, team 0) wins every bid at 6, plays, and
      // shuts the defenders out (they take 0 tricks) -> team 0 +6, team 1 -6 each hand,
      // reaching 42 after 7 hands.
      //
      // Note: after a hand completes the GameManager auto-seeds the NEXT dealer, so we
      // only add a dealer character for the very first hand. (The original loop added a
      // dealer on every iteration, appending it on top of the auto-seeded one and
      // corrupting the bidder assignment so team 1 ended up winning.)
      while (!gameManager.isGameComplete()) {
        const current = gameManager.getCurrentHand();
        if (!current || isHandComplete(current)) {
          gameManager.addHandPart('1'); // Dealer for the first hand only
        }
        gameManager.addHandPart('1'); // Alice always wins bid (team 0)
        gameManager.addHandPart('6'); // Bid 6
        gameManager.addHandPart('H'); // Trump Hearts
        gameManager.addHandPart('P'); // Play
        gameManager.addHandPart('0'); // Defenders take 0 tricks
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
      
      // Should be able to continue gameplay. Bob (seat 2, team 1) bid 5; he must hold the
      // defenders to at most 1 trick to MAKE the bid (defenders + tricksNeeded 5 must not
      // exceed 6). Defenders take 1 -> bidding team 1 makes it (+5), defenders get +1.
      // (The original used 3 defender tricks, which SETS the bidder to -5 and contradicts
      // the "Bob's team scored" intent.)
      restored.addHandPart('P');
      restored.addHandPart('1');

      expect(restored.state.hands.length).toBe(2); // Completed hand + next dealer
      expect(restored.getScores()[1]).toBeGreaterThan(0); // Bob's team scored (+5)
    });
  });
});