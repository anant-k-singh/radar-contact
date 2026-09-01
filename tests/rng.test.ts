/**
 * The seeded streams. What matters about them is not the distribution — it is
 * mulberry32 and that is somebody else's problem — but that a seed reproduces a
 * session, so anything that changes how a draw is *consumed* is a behaviour change.
 */
import { describe, expect, it } from 'vitest';
import { createRng } from '../src/sim/rng.js';

describe('pickWeighted', () => {
  const items = ['a', 'b', 'c', 'd', 'e'] as const;

  it('lands on the index pick would, when every weight is equal', () => {
    // This is the whole reason gate weights did not change what a seed does at a
    // field that declares none: the two draw once each, from the same stream, and
    // an even weighting reduces to floor(u * n).
    const uniform = createRng(1234);
    const weighted = createRng(1234);
    for (let i = 0; i < 2000; i += 1) {
      expect(weighted.pickWeighted(items, () => 1)).toBe(uniform.pick(items));
    }
  });

  it('is unaffected by the scale of the weights', () => {
    const one = createRng(7);
    const seven = createRng(7);
    for (let i = 0; i < 500; i += 1) {
      expect(seven.pickWeighted(items, () => 7)).toBe(one.pickWeighted(items, () => 1));
    }
  });

  it('splits in the ratio it is given', () => {
    const rng = createRng(99);
    const weight = (item: string) => (item === 'a' ? 3 : item === 'b' ? 1 : 0);
    const counts = new Map<string, number>();
    for (let i = 0; i < 40_000; i += 1) {
      const picked = rng.pickWeighted(items, weight);
      counts.set(picked, (counts.get(picked) ?? 0) + 1);
    }
    // Zero weight is never offered at all, which is what lets a gate be listed
    // for its marker and its handover level without taking traffic.
    expect([...counts.keys()].sort()).toEqual(['a', 'b']);
    expect(counts.get('a')! / counts.get('b')!).toBeCloseTo(3, 1);
  });

  it('falls back to an even draw when nothing has any weight', () => {
    // Returning the first item instead would silently funnel every arrival
    // through one gate.
    const rng = createRng(5);
    const seen = new Set<string>();
    for (let i = 0; i < 200; i += 1) seen.add(rng.pickWeighted(items, () => 0));
    expect(seen.size).toBe(items.length);
  });
});
