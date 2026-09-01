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

/** The published arrival from a gate, or undefined for one delivered on vectors. */
export function starForGate(
  scenario: { stars: readonly Star[] },
  gateName: string,
): Star | undefined {
  return scenario.stars.find((star) => star.gate === gateName);
}

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
 * True once the aircraft is physically past a fix.
 *
 * This is deliberately not the route sequencer's idea of "passed". Sequencing moves
 * to the next fix early so the turn is flown as a fly-by, which for a crossing
 * restriction would release it up to six miles *before* the fix — and six miles
 * before the fix is still underneath the arrival. A crossing restriction is made
 * good at the fix, so it is released at the fix.
 *
 * The line it tests is the one through the fix perpendicular to the **bisector of
 * the turn**, which is the only choice that works at a fix where the route turns
 * hard. Neither leg alone does, and VABB has a counter-example for each:
 *
 * - Along the leg *out* of the fix, the half-plane reaches back up the leg *into*
 *   it. VEVAK turns from southbound to eastbound, so a departure eight miles north
 *   of it — still inbound, still under the arrival — already counts as past.
 * - Along the leg *into* the fix, it never releases at all when the route turns
 *   back slightly. OMGIX sits 0.3 NM north of VEVAK, so an aircraft on the outbound
 *   leg never gets south of VEVAK again and stays pinned under the ceiling for the
 *   rest of the route.
 *
 * Both were measured: the first put a departure 8 NM under an arrival with the
 * restriction already lifted, the second held one at 8937 ft beneath an arrival
 * descending through 8000. The bisector is past neither too early nor never, and
 * where a route runs straight through a fix all three agree exactly — which is why
 * the field this was written for never showed the difference.
 *
 * Flown as a fly-by the aircraft cuts the corner and never crosses the fix itself,
 * so what this tests is a line rather than a point. That line is where the crossing
 * is made good.
 */
function isPastFix(sid: Sid, index: number, position: Point): boolean {
  const waypoints = sid.waypoints;
  const fix = waypoints[index]!;
  const previous = waypoints[index - 1];
  const next = waypoints[index + 1];
  const inbound = previous ? headingVector(bearing(previous.position, fix.position)) : null;
  const outbound = next ? headingVector(bearing(fix.position, next.position)) : null;
  // The bisector of the turn, or whichever leg exists at the ends of the route.
  const sum = {
    x: (inbound?.x ?? 0) + (outbound?.x ?? 0),
    y: (inbound?.y ?? 0) + (outbound?.y ?? 0),
  };
  const length = Math.hypot(sum.x, sum.y);
  // A reversal has no bisector. `validateScenario` rejects a turn that tight, so
  // this only guards against dividing by zero; the leg in is the safe answer.
  const axis = length > 1e-9 ? { x: sum.x / length, y: sum.y / length } : (inbound ?? outbound!);
  return project(fix.position, position, axis).alongNm > 0;
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

/**
 * The highest "at or above" already made good where the aircraft is — the floor
 * the published chart guarantees it is not below.
 *
 * The mirror of `ceilingAtFt` in both senses: a "at or below" binds *until* its
 * fix, an "at or above" binds *from* its fix, so this asks whether the fix is
 * behind rather than ahead.
 *
 * Nothing flies this — a departure climbs as hard as it can, so a floor can only
 * ever be satisfied, never chased. It exists because a crossing restriction has
 * two ways to work: hold the departure under the arrival, or guarantee it is over
 * it. A chart publishing "at or above FL100" is doing the second, and without a
 * floor there is nothing to check that claim against.
 */
export function floorAtFt(sid: Sid, position: Point): Ft {
  let floorFt = 0;
  for (let i = 1; i < sid.waypoints.length; i += 1) {
    const minAltitudeFt = sid.waypoints[i]!.minAltitudeFt;
    if (minAltitudeFt === undefined) continue;
    if (isPastFix(sid, i, position)) floorFt = Math.max(floorFt, minAltitudeFt);
  }
  return floorFt;
}
