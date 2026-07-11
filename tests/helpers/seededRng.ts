// A small, seeded PRNG for deterministic award-selection tests. selectGameAwards/selectSeriesAwards
// take an injectable `rng: () => number` (defaulting to Math.random in production); passing a seeded
// one here makes the otherwise-random selection reproducible.
//
// mulberry32: fast, well-distributed 32-bit generator, returns a float in [0, 1).
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Always picks the FIRST eligible award in each category (rng() === 0). Handy when a test crafts a
// game so that exactly one award is eligible per category and wants a stable, obvious result.
export const firstEligibleRng = (): number => 0;
