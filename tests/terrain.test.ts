/**
 * `msaAt` has to agree with what `drawTerrain` painted, because the readout and
 * the shading are two views of one fact. Where they disagree the controller is
 * being told a figure that contradicts the picture under the cursor.
 */
import { describe, expect, it } from 'vitest';
import { msaAt } from '../src/scenario/terrain.js';
import { SCENARIOS } from '../src/scenario/registry.js';
import type { TerrainBand } from '../src/scenario/types.js';

const square = (cx: number, cy: number, r: number) => [
  { x: cx - r, y: cy - r },
  { x: cx + r, y: cy - r },
  { x: cx + r, y: cy + r },
  { x: cx - r, y: cy + r },
];

describe('msaAt', () => {
  it('is null off the terrain, and the band level on it', () => {
    const terrain: TerrainBand[] = [{ levelFt: 3000, rings: [square(0, 0, 10)] }];
    expect(msaAt(terrain, { x: 0, y: 0 })).toBe(3000);
    expect(msaAt(terrain, { x: 50, y: 0 })).toBeNull();
    // A field stating no terrain says nothing rather than throwing.
    expect(msaAt([], { x: 0, y: 0 })).toBeNull();
  });

  it('reports the highest band, not the first one it finds', () => {
    // The bands are ordered low to high and a hill lies inside every band up to
    // its own, so a point on the summit is in all three. Stopping at the first
    // match reports 3000 for ground that needs 5000 — an understatement, which is
    // the dangerous direction for this particular number.
    const terrain: TerrainBand[] = [
      { levelFt: 3000, rings: [square(0, 0, 10)] },
      { levelFt: 4000, rings: [square(0, 0, 6)] },
      { levelFt: 5000, rings: [square(0, 0, 2)] },
    ];
    expect(msaAt(terrain, { x: 0, y: 0 })).toBe(5000);
    expect(msaAt(terrain, { x: 4, y: 0 })).toBe(4000);
    expect(msaAt(terrain, { x: 8, y: 0 })).toBe(3000);
  });

  it('subtracts a hole, the way the nonzero fill does', () => {
    // `drawTerrain` puts a band's rings in one path and calls `fill()`, which is
    // nonzero winding — so a ring wound the other way is a hole and the shading
    // there is the band *below*. Under even-odd the two rules agree here, but
    // they part where rings overlap, and this is the assertion that pins which
    // one the readout uses.
    const hole = [...square(0, 0, 4)].reverse();
    const terrain: TerrainBand[] = [{ levelFt: 3000, rings: [square(0, 0, 10), hole] }];
    expect(msaAt(terrain, { x: 7, y: 0 })).toBe(3000);
    expect(msaAt(terrain, { x: 0, y: 0 })).toBeNull();
  });

  it('reads a real field, and never below its lowest band', () => {
    const lsgg = SCENARIOS.find((s) => s.id === 'LSGG')!;
    const levels = new Set(lsgg.terrain.map((band) => band.levelFt));
    const lowest = Math.min(...levels);
    // Sample the scope on a grid: every answer is one of the field's own band
    // levels, and never below the lowest — the two ways a lookup can invent a
    // figure that is not on the chart.
    let found = 0;
    for (let x = -55; x <= 55; x += 2.5)
      for (let y = -50; y <= 50; y += 2.5) {
        const msa = msaAt(lsgg.terrain, { x, y });
        if (msa === null) continue;
        found += 1;
        expect(levels.has(msa)).toBe(true);
        expect(msa).toBeGreaterThanOrEqual(lowest);
      }
    // Geneva is in a valley ringed by the Jura and the Alps, so most of the
    // scope is high ground — a lookup returning null everywhere would pass every
    // assertion above.
    expect(found).toBeGreaterThan(500);
  });
});
