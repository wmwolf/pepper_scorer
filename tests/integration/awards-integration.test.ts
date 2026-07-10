import { describe, it, expect, beforeEach } from 'vitest';
import { GameManager } from '@/lib/gameState';
import { selectGameAwards, selectSeriesAwards } from '@/lib/pepper-awards';
import { trackAwardData } from '@/lib/statistics-util';
import {
  newGame, setBidder, setBid, setTrump, setDecision, setTricks,
} from '../helpers/gameActions';
import type { Bid } from '../helpers/gameActions';

// The awards pipeline is fed by three real functions with the following shapes:
//   trackAwardData(hands, players, teams, finalScores, winnerIndex) -> AwardTrackingData
//   selectGameAwards(data)   -> AwardWithWinner[]  (capped at 3)
//   selectSeriesAwards(data) -> AwardWithWinner[]  (capped at 3)
// An AwardWithWinner exposes `name`, `description`, `winner`, `type`, `scope`, `id`.
// A `winner` is a PLAYER name for player awards and a TEAM name for team awards, so a
// valid recipient is drawn from players ∪ teams (not players alone).

const PLAYERS = ['Alice', 'Bob', 'Charlie', 'Dave'];
const TEAMS = ['Team 1', 'Team 2'];

/**
 * Drive a game to completion by having `seat`'s team sweep every hand: bid 6, play,
 * defenders take 0 tricks -> that seat's team +6, the opponents -6. Seats 1 & 3 are
 * team 0; seats 2 & 4 are team 1. A team reaches 42 after seven sweeps.
 */
function winGameForSeat(m: GameManager, seat: number): void {
  let guard = 0;
  while (!m.isGameComplete() && guard++ < 40) {
    setBidder(m, seat);
    setBid(m, 6);
    setTrump(m, 'H');
    setDecision(m, 'P');
    setTricks(m, 0);
  }
}

/** Play one fully-specified hand via the real single-character encoding helpers. */
function playHandSpec(
  m: GameManager,
  spec: { bidder: number; bid: Bid; trump: 'C' | 'D' | 'S' | 'H' | 'N'; tricks: number }
): void {
  setBidder(m, spec.bidder);
  setBid(m, spec.bid);
  setTrump(m, spec.trump);
  setDecision(m, 'P');
  setTricks(m, spec.tricks);
}

describe('Awards Integration', () => {
  let gameManager: GameManager;

  beforeEach(() => {
    gameManager = newGame(PLAYERS, TEAMS);
  });

  describe('Game Awards Integration', () => {
    it('should generate relevant awards for completed games', () => {
      // Play a game with specific patterns to trigger awards.

      // Hand 1: Alice (seat 1) bids Moon no-trump and makes it (defenders take 0).
      playHandSpec(gameManager, { bidder: 1, bid: 'M', trump: 'N', tricks: 0 });
      // Hand 2: Bob (seat 2) bids 6 and is set badly (defenders take 6).
      playHandSpec(gameManager, { bidder: 2, bid: 6, trump: 'H', tricks: 6 });
      // Hand 3: Charlie (seat 3) bids 4 and makes it (defenders take 2).
      playHandSpec(gameManager, { bidder: 3, bid: 4, trump: 'S', tricks: 2 });

      // Finish the game with Alice's team sweeping to 42.
      winGameForSeat(gameManager, 1);
      expect(gameManager.isGameComplete()).toBe(true);

      const awardData = trackAwardData(
        gameManager.state.hands,
        gameManager.state.players,
        gameManager.state.teams,
        gameManager.getScores(),
        gameManager.getWinner()
      );
      const selectedAwards = selectGameAwards(awardData);

      expect(selectedAwards.length).toBeGreaterThan(0);
      expect(selectedAwards.length).toBeLessThanOrEqual(5);

      // Every award has the real award structure and a valid recipient (player or team).
      const validRecipients = [...gameManager.state.players, ...gameManager.state.teams];
      selectedAwards.forEach(award => {
        expect(award).toHaveProperty('name');
        expect(award).toHaveProperty('winner');
        expect(award).toHaveProperty('description');
        expect(validRecipients).toContain(award.winner);
      });

      // If a moon-flavoured award was selected, Alice is the only moon bidder here.
      const moonAward = selectedAwards.find(
        a => a.name.includes('Bold') || a.name.includes('Moon')
      );
      if (moonAward) {
        expect(moonAward.winner).toBe('Alice');
      }
    });

    it('should handle edge cases in award generation', () => {
      // Unusual game: the defenders fold every single hand. Folds hand the bidding team
      // its bid value and give the defenders nothing, so team 0 (seat 1) climbs to 42.
      let guard = 0;
      while (!gameManager.isGameComplete() && guard++ < 40) {
        setBidder(gameManager, 1);
        setBid(gameManager, 4);
        setTrump(gameManager, 'H');
        setDecision(gameManager, 'F'); // fold with 0 free tricks completes the hand
      }
      expect(gameManager.isGameComplete()).toBe(true);

      const awardData = trackAwardData(
        gameManager.state.hands,
        gameManager.state.players,
        gameManager.state.teams,
        gameManager.getScores(),
        gameManager.getWinner()
      );
      const selectedAwards = selectGameAwards(awardData);

      // Should still generate some awards, even with unusual (all-fold) gameplay.
      expect(selectedAwards.length).toBeGreaterThan(0);
      const validRecipients = [...gameManager.state.players, ...gameManager.state.teams];
      expect(selectedAwards.every(award => validRecipients.includes(award.winner))).toBe(true);
    });
  });

  describe('Series Awards Integration', () => {
    it('should generate series awards after multiple games', () => {
      // Game 1: Alice's team (seat 1) wins, then convert the game into a series.
      winGameForSeat(gameManager, 1);
      expect(gameManager.isGameComplete()).toBe(true);
      expect(gameManager.getWinningTeam()).toBe(0);
      gameManager.completeGame();
      gameManager.convertToSeries();
      expect(gameManager.state.seriesScores).toEqual([1, 0]);

      // Game 2: Bob's team (seat 2) wins to level the series at 1-1.
      gameManager.startNextGame();
      winGameForSeat(gameManager, 2);
      expect(gameManager.getWinningTeam()).toBe(1);
      gameManager.completeGame();
      expect(gameManager.state.seriesScores).toEqual([1, 1]);

      // Game 3: Alice's team wins the decider, completing the best-of-three series.
      gameManager.startNextGame();
      winGameForSeat(gameManager, 1);
      gameManager.completeGame();
      expect(gameManager.isSeriesComplete()).toBe(true);

      // Aggregate every completed game's hands and generate series awards.
      const allHands = (gameManager.state.completedGames ?? []).flatMap(g => g.hands);
      const seriesScores = gameManager.state.seriesScores ?? [0, 0];
      const seriesWinner = seriesScores[0] > seriesScores[1] ? 0 : 1;
      const awardData = trackAwardData(
        allHands,
        gameManager.state.players,
        gameManager.state.teams,
        gameManager.getScores(),
        seriesWinner
      );
      const seriesAwards = selectSeriesAwards(awardData);

      expect(seriesAwards.length).toBeGreaterThan(0);
      expect(seriesAwards.length).toBeLessThanOrEqual(8);

      // Every selected award is a genuine series-scoped award with a valid recipient.
      const validRecipients = [...gameManager.state.players, ...gameManager.state.teams];
      seriesAwards.forEach(award => {
        expect(award).toHaveProperty('name');
        expect(award).toHaveProperty('winner');
        expect(award).toHaveProperty('description');
        expect(award.scope).toBe('series');
        expect(validRecipients).toContain(award.winner);
      });
    });

    it('should integrate award data with game statistics', () => {
      // Five hands with varied bidding patterns. Under the real scoring rules these do
      // NOT total 42, so the game is not "won" here — this test exercises the award-DATA
      // integration, not game completion. Derived running scores: [31, -30].
      playHandSpec(gameManager, { bidder: 1, bid: 4, trump: 'H', tricks: 2 });   // Alice makes 4
      playHandSpec(gameManager, { bidder: 2, bid: 5, trump: 'S', tricks: 5 });   // Bob is set
      playHandSpec(gameManager, { bidder: 3, bid: 'M', trump: 'N', tricks: 0 }); // Charlie makes Moon
      playHandSpec(gameManager, { bidder: 4, bid: 6, trump: 'D', tricks: 1 });   // Dave is set
      playHandSpec(gameManager, { bidder: 1, bid: 'D', trump: 'C', tricks: 0 }); // Alice makes Double Moon

      expect(gameManager.getScores()).toEqual([31, -30]);

      const awardData = trackAwardData(
        gameManager.state.hands,
        gameManager.state.players,
        gameManager.state.teams,
        gameManager.getScores(),
        gameManager.getWinner()
      );

      // Player statistics (real field names: bidsWon / bidsSucceeded / highValueBids).
      expect(awardData.playerStats.Alice.bidsWon).toBeGreaterThan(0);
      expect(awardData.playerStats.Alice.bidsSucceeded).toBeGreaterThan(0);
      expect(awardData.playerStats.Bob.bidsWon).toBeGreaterThan(0);
      // Charlie's single Moon is his only high-value bid, and he made it.
      expect(awardData.playerStats.Charlie.highValueBids.attempts).toBe(1);
      expect(awardData.playerStats.Charlie.highValueBids.successes).toBe(1);

      // Team statistics are keyed by team NAME; both teams entered bids this game.
      expect(awardData.teamStats['Team 1'].totalBids).toBeGreaterThan(0);
      expect(awardData.teamStats['Team 2'].totalBids).toBeGreaterThan(0);

      const selectedAwards = selectGameAwards(awardData);
      expect(selectedAwards.length).toBeGreaterThan(0);
    });
  });

  describe('Awards Performance Integration', () => {
    it('should handle large series efficiently', () => {
      // A real best-of-three series cannot span five games, so this exercises the award
      // pipeline over the hands of five complete games aggregated into one large input.
      const startTime = Date.now();

      const allHands: string[] = [];
      for (let game = 0; game < 5; game++) {
        const m = newGame(PLAYERS, TEAMS);
        // Alternate the sweeping team so both accumulate meaningful stats.
        winGameForSeat(m, game % 2 === 0 ? 1 : 2);
        expect(m.isGameComplete()).toBe(true);
        allHands.push(...m.state.hands);
      }

      const winnerIndex = 0;
      const awardData = trackAwardData(allHands, PLAYERS, TEAMS, [0, 0], winnerIndex);
      const seriesAwards = selectSeriesAwards(awardData);

      const duration = Date.now() - startTime;

      // Awards generation should be reasonably fast, produce awards, and span many hands.
      expect(duration).toBeLessThan(1000);
      expect(seriesAwards.length).toBeGreaterThan(0);
      expect(allHands.length).toBeGreaterThan(20);
    });
  });
});
