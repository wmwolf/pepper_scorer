// Canned eligibility tests for the 'reeks_of_weakness' game award. evaluateAward is deterministic,
// so these isolate the award's logic from the random selection layer.
// Team 0 = seats 1 & 3 (Alice, Charlie); Team 1 = seats 2 & 4 (Bob, Dave).

import { describe, it, expect } from 'vitest';
import { evaluateAward, gameAwards, selectGameAwards } from '@/lib/pepper-awards';
import { trackAwardData } from '@/lib/statistics-util';
import { newGame, playHand } from '../helpers/gameActions';
import type { GameManager } from '@/lib/gameState';

const def = (id: string) => gameAwards.find(a => a.id === id)!;
const dataOf = (m: GameManager, winner: number | null) =>
  trackAwardData(m.state.hands, m.state.players, m.state.teams, m.getScores(), winner);

describe('reeks_of_weakness award', () => {
  it('awards a player who won the bid with two 6-bids in a game', () => {
    const m = newGame();
    playHand(m, { bidder: 1, bid: 6, trump: 'H', decision: 'P', tricks: 0 }); // Alice makes a 6
    playHand(m, { bidder: 1, bid: 6, trump: 'H', decision: 'P', tricks: 1 }); // Alice, another 6
    const res = evaluateAward(def('reeks_of_weakness'), dataOf(m, 0));
    expect(res).toBeTruthy();
    expect(res!.winner).toBe('Alice');
  });

  it('counts 6-bids regardless of whether the hand was made or set', () => {
    const m = newGame();
    playHand(m, { bidder: 1, bid: 6, trump: 'H', decision: 'P', tricks: 0 }); // made
    playHand(m, { bidder: 1, bid: 6, trump: 'H', decision: 'P', tricks: 3 }); // set (still a 6-bid)
    const res = evaluateAward(def('reeks_of_weakness'), dataOf(m, 0));
    expect(res).toBeTruthy();
    expect(res!.winner).toBe('Alice');
  });

  it('is not earned with only a single 6-bid', () => {
    const m = newGame();
    playHand(m, { bidder: 1, bid: 6, trump: 'H', decision: 'P', tricks: 0 }); // Alice's only 6
    playHand(m, { bidder: 1, bid: 5, trump: 'H', decision: 'P', tricks: 0 }); // a 5, not a 6
    expect(evaluateAward(def('reeks_of_weakness'), dataOf(m, 0))).toBeNull();
  });

  it('does not count moons or 5-bids toward the 6-bid total', () => {
    const m = newGame();
    playHand(m, { bidder: 1, bid: 'M', trump: 'H', decision: 'P', tricks: 0 }); // moon
    playHand(m, { bidder: 1, bid: 5, trump: 'H', decision: 'P', tricks: 0 });   // 5
    playHand(m, { bidder: 1, bid: 6, trump: 'H', decision: 'P', tricks: 0 });   // one 6 only
    expect(evaluateAward(def('reeks_of_weakness'), dataOf(m, 0))).toBeNull();
  });

  it('picks the player with the most 6-bids when several qualify', () => {
    const m = newGame();
    playHand(m, { bidder: 1, bid: 6, trump: 'H', decision: 'P', tricks: 0 }); // Alice #1
    playHand(m, { bidder: 1, bid: 6, trump: 'H', decision: 'P', tricks: 0 }); // Alice #2
    playHand(m, { bidder: 1, bid: 6, trump: 'H', decision: 'P', tricks: 0 }); // Alice #3
    playHand(m, { bidder: 2, bid: 6, trump: 'H', decision: 'P', tricks: 0 }); // Bob #1
    playHand(m, { bidder: 2, bid: 6, trump: 'H', decision: 'P', tricks: 0 }); // Bob #2
    const res = evaluateAward(def('reeks_of_weakness'), dataOf(m, 0));
    expect(res).toBeTruthy();
    expect(res!.winner).toBe('Alice'); // 3 six-bids beats Bob's 2
  });

  it('is a dubious game-scope player award and can surface in selection', () => {
    const d = def('reeks_of_weakness');
    expect(d.type).toBe('player');
    expect(d.scope).toBe('game');
    expect(d.important).toBe(false);

    const m = newGame();
    playHand(m, { bidder: 1, bid: 6, trump: 'H', decision: 'P', tricks: 0 });
    playHand(m, { bidder: 1, bid: 6, trump: 'H', decision: 'P', tricks: 0 });
    // Only the dubious bucket can be filled here, so selection must surface this award.
    const dubious = selectGameAwards(dataOf(m, 0)).find(a => a.id === 'reeks_of_weakness');
    expect(dubious).toBeTruthy();
    expect(dubious!.winner).toBe('Alice');
  });
});
