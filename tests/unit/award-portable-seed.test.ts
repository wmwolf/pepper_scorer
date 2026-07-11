// Portability guarantee for multiplayer: award selection is random, but seeding it from the
// completed game's hands (rngFromHands) makes every device — and every refresh — show the SAME
// awards for the same game. This test simulates "two devices" selecting from identical synced data.

import { describe, it, expect } from 'vitest';
import { selectGameAwards, selectSeriesAwards } from '@/lib/pepper-awards';
import { trackAwardData } from '@/lib/statistics-util';
import { rngFromHands, seedFromString } from '@/lib/awardRng';
import { generateGame } from '../helpers/randomGames';
import { seededRng } from '../helpers/seededRng';

/** Build a completed game deterministically and return its award-tracking data. */
function completedGameData(seed: number) {
  const m = generateGame('aggressive', seededRng(seed));
  // generateGame runs to completion or a guard; require completion for a meaningful game.
  expect(m.isGameComplete()).toBe(true);
  return trackAwardData(m.state.hands, m.state.players, m.state.teams, m.getScores(), m.getWinner());
}

describe('Award selection is portable (same hands -> same awards)', () => {
  it('two devices with identical hands select identical game awards', () => {
    const data = completedGameData(42);
    // Two independent selections seeded from the same hands = two devices rendering the same game.
    const deviceA = selectGameAwards(data, rngFromHands(data.hands));
    const deviceB = selectGameAwards(data, rngFromHands(data.hands));
    expect(deviceA.map(a => a.id)).toEqual(deviceB.map(a => a.id));
    expect(deviceA.map(a => a.winner)).toEqual(deviceB.map(a => a.winner));
  });

  it('two devices with identical series hands select identical series awards', () => {
    const hands = [
      ...completedGameData(1).hands,
      ...completedGameData(2).hands,
      ...completedGameData(3).hands,
    ];
    const data = trackAwardData(hands, ['Alice', 'Bob', 'Charlie', 'Dave'], ['Team 1', 'Team 2'], [0, 0], 0);
    const deviceA = selectSeriesAwards(data, rngFromHands(data.hands));
    const deviceB = selectSeriesAwards(data, rngFromHands(data.hands));
    expect(deviceA.map(a => a.id)).toEqual(deviceB.map(a => a.id));
  });

  it('different games generally get different seeds (variety across games)', () => {
    const a = completedGameData(42);
    const b = completedGameData(7);
    // The two games differ, so their hand-derived seeds differ (variety is preserved across games).
    expect(a.hands).not.toEqual(b.hands);
    expect(seedFromString(a.hands.join('|'))).not.toEqual(seedFromString(b.hands.join('|')));
  });

  it('rngFromHands never throws on empty/absent hands', () => {
    expect(() => rngFromHands([])()).not.toThrow();
    expect(() => rngFromHands(undefined)()).not.toThrow();
  });
});
