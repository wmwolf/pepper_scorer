import { describe, it, expect } from 'vitest';
import { GameManager } from '@/lib/gameState';
import {
  newGame, setBidder, setBid, setTrump, setDecision, setTricks,
  currentPhase, currentHandIndex, canUndo,
  getCurrentBidder, getCurrentBid, getCurrentTrump, getCurrentDecision,
  type Bid, type Trump, type Decision,
} from '../helpers/gameActions';

// --- Persistence in the REAL GameManager -------------------------------------
//
// The production persistence contract is deliberately small:
//   * `manager.toJSON()` returns a JSON *string* of the whole game state.
//   * `GameManager.fromJSON(jsonString)` is a STATIC factory returning a new
//     GameManager whose `state` is the parsed payload.
// There is no object-returning toJSON, no instance fromJSON, and no separate
// localStorage layer inside GameManager. These tests therefore exercise
// persistence purely through toJSON()/fromJSON() round-trips, which is exactly
// what the UI layer serializes into/out of localStorage. Several original tests
// targeted a phantom localStorage/versioning layer that doesn't exist; each such
// test is reinterpreted below to the closest meaningful real persistence
// assertion, with a comment explaining the reinterpretation.

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

// Same, but team 1 (even seats) sweeps: bidder 2, bid 6, play, defenders 0.
function winGameForTeam1(m: GameManager) {
  let guard = 0;
  while (!m.isGameComplete() && guard++ < 30) {
    setBidder(m, 2);
    setBid(m, 6);
    setTrump(m, 'H');
    setDecision(m, 'P');
    setTricks(m, 0);
  }
}

describe('Persistence Integration', () => {
  describe('Game State Serialization', () => {
    it('should serialize and restore complete game state', () => {
      const gameManager = newGame();

      // Build up a non-trivial game state: a completed moon hand and a completed
      // fold, leaving us auto-seeded at the next hand's bidder phase.
      setBidder(gameManager, 2);
      setBid(gameManager, 'M');
      setTrump(gameManager, 'N');
      setDecision(gameManager, 'P');
      setTricks(gameManager, 2); // moon played, defenders take 2 -> bidding team set

      setBidder(gameManager, 3);
      setBid(gameManager, 6);
      setTrump(gameManager, 'H');
      setDecision(gameManager, 'F'); // fold completes the hand

      // Serialize -> restore via the real string-based round-trip.
      const serialized = gameManager.toJSON();
      const restoredManager = GameManager.fromJSON(serialized);

      // Verify complete restoration of every core field.
      expect(restoredManager.state.players).toEqual(gameManager.state.players);
      expect(currentHandIndex(restoredManager)).toBe(currentHandIndex(gameManager));
      expect(currentPhase(restoredManager)).toBe(currentPhase(gameManager));
      expect(restoredManager.getScores()).toEqual(gameManager.getScores());
      expect(restoredManager.state.hands).toEqual(gameManager.state.hands);
      expect(restoredManager.state.isSeries).toBe(gameManager.state.isSeries);

      // Should be able to continue gameplay seamlessly after restoration.
      setBidder(restoredManager, 4);
      expect(currentPhase(restoredManager)).toBe('bid');
    });

    it('should handle serialization of series with multiple games', () => {
      // Build a REAL series: win game one, complete it, then convert to a series.
      const gameManager = newGame();
      winGameForTeam0(gameManager);
      gameManager.completeGame();
      const firstGameWinner = gameManager.getWinner()!; // team 0
      gameManager.convertToSeries();

      // Start the second game and advance to (but not past) the trump phase.
      gameManager.startNextGame();
      setBidder(gameManager, 1);
      setBid(gameManager, 4);

      // Save mid-game state and restore it.
      const serialized = gameManager.toJSON();
      const restoredManager = GameManager.fromJSON(serialized);

      // Verify the series scaffolding survives serialization.
      expect(restoredManager.state.isSeries).toBe(true);
      // `games` doesn't exist on the real manager; completed games live on
      // state.completedGames and record `.winner` (not `.winningTeam`).
      expect(restoredManager.state.completedGames).toHaveLength(1);
      expect(restoredManager.state.completedGames![0]!.winner).toBe(firstGameWinner);
      expect(restoredManager.state.seriesScores![firstGameWinner]).toBe(1);
      expect(restoredManager.state.seriesScores![1 - firstGameWinner]).toBe(0);

      // Verify the fresh second-game state is intact.
      expect(currentHandIndex(restoredManager)).toBe(0);
      expect(currentPhase(restoredManager)).toBe('trump');
      expect(getCurrentBidder(restoredManager)).toBe(1);
      expect(getCurrentBid(restoredManager)).toBe(4);
      expect(restoredManager.getScores()).toEqual([0, 0]); // fresh game scores

      // Continue gameplay from the restored state.
      setTrump(restoredManager, 'D');
      expect(currentPhase(restoredManager)).toBe('decision');
    });

    it('should preserve undo history through serialization', () => {
      // Reinterpreted: the real state has no separate undo stack. Undo works by
      // replaying/trimming state.hands, so "undo history" is simply the hand list
      // that toJSON/fromJSON already carries. The meaningful assertion is that
      // undo behaves identically before and after a serialization round-trip.
      const gameManager = newGame();

      // A completed hand plus the auto-seeded next hand gives undo real work to do.
      setBidder(gameManager, 1);
      setBid(gameManager, 5);
      setTrump(gameManager, 'H');
      setDecision(gameManager, 'P');
      setTricks(gameManager, 2); // bid 5 played, defenders take 2 -> [5, 2]

      expect(canUndo(gameManager)).toBe(true);

      // Serialize, then undo both the original and the restored copy: they must
      // remain byte-for-byte identical, proving the undo history round-tripped.
      const serialized = gameManager.toJSON();
      const restoredManager = GameManager.fromJSON(serialized);
      expect(canUndo(restoredManager)).toBe(true);

      gameManager.undo();
      restoredManager.undo();
      expect(restoredManager.toJSON()).toBe(gameManager.toJSON());

      // The restored copy stepped back into the previous hand's tricks phase.
      expect(currentHandIndex(restoredManager)).toBe(0);
      expect(currentPhase(restoredManager)).toBe('tricks');

      // A second undo continues to work on the restored copy.
      restoredManager.undo();
      expect(currentPhase(restoredManager)).toBe('decision');
      expect(getCurrentDecision(restoredManager)).toBe(null);
    });
  });

  describe('Persistence Error Handling', () => {
    it('rejects malformed data but tolerates partial payloads', () => {
      // Truly malformed JSON cannot be parsed and throws.
      expect(() => GameManager.fromJSON('this is not valid json')).toThrow();

      // A structurally-incomplete-but-parseable payload (e.g. a partial Firestore
      // document) is tolerated: fromJSON fills in defaults so the game still loads.
      const partial = GameManager.fromJSON(JSON.stringify({ players: ['Alice'] }));
      expect(partial.getScores()).toEqual([0, 0]);
      expect(partial.state.hands).toEqual([]);
    });

    it('should serialize safely regardless of storage-layer failures', () => {
      // Reinterpreted from "localStorage quota exceeded": quota handling belongs to
      // the (absent) storage layer, not GameManager. The real persistence contract
      // we can assert is that serialization itself never throws and always yields
      // valid, re-parseable JSON -- whether the game is empty or in progress.
      const fresh = newGame();
      expect(() => fresh.toJSON()).not.toThrow();
      expect(() => JSON.parse(fresh.toJSON())).not.toThrow();

      const inProgress = newGame();
      setBidder(inProgress, 1);
      setBid(inProgress, 5);
      setTrump(inProgress, 'H');
      let serialized = '';
      expect(() => { serialized = inProgress.toJSON(); }).not.toThrow();
      // Round-trips back into an equivalent manager.
      const restored = GameManager.fromJSON(serialized);
      expect(restored.state.hands).toEqual(inProgress.state.hands);
    });

    it('should restore core fields from an externally-shaped payload', () => {
      // Reinterpreted from "version compatibility": there is no version gate in the
      // real fromJSON -- it restores whatever shape it is given. An external payload
      // carrying the current core fields is restored intact, and scores are always
      // recomputed from `hands` on demand (independent of any stored `scores`).
      const payload = {
        players: ['Alice', 'Bob', 'Charlie', 'Dave'],
        teams: ['Team 1', 'Team 2'],
        hands: ['114HP2'], // one completed hand: bid 4, play, defenders take 2 -> [4, 2]
        scores: [0, 0], // intentionally stale; getScores() ignores this
        isComplete: false,
        isSeries: false,
        startTime: 12345,
      };

      const restored = GameManager.fromJSON(JSON.stringify(payload));
      expect(restored.state.players).toEqual(payload.players);
      expect(restored.state.hands).toEqual(payload.hands);
      // Scores are derived from hands, not read from the stored `scores` field.
      expect(restored.getScores()).toEqual([4, 2]);
    });
  });

  describe('Data Integrity', () => {
    it('should maintain data consistency across save/load cycles', () => {
      const gameManager = newGame();

      // Play a variety of scoring scenarios, round-tripping after each move.
      const scenarios: Array<{
        bidder: number; bid: Bid; trump: Trump; decision: Decision; tricks?: number;
      }> = [
        { bidder: 1, bid: 'M', trump: 'N', decision: 'P', tricks: 0 }, // moon make
        { bidder: 2, bid: 6, trump: 'H', decision: 'P', tricks: 6 },   // bidding set
        { bidder: 3, bid: 4, trump: 'S', decision: 'F' },              // fold
        { bidder: 4, bid: 'D', trump: 'C', decision: 'P', tricks: 0 }, // double moon make
      ];

      scenarios.forEach((scenario) => {
        setBidder(gameManager, scenario.bidder);
        setBid(gameManager, scenario.bid);
        setTrump(gameManager, scenario.trump);
        setDecision(gameManager, scenario.decision, 0);
        if (scenario.decision === 'P') {
          setTricks(gameManager, scenario.tricks!);
        }

        // Save and restore after each move; verify no data corruption.
        const restoredManager = GameManager.fromJSON(gameManager.toJSON());
        expect(restoredManager.state.hands.length).toBe(gameManager.state.hands.length);
        expect(restoredManager.getScores()).toEqual(gameManager.getScores());
        expect(currentHandIndex(restoredManager)).toBe(currentHandIndex(gameManager));
      });
    });

    it('should handle large game histories efficiently', () => {
      // Build a full best-of-three series (alternating winners so all three games
      // are actually played), producing a large multi-game state to serialize.
      const gameManager = newGame();

      winGameForTeam0(gameManager); // game 1 -> team 0
      gameManager.completeGame();
      gameManager.convertToSeries(); // seriesScores [1, 0]

      gameManager.startNextGame();
      winGameForTeam1(gameManager); // game 2 -> team 1
      gameManager.completeGame();    // seriesScores [1, 1]

      gameManager.startNextGame();
      winGameForTeam0(gameManager); // game 3 -> team 0
      gameManager.completeGame();    // seriesScores [2, 1] -> series decided

      // toJSON() already returns a string; no extra JSON.stringify needed.
      const startTime = Date.now();
      const serialized = gameManager.toJSON();
      const serializeTime = Date.now() - startTime;

      // Should be fast and compact for a three-game series.
      expect(serializeTime).toBeLessThan(50);
      expect(serialized.length).toBeLessThan(100000);

      // Restore and verify the series aggregates survived.
      const restoreStartTime = Date.now();
      const restoredManager = GameManager.fromJSON(serialized);
      const restoreTime = Date.now() - restoreStartTime;

      expect(restoreTime).toBeLessThan(50);
      expect(restoredManager.state.completedGames!.length)
        .toBe(gameManager.state.completedGames!.length);
      expect(restoredManager.state.completedGames).toHaveLength(3);
      expect(restoredManager.state.seriesScores).toEqual(gameManager.state.seriesScores);
      expect(restoredManager.state.seriesScores).toEqual([2, 1]);
    });
  });

  describe('Real-World Usage Patterns', () => {
    it('should handle browser refresh during gameplay', () => {
      const gameManager = newGame();

      // User makes some moves, stopping at the defending team's decision.
      setBidder(gameManager, 1);
      setBid(gameManager, 5);
      setTrump(gameManager, 'H');

      // App auto-saves; user refreshes (simulated by a fromJSON round-trip).
      const restoredGame = GameManager.fromJSON(gameManager.toJSON());

      // User continues exactly where they left off.
      expect(currentPhase(restoredGame)).toBe('decision');
      expect(getCurrentBidder(restoredGame)).toBe(1);
      expect(getCurrentBid(restoredGame)).toBe(5);
      expect(getCurrentTrump(restoredGame)).toBe('H');

      // Continue gameplay: bid 5 played, defenders take 3 -> bidding team set [-5, 3].
      setDecision(restoredGame, 'P');
      setTricks(restoredGame, 3);

      expect(currentHandIndex(restoredGame)).toBe(1);
      expect(restoredGame.getScores()[1]).toBeGreaterThan(0); // defenders set the bidder
    });

    it('should handle two clients sharing state through serialization', () => {
      // Reinterpreted from "multiple browser tabs": two GameManagers share state via
      // a toJSON string, mirroring two tabs reading/writing the same saved game.
      const tab1 = newGame();
      setBidder(tab1, 1);
      setBid(tab1, 4);
      const shared1 = tab1.toJSON();

      // Tab 2 loads the same game and advances it.
      const tab2 = GameManager.fromJSON(shared1);
      setTrump(tab2, 'H');
      setDecision(tab2, 'P');
      const shared2 = tab2.toJSON();

      // Tab 1 reloads the updated shared state.
      const tab1Reloaded = GameManager.fromJSON(shared2);
      expect(currentPhase(tab1Reloaded)).toBe('tricks');
      expect(getCurrentTrump(tab1Reloaded)).toBe('H');
      expect(getCurrentDecision(tab1Reloaded)).toBe('P');
    });

    it('should handle game completion and restart cycle', () => {
      let gameManager = newGame();

      // Complete a full game.
      winGameForTeam0(gameManager);
      expect(gameManager.isGameComplete()).toBe(true);

      // Save the completed game (a real, non-empty serialized payload).
      const saved = gameManager.toJSON();
      expect(saved.length).toBeGreaterThan(0);

      // User starts a brand-new game (old data discarded by dropping the instance).
      gameManager = newGame();

      // Verify a clean slate.
      expect(currentHandIndex(gameManager)).toBe(0);
      expect(gameManager.getScores()).toEqual([0, 0]);
      expect(gameManager.state.hands.length).toBe(0);
      expect(gameManager.isGameComplete()).toBe(false);

      // Should be able to start fresh.
      setBidder(gameManager, 1);
      expect(currentPhase(gameManager)).toBe('bid');
    });
  });
});
