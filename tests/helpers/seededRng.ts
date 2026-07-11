// Test-facing re-export of the production seeded RNG. selectGameAwards/selectSeriesAwards take an
// injectable `rng: () => number` (defaulting to Math.random in production); passing a seeded one
// here makes the otherwise-random selection reproducible. Single source of truth = src/lib/awardRng.
export { seededRng, seedFromString, rngFromHands } from '@/lib/awardRng';

// Always picks the FIRST eligible award in each category (rng() === 0). Handy when a test crafts a
// game so that exactly one award is eligible per category and wants a stable, obvious result.
export const firstEligibleRng = (): number => 0;
