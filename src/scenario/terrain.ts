/**
 * Reading a minimum safe altitude off the field's terrain bands.
 *
 * The bands are drawn low-to-high, each ring enclosing ground that needs at least
 * its level, so a hill inside three rings appears in three bands. The MSA at a
 * point is therefore the **highest** band containing it, not the first — walking
 * the list and stopping early would report the lowest and understate the ground
 * by however many bands are stacked over it.
 *
 * Here rather than in `src/render/` because it is a question about the field, and
 * the answer has to be the same one the shading is drawn from. It is a query, not
 * a limit: what may be assigned is `airspace.mvaFt`, one number for the whole
 * field, and the two disagree wherever the ground rises above it.
 */
import type { Point } from '../sim/units.js';
import type { TerrainBand } from './types.js';

/**
 * Winding number of a band's rings about a point, by the crossing rule.
 *
 * **Nonzero winding, not even-odd**, because that is what `ctx.fill()` uses and
 * this has to answer the same question the shading did. The difference is not
 * academic here: a band's holes are wound the opposite way on purpose so that the
 * fill subtracts them — a valley inside a massif — and under even-odd a hole and
 * an overlap look alike, so a point in the middle of a plateau where two rings
 * were closed together would come back as *not* high ground.
 *
 * All of a band's rings are counted together for the same reason `drawTerrain`
 * puts them in one path: the outer and its holes only mean anything as a set.
 */
function windingNumber(rings: readonly (readonly Point[])[], point: Point): number {
  let winding = 0;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const a = ring[j]!;
      const b = ring[i]!;
      if (a.y <= point.y) {
        // Upward crossing to the right of the point winds anticlockwise.
        if (b.y > point.y && isLeft(a, b, point) > 0) winding += 1;
      } else if (b.y <= point.y && isLeft(a, b, point) < 0) {
        winding -= 1;
      }
    }
  }
  return winding;
}

/** Which side of the directed line `a`→`b` the point falls: >0 is left. */
function isLeft(a: Point, b: Point, point: Point): number {
  return (b.x - a.x) * (point.y - a.y) - (point.x - a.x) * (b.y - a.y);
}

/**
 * The highest band covering `point`, or null where the terrain states nothing —
 * which is ground below the lowest band, not ground unknown.
 */
export function msaAt(terrain: readonly TerrainBand[], point: Point): number | null {
  let best: number | null = null;
  for (const band of terrain) {
    if (best !== null && band.levelFt <= best) continue;
    if (windingNumber(band.rings, point) !== 0) best = band.levelFt;
  }
  return best;
}
