/**
 * Terrain awareness (§9.5).
 *
 * The scenery layer draws bands of minimum safe altitude; this reads the same
 * bands back and asks one question of an aircraft: is it below the MSA of the
 * ground at or near its position. Below is a separation violation of the ordinary
 * kind — no new alert level, no new statistic — because from the controller's seat
 * it is the same failure as losing 1000 ft against another aircraft.
 *
 * Only the *bands* are taken, not the `Scenario`: this module is under `src/sim/`
 * and may not name a field (§11.4). A field with no terrain passes an empty list
 * and every query answers 0, which is what ZZZZ does.
 *
 * The band geometry is the generalised one the map draws, deliberately. The point
 * of reading the drawn outline rather than a finer source is that the player is
 * held to what the player can see — a violation against terrain that is not on the
 * scope would be unreadable, and a scope that shades ground the rules ignore would
 * be a lie in the other direction.
 */
import type { TerrainBand } from '../scenario/types.js';
import { TERRAIN_BUFFER_NM } from './constants.js';
import type { Ft, Nm, Point } from './units.js';

/**
 * True when the point is inside the ring, by the even-odd crossing rule.
 *
 * Winding does not matter here even though `mapLayer` fills with nonzero: a hole
 * wound the other way still *crosses*, so a point inside a hole reads as inside
 * the band. That is the safe direction to be wrong in — a hole in a mountain is
 * still no place to be at 3000 ft — and it keeps this independent of the ring
 * ordering the renderer depends on.
 */
function insideRing(p: Point, ring: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (a.y > p.y === b.y > p.y) continue;
    if (p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Distance from the point to the ring's nearest edge, ignoring whether it is in. */
function distanceToRing(p: Point, ring: readonly Point[]): Nm {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    // A ring closed by a repeated point has a zero-length edge; skip rather than
    // divide by it.
    if (lenSq === 0) continue;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
    // Raw hypot: this runs per ring per aircraft per tick.
    const d = Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
    if (d < best) best = d;
  }
  return best;
}

/**
 * A ring's bounding box, inflated by the buffer, cached per ring.
 *
 * Ring geometry is fixed at compile time, so the box is computed once and reused
 * for the life of the process. Without it the conformance suite pays a few hundred
 * point-to-segment tests per aircraft per tick against rings on the far side of
 * the field — measured at nearly double the suite's runtime.
 */
const boxes = new WeakMap<readonly Point[], { minX: Nm; maxX: Nm; minY: Nm; maxY: Nm }>();

function boundingBox(ring: readonly Point[]): { minX: Nm; maxX: Nm; minY: Nm; maxY: Nm } {
  const cached = boxes.get(ring);
  if (cached) return cached;
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of ring) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }
  const box = {
    minX: minX - TERRAIN_BUFFER_NM,
    maxX: maxX + TERRAIN_BUFFER_NM,
    minY: minY - TERRAIN_BUFFER_NM,
    maxY: maxY + TERRAIN_BUFFER_NM,
  };
  boxes.set(ring, box);
  return box;
}

/**
 * The minimum safe altitude in force at a position: the highest band whose ground
 * is within `TERRAIN_BUFFER_NM`, or 0 where there is none.
 *
 * The buffer is a margin around the hazard, not the test itself. Inside a band
 * counts as distance zero, so an aircraft over the middle of a plateau is caught
 * by being over terrain rather than by happening to be near its edge — which is
 * the trap in stating the rule as "within half a mile of a polygon", since the
 * middle of a large polygon is nowhere near one.
 *
 * Bands are scanned highest-first and the first hit wins, so the usual case of
 * an aircraft over nothing costs one bounding-box reject per band.
 */
export function minimumSafeAltitudeFt(terrain: readonly TerrainBand[], p: Point): Ft {
  let highest = 0;
  for (const band of terrain) {
    if (band.levelFt <= highest) continue;
    for (const ring of band.rings) {
      const box = boundingBox(ring);
      if (p.x < box.minX || p.x > box.maxX || p.y < box.minY || p.y > box.maxY) continue;
      if (insideRing(p, ring) || distanceToRing(p, ring) <= TERRAIN_BUFFER_NM) {
        highest = band.levelFt;
        break;
      }
    }
  }
  return highest;
}

/** A terrain bust: one aircraft, the MSA it is under, and by how much. */
export interface TerrainConflict {
  aircraftId: number;
  /** The MSA in force where the aircraft is. */
  msaFt: Ft;
  /** How far below it the aircraft is, always positive. */
  belowFt: Ft;
}

/**
 * Every aircraft below the MSA at its position.
 *
 * A departure is included: a SID's restrictions are the field's own and nothing
 * guarantees they clear terrain the field has not surveyed, so an aircraft under
 * the ground is a bust whichever way it is pointed. An aircraft still on the roll
 * is not — it is on the runway, which is by definition at field elevation, and
 * the terrain layer has no business asserting a minimum over the aerodrome.
 */
export function analyzeTerrain(
  terrain: readonly TerrainBand[],
  aircraft: readonly { id: number; x: Nm; y: Nm; altitudeFt: Ft; phase: string }[],
): TerrainConflict[] {
  if (terrain.length === 0) return [];
  const conflicts: TerrainConflict[] = [];
  for (const ac of aircraft) {
    if (ac.phase === 'roll') continue;
    const msaFt = minimumSafeAltitudeFt(terrain, { x: ac.x, y: ac.y });
    if (msaFt === 0 || ac.altitudeFt >= msaFt) continue;
    conflicts.push({ aircraftId: ac.id, msaFt, belowFt: msaFt - ac.altitudeFt });
  }
  return conflicts;
}
