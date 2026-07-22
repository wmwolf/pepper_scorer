// Canned eligibility tests for the 'shoat' series award. evaluateAward is deterministic, so these
// isolate the award's logic from the random selection layer. netPoints is the summed team score
// across every hand a player won the bid on — SHOAT goes to whoever finished most net-negative there.
// Team 0 = seats 1 & 3 (Alice, Charlie); Team 1 = seats 2 & 4 (Bob, Dave).

import { describe, it, expect } from 'vitest';
import { evaluateAward, seriesAwards, selectSeriesAwards } from '@/lib/pepper-awards';
import { trackAwardData } from '@/lib/statistics-util';
import { newGame, playHand } from '../helpers/gameActions';
import type { GameManager } from '@/lib/gameState';

const def = (id: string) => seriesAwards.find(a => a.id === id)!;
const dataOf = (m: GameManager, winner: number | null) =>
  trackAwardData(m.state.hands, m.state.players, m.state.teams, m.getScores(), winner);

describe('shoat award', () => {
  it('awards the player who finished net-negative on their offensive bids', () => {
    const m = newGame();
    playHand(m, { bidder: 1, bid: 6, trump: 'H', decision: 'P', tricks: 3 }); // Alice set
    playHand(m, { bidder: 1, bid: 6, trump: 'H', decision: 'P', tricks: 3 }); // Alice set again
    const data = dataOf(m, null);

    // Sanity: Alice really is net-negative on offense; nobody else bid.
    expect(data.playerStats.Alice.netPoints).toBeLessThan(0);

    const res = evaluateAward(def('shoat'), data);
    expect(res).toBeTruthy();
    expect(res!.winner).toBe('Alice');
  });

  it('is not earned when every bidder finished net non-negative', () => {
    const m = newGame();
    playHand(m, { bidder: 1, bid: 4, trump: 'H', decision: 'P', tricks: 0 }); // Alice makes it (+)
    playHand(m, { bidder: 2, bid: 4, trump: 'H', decision: 'P', tricks: 0 }); // Bob makes it (+)
    expect(evaluateAward(def('shoat'), dataOf(m, null))).toBeNull();
  });

  it('picks the most-negative bidder when several are underwater', () => {
    const m = newGame();
    playHand(m, { bidder: 1, bid: 6, trump: 'H', decision: 'P', tricks: 3 }); // Alice set (big loss)
    playHand(m, { bidder: 1, bid: 6, trump: 'H', decision: 'P', tricks: 3 }); // Alice set again
    playHand(m, { bidder: 2, bid: 4, trump: 'H', decision: 'P', tricks: 3 }); // Bob set (smaller loss)
    const data = dataOf(m, null);

    expect(data.playerStats.Alice.netPoints).toBeLessThan(data.playerStats.Bob.netPoints);
    expect(data.playerStats.Bob.netPoints).toBeLessThan(0);

    const res = evaluateAward(def('shoat'), data);
    expect(res).toBeTruthy();
    expect(res!.winner).toBe('Alice');
  });

  it('is a dubious series-scope player award and can surface in selection', () => {
    const d = def('shoat');
    expect(d.type).toBe('player');
    expect(d.scope).toBe('series');
    expect(d.important).toBe(false);

    const m = newGame();
    playHand(m, { bidder: 1, bid: 6, trump: 'H', decision: 'P', tricks: 3 });
    playHand(m, { bidder: 1, bid: 6, trump: 'H', decision: 'P', tricks: 3 });
    // Only the dubious bucket can be filled here, so selection must surface this award.
    const dubious = selectSeriesAwards(dataOf(m, null)).find(a => a.id === 'shoat');
    expect(dubious).toBeTruthy();
    expect(dubious!.winner).toBe('Alice');
  });
});
