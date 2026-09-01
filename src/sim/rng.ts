/** Seeded PRNG (mulberry32). A seed reproduces a session exactly. */
export interface Rng {
  seed: number;
  next(): number;
  int(maxExclusive: number): number;
  pick<T>(items: readonly T[]): T;
  /**
   * Weighted pick. Draws once, like `pick`, and with every weight equal it lands
   * on the very index `pick` would — so a field that declares no weights draws
   * the same traffic from the same seed as it did before weights existed.
   */
  pickWeighted<T>(items: readonly T[], weight: (item: T) => number): T;
  /** Exponential deviate with the given mean — inter-arrival times of a Poisson process. */
  exponential(mean: number): number;
}

export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    seed,
    next,
    int: (maxExclusive: number) => Math.floor(next() * maxExclusive),
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!,
    pickWeighted: <T>(items: readonly T[], weight: (item: T) => number): T => {
      let total = 0;
      for (const item of items) total += Math.max(0, weight(item));
      // No weight anywhere to choose by: fall back to the uniform draw rather
      // than returning the first item, which would silently favour one gate.
      if (!(total > 0)) return items[Math.floor(next() * items.length)]!;
      const target = next() * total;
      let cumulative = 0;
      for (const item of items) {
        cumulative += Math.max(0, weight(item));
        if (cumulative > target) return item;
      }
      return items[items.length - 1]!;
    },
    exponential: (mean: number) => -Math.log(1 - next()) * mean,
  };
}
