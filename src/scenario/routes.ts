/**
 * Reading a published route: what it says at a point, and what it says next.
 *
 * These are pure functions of a `Star` or a `Sid`. They take the route they are
 * asked about rather than looking one up, so they work for any scenario and the
 * sim can hold a route on an aircraft and never consult a registry again.
 */
import { headingVector, project, type Ft, type Kts, type Nm, type Point } from '../sim/units.js';
import type { Sid, Star, StarConstraint, StarWaypoint } from './types.js';
import { bearing } from '../sim/units.js';

/**
 * Waypoint 0 of every STAR is the gate itself, so the route proper begins at 1.
 *
 * That contract was spelled `waypoints[1]` in three unrelated places — the
 * sequencer's starting index, the holding-stack scan and the profile raise — and
 * is stated here once.
 */
export const ENTRY_FIX_INDEX = 1;

/** The first fix after the gate: where the route begins, and where a stack forms. */
export function entryFix(star: Star): StarWaypoint {
  return star.waypoints[ENTRY_FIX_INDEX]!;
}

/**
 * Published value at a point on the route, interpolated between the two
 * constraints that bracket it — a continuous descent rather than dive-and-drive.
 */
function interpolate(constraints: readonly StarConstraint[], dtgNm: Nm): number {
  const first = constraints[0]!;
  if (dtgNm >= first.dtgNm) return first.value;
  for (let i = 1; i < constraints.length; i += 1) {
    const from = constraints[i - 1]!;
    const to = constraints[i]!;
    if (dtgNm >= to.dtgNm) {
      const fraction = (from.dtgNm - dtgNm) / (from.dtgNm - to.dtgNm);
      return from.value + (to.value - from.value) * fraction;
    }
  }
  return constraints[constraints.length - 1]!.value;
}

/** The next published value still ahead, i.e. the one being flown towards. */
function ahead(constraints: readonly StarConstraint[], dtgNm: Nm): number {
  for (const constraint of constraints) {
    if (constraint.dtgNm <= dtgNm) return constraint.value;
  }
  return constraints[constraints.length - 1]!.value;
}

/**
 * The published profile at a point on the route.
 *
 * `altitudes` overrides the route's own list, and exists for one thing: an
 * arrival delivered into a holding stack flies the run in to the entry fix above
 * the published crossing (§4.5), so the constraint list it is flying is its own
 * rather than the chart's. Everything else passes nothing and gets the chart. The
 * speeds have no equivalent — a stack changes the level, not the speed — so they
 * are always the route's.
 */
export function starProfileAt(
  star: Star,
  dtgNm: Nm,
  altitudes: readonly StarConstraint[] = star.altitudes,
): { altitudeFt: Ft; speedKts: Kts } {
  return {
    altitudeFt: interpolate(altitudes, dtgNm),
    speedKts: interpolate(star.speeds, dtgNm),
  };
}

export function altitudeAheadFt(
  star: Star,
  dtgNm: Nm,
  altitudes: readonly StarConstraint[] = star.altitudes,
): Ft {
  return ahead(altitudes, dtgNm);
}

export function speedAheadKts(star: Star, dtgNm: Nm): Kts {
  return ahead(star.speeds, dtgNm);
}

/**
 * The route's altitude list with everything from the gate to the entry fix raised
 * to `levelFt` — the profile an arrival flies when the entry fix already has a
 * holding stack on it (§4.5).
 *
 * Only the constraints at or before the entry fix move. Past it the chart is
 * unchanged, so the aircraft rejoins the published descent on the next leg rather
 * than carrying the extra height all the way down, and the interpolation between
 * the two turns the join into a descent rather than a step.
 */
export function raisedToLevel(star: Star, levelFt: Ft): readonly StarConstraint[] {
  const entryDtgNm = entryFix(star).dtgNm;
  return star.altitudes.map((constraint) =>
    constraint.dtgNm >= entryDtgNm
      ? { ...constraint, value: Math.max(constraint.value, levelFt) }
      : constraint,
  );
}

/**
 * True once the aircraft is physically past a fix, measured along the leg *out*
 * of it rather than the leg into it.
 *
 * This is deliberately not the route sequencer's idea of "passed". Sequencing
 * moves to the next fix early so the turn is flown as a fly-by, which for a
 * crossing restriction would start the climb up to half a mile *before* the fix —
 * and half a mile before the fix is still underneath the arrival. A crossing
 * restriction is made good at the fix, so it is released at the fix.
 */
function isPastFix(sid: Sid, index: number, position: Point): boolean {
  const waypoints = sid.waypoints;
  const fix = waypoints[index]!;
  const next = waypoints[index + 1];
  const outbound = next
    ? bearing(fix.position, next.position)
    : bearing(waypoints[index - 1]!.position, fix.position);
  return project(fix.position, position, headingVector(outbound)).alongNm > 0;
}

/**
 * The lowest "at or below" still in force where the aircraft is, or the top of the
 * departure climb once every restriction is behind it.
 *
 * Taken from the position rather than from the sequencing index, which is what
 * makes the restriction hold all the way to its fix (see `isPastFix`).
 */
export function ceilingAtFt(sid: Sid, position: Point): Ft {
  let ceilingFt = sid.topFt;
  for (let i = 1; i < sid.waypoints.length; i += 1) {
    const maxAltitudeFt = sid.waypoints[i]!.maxAltitudeFt;
    if (maxAltitudeFt === undefined) continue;
    if (!isPastFix(sid, i, position)) ceilingFt = Math.min(ceilingFt, maxAltitudeFt);
  }
  return ceilingFt;
}
