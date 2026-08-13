/** Seeded PRNG (mulberry32). A seed reproduces a session exactly. */
export interface Rng {
  seed: number;
  next(): number;
  int(maxExclusive: number): number;
  pick<T>(items: readonly T[]): T;
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
    exponential: (mean: number) => -Math.log(1 - next()) * mean,
  };
}
