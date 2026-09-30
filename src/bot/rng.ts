// A seedable generator, so that a bot which plays mixed strategies can still be
// tested reproducibly. Math.random cannot be seeded, and an unseeded bot makes
// every strength measurement noise.

export interface Rng {
  next(): number;
}

/**
 * mulberry32: one multiply-xorshift round over a 32-bit counter. Small, fast,
 * and its distribution is far better than a bare linear congruential generator
 * — which matters because troop counts are sampled from it via `sampleIndex`.
 */
export function seededRng(seed: number): Rng {
  let state = seed >>> 0;
  return {
    next(): number {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

/** The default source: unseeded, for real play. */
export const systemRng: Rng = { next: () => Math.random() };

/**
 * Picks an index in proportion to `weights`.
 *
 * Zero-weight entries are never returned: the running total only passes the
 * threshold on an entry that carries weight. When nothing carries any weight the
 * first index stands in, which keeps callers free of an empty-strategy case.
 */
export function sampleIndex(weights: number[], rng: Rng): number {
  let total = 0;
  for (const weight of weights) total += weight;
  if (total <= 0) return 0;

  const threshold = rng.next() * total;
  let cumulative = 0;
  for (let i = 0; i < weights.length; i++) {
    cumulative += weights[i];
    if (cumulative > threshold) return i;
  }
  // Floating-point drift only; the last weighted entry is the right answer.
  for (let i = weights.length - 1; i >= 0; i--) {
    if (weights[i] > 0) return i;
  }
  return 0;
}
