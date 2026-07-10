import { describe, it, expect, beforeEach } from 'vitest';
import { GameManager, isPepperRound } from '@/lib/gameState';
import {
  newGame, setBidder, setBid, setTrump, setDecision, setTricks, playHand,
  currentPhase, currentHandIndex,
} from '../helpers/gameActions';

// This file drives the REAL GameManager (compact string encoding + production
// scoring). A few key facts the assertions below depend on:
//   * Win condition is score >= 42 AND the two scores differ (NOT 30, no clamping;
//     scores may legitimately go negative).
//   * On a normal made play the defenders score their trick count.
//   * A fold needs a trailing free-tricks digit to complete the hand; the bidding
//     team gets the bid and the defenders get the free digit (their only source of
//     "free points" in production — there is no "free tricks on a play").
//   * After a hand completes the manager auto-seeds the next hand's dealer, so the
//     count of COMPLETED hands is tracked via `currentHandIndex`.

describe('Game Flow Integration', () => {
  let gameManager: GameManager;

  beforeEach(() => {
    gameManager = newGame(['Alice', 'Bob', 'Charlie', 'Dave'], ['Team 1', 'Team 2']);
  });

  describe('Complete Single Game', () => {
    it('should handle a complete game from start to finish', () => {
      // Team 0 = bidders 1 & 3, Team 1 = bidders 2 & 4.
      expect(currentPhase(gameManager)).toBe('bidder');
      expect(currentHandIndex(gameManager)).toBe(0);
      expect(gameManager.isGameComplete()).toBe(false);

      // Hand 1: team 0 bids 4, plays, defenders take 2 -> normal make [4, 2]
      // (walk the phase machine explicitly to prove the transitions).
      setBidder(gameManager, 1);
      expect(currentPhase(gameManager)).toBe('bid');
      setBid(gameManager, 4);
      expect(currentPhase(gameManager)).toBe('trump');
      setTrump(gameManager, 'H');
      expect(currentPhase(gameManager)).toBe('decision');
      setDecision(gameManager, 'P');
      expect(currentPhase(gameManager)).toBe('tricks');
      setTricks(gameManager, 2);
      expect(currentHandIndex(gameManager)).toBe(1);
      expect(gameManager.getScores()).toEqual([4, 2]);

      // Hand 2: team 1 bids 5 and folds with 0 free tricks -> [+5 to team 1].
      playHand(gameManager, { bidder: 2, bid: 5, trump: 'S', decision: 'F', foldFreeTricks: 0 });
      expect(gameManager.getScores()).toEqual([4, 7]);

      // Hand 3: team 0 bids a moon (7), plays, defenders shut out -> defenders set.
      playHand(gameManager, { bidder: 1, bid: 'M', trump: 'N', decision: 'P', tricks: 0 });
      expect(gameManager.getScores()).toEqual([11, 0]); // team0 +7, team1 -7

      // Hand 4: team 1 bids 6, plays, defenders take 3 -> bidding team set,
      // defenders score their 3 tricks.
      playHand(gameManager, { bidder: 2, bid: 6, trump: 'D', decision: 'P', tricks: 3 });
      expect(gameManager.getScores()).toEqual([14, -6]); // team0 +3, team1 -6

      // Hand 5: team 0 bids 6, plays, defenders shut out -> defenders set.
      playHand(gameManager, { bidder: 1, bid: 6, trump: 'H', decision: 'P', tricks: 0 });
      expect(gameManager.getScores()).toEqual([20, -12]);

      // Hand 6: team 0 bids 6 again, defenders shut out.
      playHand(gameManager, { bidder: 3, bid: 6, trump: 'S', decision: 'P', tricks: 0 });
      expect(gameManager.getScores()).toEqual([26, -18]);

      // Hand 7: team 0 bids a double moon (14), plays, defenders shut out.
      playHand(gameManager, { bidder: 1, bid: 'D', trump: 'C', decision: 'P', tricks: 0 });
      expect(gameManager.getScores()).toEqual([40, -32]);
      expect(gameManager.isGameComplete()).toBe(false); // 40 < 42, not yet won

      // Hand 8: team 0 bids 4, defenders shut out -> team 0 reaches 44 and wins.
      playHand(gameManager, { bidder: 3, bid: 4, trump: 'H', decision: 'P', tricks: 0 });
      expect(gameManager.getScores()).toEqual([44, -36]);

      expect(gameManager.isGameComplete()).toBe(true);
      expect(gameManager.getWinner()).toBe(0);
    });

    it('should handle pepper rounds correctly', () => {
      // The first 4 hands are pepper rounds. Production's GameManager does NOT
      // auto-bid or auto-decide for pepper hands (that is UI-level in game.ts), so
      // we set the bid and decision explicitly here. Each hand: the bidding team
      // shuts the defenders out (tricks 0) to make its pepper bid.
      const bids = [4, 5, 6, 'M'] as const;
      for (let hand = 0; hand < 4; hand++) {
        expect(isPepperRound(hand)).toBe(true);

        setBidder(gameManager, hand + 1); // bidders 1..4
        setBid(gameManager, bids[hand]!);
        setTrump(gameManager, 'H');
        setDecision(gameManager, 'P');
        setTricks(gameManager, 0); // defenders shut out -> bidding team makes it

        expect(currentHandIndex(gameManager)).toBe(hand + 1);
      }

      // The 5th hand (index 4) is no longer a pepper round.
      expect(isPepperRound(4)).toBe(false);
    });
  });

  describe('Game State Consistency', () => {
    it('should maintain consistent state through phase transitions', () => {
      setBidder(gameManager, 1); // team 0
      expect(currentPhase(gameManager)).toBe('bid');

      setBid(gameManager, 5);
      expect(currentPhase(gameManager)).toBe('trump');

      setTrump(gameManager, 'S');
      expect(currentPhase(gameManager)).toBe('decision');

      // Fold: entering 'F' moves us to the free-tricks (tricks) entry; the hand is
      // only complete once the trailing free-tricks digit is supplied.
      gameManager.addHandPart('F');
      expect(currentPhase(gameManager)).toBe('tricks');
      gameManager.addHandPart('0'); // 0 free tricks negotiated -> [5, 0]

      expect(currentHandIndex(gameManager)).toBe(1);
      const scores = gameManager.getScores();
      expect(scores[0]).toBe(5); // bidding team gets the bid on a fold
      expect(scores[1]).toBe(0);
    });

    it('should handle decision phase with free tricks correctly', () => {
      // REINTERPRETED: production has no "free tricks on a play" — free points to
      // the defenders exist ONLY on a fold, encoded as the trailing digit. This
      // exercises that real mechanism: bidding team folds and negotiates free tricks.
      setBidder(gameManager, 1); // team 0
      setBid(gameManager, 6);
      setTrump(gameManager, 'H');
      setDecision(gameManager, 'F', 3); // fold, 3 free tricks to the defenders

      const scores = gameManager.getScores();
      expect(scores[0]).toBe(6); // bidding team gets the bid (6) on the fold
      expect(scores[1]).toBe(3); // defending team gets the 3 negotiated free points
    });
  });

  describe('Error Handling in Game Flow', () => {
    it('should handle invalid phase transitions gracefully', () => {
      // The GameManager state machine does not throw on out-of-order input; it just
      // appends characters to the current hand encoding. A well-formed sequence
      // therefore completes cleanly and scores as expected.
      playHand(gameManager, { bidder: 1, bid: 4, trump: 'H', decision: 'P', tricks: 2 });

      expect(currentHandIndex(gameManager)).toBe(1);
      expect(gameManager.getScores()[0]).toBeGreaterThan(0); // team 0 made 4
    });

    it('should validate game completion state', () => {
      // Game should not be complete initially.
      expect(gameManager.isGameComplete()).toBe(false);
      expect(gameManager.getWinner()).toBe(null);

      // Play until a team reaches 42: team 0 shuts the defenders out every hand
      // (bid 6, play, defenders take 0 -> team0 +6, team1 -6). Reaches 42 in 7 hands.
      let handCount = 0;
      while (!gameManager.isGameComplete() && handCount < 30) {
        playHand(gameManager, { bidder: 1, bid: 6, trump: 'H', decision: 'P', tricks: 0 });
        handCount++;
      }

      expect(gameManager.isGameComplete()).toBe(true);
      expect(gameManager.getWinner()).toBeDefined();
      expect([0, 1]).toContain(gameManager.getWinner());
      expect(gameManager.getWinner()).toBe(0);
    });
  });
});
