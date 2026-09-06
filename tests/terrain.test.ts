/**
 * `msaAt` has to agree with what `drawTerrain` painted, because the readout and
 * the shading are two views of one fact. Where they disagree the controller is
 * being told a figure that contradicts the picture under the cursor.
 */
import { describe, expect, it } from 'vitest';
import { msaAt } from '../src/scenario/terrain.js';
import { terrainRamp, THEME } from '../src/render/theme.js';
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

const luminance = (color: string): number => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};

describe('terrainRamp', () => {
  it('gives every band its own shade, however many there are', () => {
    // The bug this replaced: a fixed four-colour array with the top entry
    // repeated once it ran out, which painted eleven of LSGG's fourteen bands
    // identically — everything above 7000 was one flat mass.
    for (const bands of [1, 2, 4, 14, 20]) {
      const ramp = terrainRamp(bands);
      expect(ramp.length).toBe(bands);
      expect(new Set(ramp).size).toBe(bands);
    }
    expect(terrainRamp(0)).toEqual([]);
  });

  it('runs darkest to brightest, between the theme\'s two ends', () => {
    const ramp = terrainRamp(14);
    const levels = ramp.map(luminance);
    for (let i = 1; i < levels.length; i += 1) expect(levels[i]!).toBeGreaterThan(levels[i - 1]!);
    expect(ramp[0]).toBe(THEME.terrainLow);
    expect(ramp[ramp.length - 1]).toBe(THEME.terrainHigh);
  });

  it('gives the darkest bands the widest steps', () => {
    // A fixed step in sRGB is worth less near black, so a linear ramp left
    // LSGG's 4000/5000/6000 illegible while the bright end had steps to spare.
    // The shaping is what fixes that, and this is the assertion that says so:
    // the first steps are wider than the last ones, not merely present.
    const levels = terrainRamp(14).map(luminance);
    const steps = levels.slice(1).map((v, i) => v - levels[i]!);
    const first = steps.slice(0, 3).reduce((a, b) => a + b) / 3;
    const last = steps.slice(-3).reduce((a, b) => a + b) / 3;
    expect(first).toBeGreaterThan(last * 1.2);
    // And each of the three is genuinely wider than the linear ramp's ~4 units.
    for (const step of steps.slice(0, 3)) expect(step).toBeGreaterThan(4.4);
  });

  it('stays clear of the background below and the STAR lines above', () => {
    // Both ends are constrained and neither is decorative. Below: the lowest
    // band has to read against bare scope. Above: VABB draws arrival routes
    // *directly over* its two brightest bands — 0.0 and 0.1 NM — so a ramp top
    // much past `starPath` costs those lines their contrast, which is why the
    // fix for the dark end was to widen downward rather than upward.
    const ramp = terrainRamp(14);
    const contrast = (a: string, b: string) => (luminance(a) + 5) / (luminance(b) + 5);
    // The lowest band is the one case with no darker neighbour to read against,
    // so the background *is* its contrast and this is the only thing keeping it
    // visible. It was taken down to 1.9x to buy wider steps and disappeared, so
    // the floor is pinned at what actually reads.
    expect(contrast(ramp[0]!, THEME.background)).toBeGreaterThan(2.2);
    expect(luminance(ramp[ramp.length - 1]!)).toBeLessThan(luminance(THEME.starPath) + 5);
  });

  it('keeps LSGG\'s steps above the threshold where a step stops being a step', () => {
    // Fourteen bands divide the usable range into steps of ~3.7 luminance at the
    // crowded end. That is near the floor for irregular patches on a dark ground,
    // and it is the real bound on how finely a field may band its terrain — the
    // ceiling is `starPath` and cannot be lifted. Pinned so a fifteenth band is a
    // deliberate decision rather than a silent slide into one flat mass.
    const lsgg = SCENARIOS.find((s) => s.id === 'LSGG')!;
    const levels = terrainRamp(lsgg.terrain.length).map(luminance);
    const steps = levels.slice(1).map((v, i) => v - levels[i]!);
    expect(Math.min(...steps)).toBeGreaterThanOrEqual(3.5);
  });
});
