// Deterministic RNG for award selection.
//
// Award selection is random (see selectGameAwards/selectSeriesAwards), but in multiplayer every
// device must show the SAME awards for the same game. Rather than sync a chosen seed through the
// database, we derive the seed from a value that is already identical on every device: the completed
// game's hands. The hands array is byte-identical across synced clients, deterministic for local
// games, and different from game to game — so awards are consistent across devices AND stable across
// refreshes, while still varying between different games. No gameId or DB round-trip required.

// mulberry32 PRNG -> float in [0, 1).
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

// djb2 string hash -> uint32. Stable and identical across devices/runtimes.
export function seedFromString(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

// A seeded rng derived from a completed game's (or series') hands. This is the portable seed source
// for award selection: pass the same hands on any device and get the same award draw. Falls back to
// a fixed seed for an empty/absent hand list so it never throws.
export function rngFromHands(hands: string[] | undefined | null): () => number {
  const key = (hands ?? []).join('|');
  return seededRng(seedFromString(key) || 1);
}
