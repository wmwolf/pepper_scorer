// Canned eligibility tests for the three new series awards. evaluateAward is deterministic, so these
// isolate each award's logic from the random selection. Team 0 = seats 1 & 3 = 'Team 1'.

import { describe, it, expect } from 'vitest';
import { evaluateAward, seriesAwards } from '@/lib/pepper-awards';
import { trackAwardData } from '@/lib/statistics-util';
import { newGame, playHand } from '../helpers/gameActions';
import type { GameManager } from '@/lib/gameState';

const def = (id: string) => seriesAwards.find(a => a.id === id)!;
const dataOf = (m: GameManager, winner: number | null) =>
  trackAwardData(m.state.hands, m.state.players, m.state.teams, m.getScores(), winner);

describe('New series awards', () => {
  it('cut_to_the_quick: awards a 2-0 series sweep', () => {
    const m = newGame();
    playHand(m, { bidder: 1, bid: 4, trump: 'H', decision: 'P', tricks: 2 });
    const data = dataOf(m, 0); // team 0 won the series
    data.seriesScore = [2, 0]; // ...in a sweep
    const res = evaluateAward(def('cut_to_the_quick'), data);
    expect(res).toBeTruthy();
    expect(res!.winner).toBe('Team 1');
  });

  it('cut_to_the_quick: not earned when the series went three games (2-1)', () => {
    const m = newGame();
    playHand(m, { bidder: 1, bid: 4, trump: 'H', decision: 'P', tricks: 2 });
    const data = dataOf(m, 0);
    data.seriesScore = [2, 1]; // opponents won a game — not a sweep
    expect(evaluateAward(def('cut_to_the_quick'), data)).toBeNull();
  });

  it('moonshot: most successful moons across the series (min 2)', () => {
    const m = newGame();
    playHand(m, { bidder: 1, bid: 'M', trump: 'H', decision: 'P', tricks: 0 }); // Alice makes a Moon
    playHand(m, { bidder: 1, bid: 'M', trump: 'H', decision: 'P', tricks: 0 }); // Alice makes another
    const res = evaluateAward(def('moonshot'), dataOf(m, 0));
    expect(res).toBeTruthy();
    expect(res!.winner).toBe('Alice');
  });

  it('moonshot: not earned with a single moon (or with failed moons)', () => {
    const m = newGame();
    playHand(m, { bidder: 1, bid: 'M', trump: 'H', decision: 'P', tricks: 0 }); // one made moon
    playHand(m, { bidder: 1, bid: 'M', trump: 'H', decision: 'P', tricks: 3 }); // a FAILED moon (not counted)
    expect(evaluateAward(def('moonshot'), dataOf(m, 0))).toBeNull();
  });

  it('big_talker: most failed bids across the series (min 3)', () => {
    const m = newGame();
    playHand(m, { bidder: 1, bid: 6, trump: 'H', decision: 'P', tricks: 1 }); // Alice set
    playHand(m, { bidder: 1, bid: 6, trump: 'H', decision: 'P', tricks: 1 }); // Alice set
    playHand(m, { bidder: 1, bid: 6, trump: 'H', decision: 'P', tricks: 1 }); // Alice set
    const res = evaluateAward(def('big_talker'), dataOf(m, 0));
    expect(res).toBeTruthy();
    expect(res!.winner).toBe('Alice');
  });

  it('big_talker: not earned with only two failed bids', () => {
    const m = newGame();
    playHand(m, { bidder: 1, bid: 6, trump: 'H', decision: 'P', tricks: 1 });
    playHand(m, { bidder: 1, bid: 6, trump: 'H', decision: 'P', tricks: 1 });
    expect(evaluateAward(def('big_talker'), dataOf(m, 0))).toBeNull();
  });
});
