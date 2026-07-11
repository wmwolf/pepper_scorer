// Deterministic random-game generators for statistical award testing. Each drives a real
// GameManager through the real phase machine (so every game is legal and scored by production
// code), answering whichever phase currentPhase() reports. Three "styles" bias the bidding so the
// full award roster gets exercised: pure random over-produces failed bids (overreaching) and
// under-produces conservative awards (playing_it_safe), so we mix styles.

import { GameManager } from '@/lib/gameState';
import {
  newGame, setBidder, setBid, setTrump, setDecision, setTricks, currentPhase,
} from './gameActions';
import type { Bid, Trump } from './gameActions';

const TRUMPS: Trump[] = ['C', 'D', 'S', 'H', 'N'];

export type GameStyle = 'random' | 'conservative' | 'aggressive';

const BID_TABLE: Record<GameStyle, Bid[]> = {
  // Uniform-ish across all bid values.
  random: [4, 5, 6, 'P', 'M', 'D'],
  // Mostly safe 4-bids (drives playing_it_safe / bid_specialists / defensive play).
  conservative: [4, 4, 4, 4, 5, 'P'],
  // High-risk bids (drives overreaching / shoot_for_the_moons / honeypot / big swings).
  aggressive: [6, 6, 'M', 'M', 'D', 5],
};

/** Drive one legal game to completion (or the guard) in the given style. */
export function generateGame(style: GameStyle, rand: () => number): GameManager {
  const m = newGame();
  const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];
  const bids = BID_TABLE[style];
  // Conservative defenders usually play and take few tricks (bidders tend to make it);
  // aggressive games see more plays too. Fold rate is modest across the board.
  const foldRate = style === 'conservative' ? 0.15 : 0.3;

  let guard = 0;
  while (!m.isGameComplete() && guard++ < 300) {
    switch (currentPhase(m)) {
      case 'bidder':
        // ~6% throw-ins, else a random seat.
        setBidder(m, rand() < 0.06 ? 0 : 1 + Math.floor(rand() * 4));
        break;
      case 'bid':
        setBid(m, pick(bids));
        break;
      case 'trump':
        // Conservative players lean on real trump suits; others include no-trump.
        setTrump(m, style === 'conservative' && rand() < 0.8
          ? pick(['C', 'D', 'S', 'H'] as Trump[])
          : pick(TRUMPS));
        break;
      case 'decision':
        if (rand() < foldRate) setDecision(m, 'F', Math.floor(rand() * 4));
        else setDecision(m, 'P');
        break;
      case 'tricks': {
        // Conservative games bias toward the bidder succeeding (defenders take few tricks);
        // aggressive/random spread the whole 0..6 range.
        const t = style === 'conservative'
          ? Math.floor(rand() * 4)          // 0..3
          : Math.floor(rand() * 7);         // 0..6
        setTricks(m, t);
        break;
      }
    }
  }
  return m;
}
