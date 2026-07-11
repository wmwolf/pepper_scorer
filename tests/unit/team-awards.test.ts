// Canned eligibility tests for the new TEAM awards. Each crafts a minimal game that should earn the
// award and asserts evaluateAward returns it for the right team (deterministic — independent of the
// random selection). Team 0 = seats 1 & 3 (Alice, Charlie) = 'Team 1'; team 1 = seats 2 & 4 = 'Team 2'.

import { describe, it, expect } from 'vitest';
import { evaluateAward, gameAwards } from '@/lib/pepper-awards';
import { trackAwardData } from '@/lib/statistics-util';
import { newGame, playHand } from '../helpers/gameActions';
import type { GameManager } from '@/lib/gameState';

const def = (id: string) => gameAwards.find(a => a.id === id)!;
const dataOf = (m: GameManager) =>
  trackAwardData(m.state.hands, m.state.players, m.state.teams, m.getScores(), m.getWinner());

describe('New team awards', () => {
  it('dynamic_duo: both partners clear 10 net offensive points', () => {
    const m = newGame();
    playHand(m, { bidder: 1, bid: 'D', trump: 'H', decision: 'P', tricks: 0 }); // Alice makes Double Moon
    playHand(m, { bidder: 3, bid: 'D', trump: 'H', decision: 'P', tricks: 0 }); // Charlie makes Double Moon
    const res = evaluateAward(def('dynamic_duo'), dataOf(m));
    expect(res).toBeTruthy();
    expect(res!.winner).toBe('Team 1');
  });

  it('dynamic_duo: not earned when only one partner contributes', () => {
    const m = newGame();
    playHand(m, { bidder: 1, bid: 'D', trump: 'H', decision: 'P', tricks: 0 }); // Alice big
    playHand(m, { bidder: 1, bid: 6, trump: 'H', decision: 'P', tricks: 0 });   // Alice again; Charlie 0
    expect(evaluateAward(def('dynamic_duo'), dataOf(m))).toBeNull();
  });

  it('great_minds: both partners share a most-called trump with 3+ bids each', () => {
    const m = newGame();
    for (let i = 0; i < 3; i++) playHand(m, { bidder: 1, bid: 4, trump: 'H', decision: 'P', tricks: 2 }); // Alice x3 Hearts
    for (let i = 0; i < 3; i++) playHand(m, { bidder: 3, bid: 4, trump: 'H', decision: 'P', tricks: 2 }); // Charlie x3 Hearts
    const res = evaluateAward(def('great_minds'), dataOf(m));
    expect(res).toBeTruthy();
    expect(res!.winner).toBe('Team 1');
  });

  it('great_minds: not earned when partners favor different trumps', () => {
    const m = newGame();
    for (let i = 0; i < 3; i++) playHand(m, { bidder: 1, bid: 4, trump: 'H', decision: 'P', tricks: 2 }); // Alice Hearts
    for (let i = 0; i < 3; i++) playHand(m, { bidder: 3, bid: 4, trump: 'S', decision: 'P', tricks: 2 }); // Charlie Spades
    expect(evaluateAward(def('great_minds'), dataOf(m))).toBeNull();
  });

  it('misery_loves_company: both partners went set 2+ times on unforced bids', () => {
    const m = newGame();
    for (let i = 0; i < 4; i++) playHand(m, { bidder: 0 }); // 4 pepper-round throw-ins (indices 0-3)
    playHand(m, { bidder: 1, bid: 6, trump: 'H', decision: 'P', tricks: 1 }); // Alice set
    playHand(m, { bidder: 1, bid: 6, trump: 'H', decision: 'P', tricks: 1 }); // Alice set
    playHand(m, { bidder: 3, bid: 6, trump: 'H', decision: 'P', tricks: 1 }); // Charlie set
    playHand(m, { bidder: 3, bid: 6, trump: 'H', decision: 'P', tricks: 1 }); // Charlie set
    const res = evaluateAward(def('misery_loves_company'), dataOf(m));
    expect(res).toBeTruthy();
    expect(res!.winner).toBe('Team 1');
  });

  it('misery_loves_company: pepper-round sets do NOT count (forced bids)', () => {
    const m = newGame();
    // Two sets each, but all within the first four (pepper) hands -> should not qualify.
    playHand(m, { bidder: 1, bid: 6, trump: 'H', decision: 'P', tricks: 1 });
    playHand(m, { bidder: 1, bid: 6, trump: 'H', decision: 'P', tricks: 1 });
    playHand(m, { bidder: 3, bid: 6, trump: 'H', decision: 'P', tricks: 1 });
    playHand(m, { bidder: 3, bid: 6, trump: 'H', decision: 'P', tricks: 1 });
    expect(evaluateAward(def('misery_loves_company'), dataOf(m))).toBeNull();
  });

  it('brick_wall: defending team sweeps all six tricks', () => {
    const m = newGame();
    playHand(m, { bidder: 2, bid: 4, trump: 'H', decision: 'P', tricks: 6 }); // Bob bids, team 0 takes all 6
    const res = evaluateAward(def('brick_wall'), dataOf(m));
    expect(res).toBeTruthy();
    expect(res!.winner).toBe('Team 1');
  });

  it('brick_wall: not earned when defenders take five (not all six)', () => {
    const m = newGame();
    playHand(m, { bidder: 2, bid: 4, trump: 'H', decision: 'P', tricks: 5 });
    expect(evaluateAward(def('brick_wall'), dataOf(m))).toBeNull();
  });
});
