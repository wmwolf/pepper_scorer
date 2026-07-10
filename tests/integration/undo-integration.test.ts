import { describe, it, expect, beforeEach } from 'vitest';
import { GameManager, isPepperRound } from '@/lib/gameState';
import {
  newGame, setBidder, setBid, setTrump, setDecision, setTricks,
  currentPhase, currentHandIndex, canUndo,
  getCurrentBidder, getCurrentBid, getCurrentTrump, getCurrentDecision,
} from '../helpers/gameActions';

// Drives a game to completion with team 0 (odd seats) sweeping every hand:
// bid 6, play, defenders take 0 tricks -> team 0 +6, team 1 -6 each hand.
function winGameForTeam0(m: GameManager) {
  let guard = 0;
  while (!m.isGameComplete() && guard++ < 30) {
    setBidder(m, 1);
    setBid(m, 6);
    setTrump(m, 'H');
    setDecision(m, 'P');
    setTricks(m, 0);
  }
}

describe('Undo Integration', () => {
  let gameManager: GameManager;

  beforeEach(() => {
    gameManager = newGame();
  });

  describe('Cross-Phase Undo Operations', () => {
    it('undoes bidder/decision/tricks phases back to the previous one, preserving earlier inputs', () => {
      // Note: undoing FROM the trump phase is a special case (see the dedicated tests
      // below) — on the first hand it returns to setup, on pepper hands it steps back a
      // hand. This test covers the plain single-step phase reversals.

      // bidder -> bid, then undo bid phase -> bidder (bidder cleared)
      setBidder(gameManager, 1);
      expect(currentPhase(gameManager)).toBe('bid');
      expect(canUndo(gameManager)).toBe(true);

      gameManager.undo();
      expect(currentPhase(gameManager)).toBe('bidder');
      expect(getCurrentBidder(gameManager)).toBe(null);

      // build through to the decision phase
      setBidder(gameManager, 1);
      setBid(gameManager, 5);
      setTrump(gameManager, 'H');
      expect(currentPhase(gameManager)).toBe('decision');

      // undo decision phase -> trump (trump cleared, bid preserved)
      gameManager.undo();
      expect(currentPhase(gameManager)).toBe('trump');
      expect(getCurrentTrump(gameManager)).toBe(null);
      expect(getCurrentBid(gameManager)).toBe(5);

      // build through to the tricks phase (non-clubs trump avoids the clubs special case)
      setTrump(gameManager, 'S');
      setDecision(gameManager, 'P');
      expect(currentPhase(gameManager)).toBe('tricks');

      // undo tricks phase -> decision (decision cleared, trump preserved)
      gameManager.undo();
      expect(currentPhase(gameManager)).toBe('decision');
      expect(getCurrentDecision(gameManager)).toBe(null);
      expect(getCurrentTrump(gameManager)).toBe('S');
    });

    it('returns to setup when undoing at the first hand trump phase', () => {
      setBidder(gameManager, 1);
      setBid(gameManager, 5);
      expect(currentPhase(gameManager)).toBe('trump');
      // The first hand at the trump phase has nothing earlier in-game to revert to, so
      // production navigates back to setup (mocked in tests) rather than throwing.
      expect(() => gameManager.undo()).not.toThrow();
    });

    it('crosses back into the previous hand when undoing at the bidder phase', () => {
      // Complete the first hand: bid 4, play, defenders take 2 -> [4, 2].
      setBidder(gameManager, 1);
      setBid(gameManager, 4);
      setTrump(gameManager, 'H');
      setDecision(gameManager, 'P');
      setTricks(gameManager, 2);

      // The next hand is auto-seeded with its dealer, so we sit at the bidder phase.
      expect(currentHandIndex(gameManager)).toBe(1);
      expect(currentPhase(gameManager)).toBe('bidder');
      expect(gameManager.getScores()).toEqual([4, 2]);

      // Undo at the bidder phase steps back into the previous hand's tricks phase.
      gameManager.undo();
      expect(currentHandIndex(gameManager)).toBe(0);
      expect(currentPhase(gameManager)).toBe('tricks');
      expect(getCurrentBidder(gameManager)).toBe(1);
      expect(getCurrentBid(gameManager)).toBe(4);
      expect(getCurrentTrump(gameManager)).toBe('H');
      expect(gameManager.getScores()).toEqual([0, 0]); // scores reverted

      // A different result is now possible.
      setTricks(gameManager, 1); // bid 4, play, defenders take 1 -> [4, 1]
      expect(currentHandIndex(gameManager)).toBe(1);
      expect(gameManager.getScores()).toEqual([4, 1]);
    });

    it('undoes a fold back through free-tricks entry and then to the decision', () => {
      setBidder(gameManager, 1);
      setBid(gameManager, 5);
      setTrump(gameManager, 'H');
      setDecision(gameManager, 'F'); // fold with 0 free tricks completes the hand

      expect(currentHandIndex(gameManager)).toBe(1);
      expect(currentPhase(gameManager)).toBe('bidder');
      expect(gameManager.getScores()).toEqual([5, 0]); // bidding team gets the bid on a fold

      // First undo returns to the fold's free-tricks (tricks) entry, still folded.
      gameManager.undo();
      expect(currentHandIndex(gameManager)).toBe(0);
      expect(currentPhase(gameManager)).toBe('tricks');
      expect(getCurrentDecision(gameManager)).toBe('F');
      expect(gameManager.getScores()).toEqual([0, 0]);

      // Second undo returns to the decision phase (decision cleared).
      gameManager.undo();
      expect(currentPhase(gameManager)).toBe('decision');
      expect(getCurrentDecision(gameManager)).toBe(null);

      // Choose to play instead: bid 5, play, defenders take 3 -> bidding team is set [-5, 3].
      setDecision(gameManager, 'P');
      setTricks(gameManager, 3);
      expect(gameManager.getScores()).toEqual([-5, 3]);
    });
  });

  describe('Undo with Game State Consistency', () => {
    it('restores an identical snapshot after undoing a completed hand', () => {
      // Build up to the tricks phase of a moon, no-trump hand.
      setBidder(gameManager, 3);
      setBid(gameManager, 'M');
      setTrump(gameManager, 'N');
      setDecision(gameManager, 'P');

      const beforeTricks = gameManager.toJSON();

      setTricks(gameManager, 1); // moon played, defenders take 1 -> bidding team set
      expect(currentHandIndex(gameManager)).toBe(1);

      gameManager.undo();
      expect(gameManager.toJSON()).toBe(beforeTricks);

      // A different outcome is possible from the restored state.
      setTricks(gameManager, 0); // defenders shut out -> moon made
      expect(gameManager.getScores()).not.toEqual([0, 0]);
    });

    it('undoes at the trump phase of a pepper round via the pepper special case', () => {
      // Complete the first (pepper) hand: bid 4, play, defenders take 2 -> [4, 2].
      setBidder(gameManager, 1);
      setBid(gameManager, 4);
      setTrump(gameManager, 'H');
      setDecision(gameManager, 'P');
      setTricks(gameManager, 2);

      // Advance the second (still pepper) hand to the trump phase.
      setBidder(gameManager, 2);
      setBid(gameManager, 4);
      expect(currentHandIndex(gameManager)).toBe(1);
      expect(isPepperRound(currentHandIndex(gameManager))).toBe(true);
      expect(currentPhase(gameManager)).toBe('trump');

      // Undo at a pepper-round trump phase drops the current hand and steps the
      // previous hand back to its last entered phase.
      gameManager.undo();
      expect(currentHandIndex(gameManager)).toBe(0);
      expect(currentPhase(gameManager)).toBe('tricks');
      expect(gameManager.getScores()).toEqual([0, 0]);

      // The fifth hand is no longer a pepper round.
      expect(isPepperRound(4)).toBe(false);
    });
  });

  describe('Undo in Series Context', () => {
    it('preserves series state when undoing within a later game', () => {
      // Win the first game, then convert it into a series.
      winGameForTeam0(gameManager);
      expect(gameManager.isGameComplete()).toBe(true);
      gameManager.completeGame();
      gameManager.convertToSeries();
      expect(gameManager.state.isSeries).toBe(true);
      expect(gameManager.state.seriesScores).toEqual([1, 0]);

      // Start the second game and play one hand.
      gameManager.startNextGame();
      expect(gameManager.state.gameNumber).toBe(2);
      setBidder(gameManager, 1);
      setBid(gameManager, 6);
      setTrump(gameManager, 'H');
      setDecision(gameManager, 'P');
      setTricks(gameManager, 2); // bid 6 played, defenders take 2 -> bidding team set

      const scoresAfterHand = gameManager.getScores();

      // Undo the hand; the series scaffolding must survive untouched.
      gameManager.undo();
      expect(gameManager.state.isSeries).toBe(true);
      expect(gameManager.state.seriesScores).toEqual([1, 0]);
      expect(gameManager.state.completedGames).toHaveLength(1);
      expect(gameManager.getScores()).toEqual([0, 0]);
      expect(gameManager.getScores()).not.toEqual(scoresAfterHand);
    });
  });

  describe('Undo Error Handling', () => {
    it('does not throw when undoing with no history', () => {
      expect(canUndo(gameManager)).toBe(false);
      // Production navigates back to setup (mocked in tests) rather than throwing.
      expect(() => gameManager.undo()).not.toThrow();
    });

    it('remains consistent when undoing right after a game completes', () => {
      winGameForTeam0(gameManager);
      expect(gameManager.isGameComplete()).toBe(true);
      const winningScores = gameManager.getScores();

      // Undo the winning trick: the game is no longer complete and scores drop.
      gameManager.undo();
      expect(gameManager.isGameComplete()).toBe(false);
      expect(gameManager.getScores()).not.toEqual(winningScores);
      expect(currentPhase(gameManager)).toBe('tricks');
    });
  });
});
