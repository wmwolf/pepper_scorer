// Deterministic random-game generators for statistical award testing. Each drives a real
// GameManager through the real phase machine (so every game is legal and scored by production code),
// answering whichever phase currentPhase() reports.
//
// Realism model:
//   - Bids follow a small-heavy, power-law-ish weighting (mostly 4s, tapering to rare moons).
//   - The first four hands are pepper rounds (forced Pepper bids).
//   - DEFENDER DECISION: real defending teams fold/negotiate the MAJORITY of the time. They only
//     "stay" (play) when forced (clubs bids must be played) or when they hold a hand strong enough
//     to set the bidder or steal a trick or two. So each hand gets a hidden defensive "strength";
//     defenders play only if forced or strong, otherwise fold and negotiate a trick or two.
//   - TRICKS ON A PLAY are correlated with that strength: strong defenders (who chose to play) take
//     many tricks and usually set the bid; weak defenders forced to play (clubs) take few.
// This self-selection is why defensive awards are commoner than uniform sampling suggests.

import { GameManager } from '@/lib/gameState';
import {
  newGame, setBidder, setBid, setTrump, setDecision, setTricks, currentPhase,
  currentHandIndex, getCurrentTrump,
} from './gameActions';
import type { Bid, Trump } from './gameActions';

const TRUMPS: Trump[] = ['C', 'D', 'S', 'H', 'N'];

export type GameStyle = 'random' | 'conservative' | 'aggressive';

// [bid, weight] tables — small bids common, big bids rare (roughly a power law).
const BID_WEIGHTS: Record<GameStyle, Array<[Bid, number]>> = {
  conservative: [[4, 65], [5, 20], [6, 10], ['M', 4], ['D', 1]],
  random: [[4, 50], [5, 22], [6, 15], ['M', 10], ['D', 3]], // "balanced"
  aggressive: [[4, 30], [5, 20], [6, 25], ['M', 18], ['D', 7]],
};

function weightedBid(style: GameStyle, rand: () => number): Bid {
  const table = BID_WEIGHTS[style];
  const total = table.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [b, w] of table) { r -= w; if (r < 0) return b; }
  return table[table.length - 1][0];
}

// Defender tricks when they play, correlated with their hidden strength (~strength*6, with noise).
// Strong voluntary defenders take many tricks (usually setting the bid); weak forced ones take few.
// ~14% of the time the BIDDER held a monster and sweeps the defenders (0 tricks) despite their
// confidence — this is the "Big Four" / honeypot case (a played bid the defenders misjudged).
function playedTricks(strength: number, rand: () => number): number {
  if (rand() < 0.14) return 0;                      // bidder held a monster and sweeps (honeypot)
  if (strength > 0.8 && rand() < 0.02) return 6;    // rare total shutout by a strong defense (brick_wall)
  // Otherwise strong defenders usually take 3-5 tricks (enough to set the bid); capped at 5 so a
  // clean sweep of all six only comes from the rare branch above.
  const t = Math.round(strength * 4.3 + (rand() - 0.5) * 2);
  return Math.max(0, Math.min(5, t));
}

/** Drive one legal game to completion (or the guard) in the given style. */
export function generateGame(style: GameStyle, rand: () => number): GameManager {
  const m = newGame();
  // Defensive strength of the CURRENT hand, drawn at the decision phase and used at the tricks phase.
  let pendingStrength = 0;
  // Only stay with a genuinely strong hand — conservative tables stay a touch less.
  const playThreshold = style === 'conservative' ? 0.68 : 0.62;

  let guard = 0;
  while (!m.isGameComplete() && guard++ < 300) {
    switch (currentPhase(m)) {
      case 'bidder':
        // ~5% throw-ins, else a random seat.
        setBidder(m, rand() < 0.05 ? 0 : 1 + Math.floor(rand() * 4));
        break;
      case 'bid':
        // First four hands are pepper rounds → forced Pepper bids.
        setBid(m, currentHandIndex(m) < 4 ? 'P' : weightedBid(style, rand));
        break;
      case 'trump':
        setTrump(m, style === 'conservative' && rand() < 0.85
          ? (['C', 'D', 'S', 'H'] as Trump[])[Math.floor(rand() * 4)]
          : TRUMPS[Math.floor(rand() * TRUMPS.length)]);
        break;
      case 'decision': {
        const strength = rand();
        const forcedByClubs = getCurrentTrump(m) === 'C'; // clubs bids must be played
        if (forcedByClubs || strength >= playThreshold) {
          pendingStrength = strength;
          setDecision(m, 'P');
        } else {
          // Fold and negotiate free tricks scaled by how much the defenders could have taken.
          const free = strength < 0.35 ? 0 : strength < 0.6 ? 1 : 2;
          setDecision(m, 'F', free);
        }
        break;
      }
      case 'tricks':
        setTricks(m, playedTricks(pendingStrength, rand));
        break;
    }
  }
  return m;
}
