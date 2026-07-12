// Statistical regression guard for award SELECTION.
//
// The selection algorithm picks one team + one player + one "dubious" award at random from among
// the ELIGIBLE awards in each category. This suite simulates thousands of seeded games and asserts
// distributional properties that the old "first-eligible, then break" algorithm violated — most
// importantly that NO award is starved: if an award's own logic makes it eligible, selection must
// actually surface it a fair fraction of the time. (Pre-fix, e.g. footprints_in_the_sand was
// eligible in ~half of games and surfaced in zero.)
//
// Everything is seeded, so these assertions are deterministic, not flaky.

import { describe, it, expect } from 'vitest';
import {
  gameAwards, seriesAwards, selectGameAwards, selectSeriesAwards, evaluateAward,
} from '@/lib/pepper-awards';
import { trackAwardData } from '@/lib/statistics-util';
import { generateGame, type GameStyle } from '../helpers/randomGames';
import { seededRng } from '../helpers/seededRng';

interface Tally {
  completed: number;
  totalAwards: number;
  eligible: Record<string, number>;
  selected: Record<string, number>;
  maxPerGame: number;
  categoryViolations: number; // games with >1 award of the same category
}

const MIN_SAMPLE = 100;

const GAME_DUBIOUS = new Set([
  'overreaching', 'false_confidence', 'helping_hand', 'playing_it_safe', 'no_trump_no_problem',
]);
const categoryOf = (id: string): string =>
  GAME_DUBIOUS.has(id) ? 'dubious' : (gameAwards.find(a => a.id === id)!.type);

/** Run `n` seeded games (cycling through styles) and tally eligibility vs selection. */
function simulate(n: number, seed: number): Tally {
  const rand = seededRng(seed);
  const styles: GameStyle[] = ['random', 'conservative', 'aggressive'];
  const t: Tally = {
    completed: 0, totalAwards: 0, maxPerGame: 0, categoryViolations: 0,
    eligible: {}, selected: {},
  };
  for (const a of gameAwards) { t.eligible[a.id] = 0; t.selected[a.id] = 0; }

  for (let i = 0; i < n; i++) {
    const m = generateGame(styles[i % styles.length], rand);
    if (!m.isGameComplete()) continue;
    t.completed++;
    const data = trackAwardData(
      m.state.hands, m.state.players, m.state.teams, m.getScores(), m.getWinner(),
    );
    for (const a of gameAwards) if (evaluateAward(a, data)) t.eligible[a.id]++;

    const selected = selectGameAwards(data, rand);
    t.totalAwards += selected.length;
    t.maxPerGame = Math.max(t.maxPerGame, selected.length);
    for (const id of selected.map(a => a.id)) t.selected[id]++;

    const cats = selected.map(a => categoryOf(a.id));
    if (new Set(cats).size !== cats.length) t.categoryViolations++;
  }
  return t;
}

describe('Award selection — statistical regression', () => {
  const N = 3000;
  const SEED = 0xABCDEF;
  const t = simulate(N, SEED);

  it('completes the vast majority of generated games', () => {
    expect(t.completed).toBeGreaterThan(N * 0.9);
  });

  it('never selects more than one award per category (max 3 total)', () => {
    expect(t.maxPerGame).toBeLessThanOrEqual(3);
    expect(t.categoryViolations).toBe(0);
  });

  it('surfaces a healthy average number of awards per game', () => {
    const avg = t.totalAwards / t.completed;
    expect(avg).toBeGreaterThan(2.0);
    expect(avg).toBeLessThanOrEqual(3.0);
  });

  it('surfaces EVERY award at least once (no structurally dead awards)', () => {
    const dead = gameAwards.filter(a => t.selected[a.id] === 0).map(a => a.id);
    expect(dead).toEqual([]);
  });

  it('does not starve any eligible award (anti-crowding: surfaced >= 10% of eligibility)', () => {
    // For every award eligible in a meaningful sample of games, selection must surface it in at
    // least 10% of those games. A category holds at most 6 awards, so uniform sampling yields
    // >= ~1/6; 10% is a safe floor that still fails hard if an award is being crowded out.
    const MIN_ELIGIBLE = 150;
    const starved = gameAwards
      .filter(a => t.eligible[a.id] >= MIN_ELIGIBLE)
      .map(a => ({ id: a.id, ratio: t.selected[a.id] / t.eligible[a.id] }))
      .filter(x => x.ratio < 0.10);
    expect(starved).toEqual([]);
  });

  it('favours higher-weighted awards (weighting actually biases selection)', () => {
    // honeypot (weight 3) and bid_royalty (weight 1) are both player-category awards, so they
    // compete in the same draw. Per unit of eligibility, the heavier one must surface more often.
    const ratio = (id: string) => t.selected[id] / Math.max(1, t.eligible[id]);
    expect(ratio('honeypot')).toBeGreaterThan(ratio('bid_royalty'));
  });

  it('specifically surfaces footprints_in_the_sand (the previously-dead award)', () => {
    // Regression pin: this award was eligible ~50% of games yet selected in 0 under the old code.
    expect(t.eligible['footprints_in_the_sand']).toBeGreaterThan(MIN_SAMPLE);
    expect(t.selected['footprints_in_the_sand']).toBeGreaterThan(0);
  });

  it('is deterministic for a fixed seed', () => {
    const again = simulate(N, SEED);
    expect(again.selected).toEqual(t.selected);
    expect(again.eligible).toEqual(t.eligible);
  });
});

describe('Series award selection — every series award is reachable', () => {
  // This sweep aggregates several games into a "series" and checks that every series award can be
  // both eligible and surfaced. It exists specifically to catch the class of bug where an award is
  // permanently unreachable — e.g. `punching_bag` was declared type:'team' but implemented in
  // evaluateAward's player switch, so it always returned null and could never be given.
  const SERIES = 900;
  const rand = seededRng(0x5E21E5);
  const styles: GameStyle[] = ['random', 'conservative', 'aggressive'];
  const eligible: Record<string, number> = {};
  const selected: Record<string, number> = {};
  for (const a of seriesAwards) { eligible[a.id] = 0; selected[a.id] = 0; }
  let seriesCount = 0;

  for (let i = 0; i < SERIES; i++) {
    const hands: string[] = [];
    for (let g = 0; g < 3; g++) {
      const m = generateGame(styles[(i + g) % 3], rand);
      if (m.isGameComplete()) hands.push(...m.state.hands);
    }
    if (hands.length === 0) continue;
    seriesCount++;
    const winner = i % 2;
    const data = trackAwardData(hands, ['Alice', 'Bob', 'Charlie', 'Dave'], ['Team 1', 'Team 2'], [0, 0], winner);
    // Simulate a mix of 2-0 sweeps and 2-1 series so cut_to_the_quick is exercised.
    const swept = i % 3 === 0;
    data.seriesScore = winner === 0 ? (swept ? [2, 0] : [2, 1]) : (swept ? [0, 2] : [1, 2]);
    for (const a of seriesAwards) if (evaluateAward(a, data)) eligible[a.id]++;
    for (const id of selectSeriesAwards(data, rand).map(a => a.id)) selected[id]++;
  }

  it('makes every series award eligible at least once (no permanently-null awards)', () => {
    const neverEligible = seriesAwards.filter(a => eligible[a.id] === 0).map(a => a.id);
    expect(neverEligible).toEqual([]);
  });

  it('surfaces every series award at least once (no starved awards)', () => {
    const neverSelected = seriesAwards.filter(a => selected[a.id] === 0).map(a => a.id);
    expect(neverSelected).toEqual([]);
  });
});
