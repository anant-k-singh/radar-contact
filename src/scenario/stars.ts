/**
 * Standard arrival routes — one STAR from each entry gate (docs §4.5).
 *
 * A STAR is a chain of waypoints, some of which carry a published crossing
 * altitude or speed. Arrivals fly it on autopilot: lateral tracking waypoint to
 * waypoint, and a continuous descent interpolated between the published
 * altitudes, until the controller vectors them off it.
 *
 * Geometry, all four routes:
 *
 * Every route publishes 250 kt as far as its first fix (OKPUR, NIVEL, SUDIX,
 * TAVIR), 230 kt at the corner, and its own platform speed at the last fix —
 * 200 kt north, 210 kt south — so the speed comes off over the middle legs
 * rather than from the moment of handover: "keep the speed up until close in",
 * expressed as a published constraint.
 *
 * - **North gates** (KOVAL, VANDA) run straight in to a corner fix abeam the
 *   field, then a leg along 090/270 descending 7000 → 3000 that stops 2 NM
 *   short of the extended centerline at 16 NM final. That is 15.3 NM from the
 *   threshold along the final approach course, where the glideslope is 4882 ft,
 *   so the platform sits well under it and the intercept captures from below.
 *   Turn one onto final; the other has to wait.
 * - **South gates** (TEMBA, RIMOL) run straight in until they cross 6 NM abeam
 *   the centerline, then turn north onto a parallel leg descending 7000 → 3000
 *   that ends 11 NM north of the field. That leg is a downwind: turn base when
 *   the gap in the sequence is there. The height is already off by then, so the
 *   base turn is a turn rather than a descent as well — and 3000 ft is under
 *   the 3° slope from 9.4 NM out, which is inside any base turn off an 11 NM
 *   downwind.
 *
 * No two routes cross. Only the two north routes end pointing at each other,
 * 4 NM apart, which is the sequencing problem the player is here to solve.
 */
import { ENTRY_SPEED_KTS } from '../sim/constants.js';
import { distance, headingVector, type Ft, type Kts, type Nm, type Point } from '../sim/units.js';
import { AIRPORT, type EntryGate } from './airport.js';

export interface StarWaypoint {
  name: string;
  position: Point;
  /** Published crossing altitude, if the fix has one. */
  altitudeFt?: Ft;
  /** Published crossing speed, if the fix has one. */
  speedKts?: Kts;
  /** Route distance from this fix to the end of the STAR ("distance to go"). */
  dtgNm: Nm;
}

/** A published value pinned to a point on the route, keyed by distance to go. */
export interface StarConstraint {
  dtgNm: Nm;
  value: number;
}

export interface Star {
  /** Chart name, e.g. `VANDA1A`. */
  name: string;
  gate: string;
  waypoints: readonly StarWaypoint[];
  lengthNm: Nm;
  /** Both lists run from the gate inwards, i.e. by decreasing distance to go. */
  altitudes: readonly StarConstraint[];
  speeds: readonly StarConstraint[];
}

interface Draft {
  name: string;
  position: Point;
  altitudeFt?: Ft;
  speedKts?: Kts;
}

// ── Route geometry ──────────────────────────────────────────────────────────

/** Where the north level legs sit, in NM north of the airport reference point. */
const PLATFORM_NM = 16;
/** How far out the north routes turn inbound. */
const NORTH_CORNER_NM = 20;
/** How close to the extended centerline the north routes stop. */
const MERGE_OFFSET_NM = 2;
/** Offset of the south parallel legs either side of the centerline. */
const DOWNWIND_OFFSET_NM = 6;
/** North end of the south parallel legs — 5 NM clear of the north routes. */
const DOWNWIND_END_NM = 11;

function gateFor(name: string): EntryGate {
  const gate = AIRPORT.gates.find((candidate) => candidate.name === name);
  if (!gate) throw new Error(`no entry gate named ${name}`);
  return gate;
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** The point where the gate's inbound track crosses `x`. */
function inboundTrackAtX(gate: EntryGate, x: Nm): Point {
  const track = headingVector(gate.inboundHeadingDeg);
  const t = (x - gate.position.x) / track.x;
  return { x, y: gate.position.y + track.y * t };
}

function build(name: string, gate: EntryGate, drafts: readonly Draft[]): Star {
  // The gate itself is the first fix: Center delivers the aircraft to it at the
  // published altitude and speed, so the profile starts there.
  const drafted: Draft[] = [
    {
      name: gate.name,
      position: gate.position,
      altitudeFt: gate.entryAltitudeFt,
      speedKts: ENTRY_SPEED_KTS,
    },
    ...drafts,
  ];

  const waypoints: StarWaypoint[] = drafted.map((draft) => ({ ...draft, dtgNm: 0 }));
  for (let i = waypoints.length - 2; i >= 0; i -= 1) {
    const here = waypoints[i]!;
    const next = waypoints[i + 1]!;
    here.dtgNm = next.dtgNm + distance(here.position, next.position);
  }

  const pick = (read: (wpt: StarWaypoint) => number | undefined): StarConstraint[] =>
    waypoints
      .filter((wpt) => read(wpt) !== undefined)
      .map((wpt) => ({ dtgNm: wpt.dtgNm, value: read(wpt)! }));

  return {
    name,
    gate: gate.name,
    waypoints,
    lengthNm: waypoints[0]!.dtgNm,
    altitudes: pick((wpt) => wpt.altitudeFt),
    speeds: pick((wpt) => wpt.speedKts),
  };
}

/**
 * One published fix: its name and whatever it crosses at. Altitude and speed
 * are per-fix and independent — the geometry below decides *where* each fix
 * sits, this decides what is published there, and the two are deliberately not
 * derived from each other so a single crossing can be retuned on its own.
 */
interface FixSpec {
  name: string;
  altitudeFt: Ft;
  speedKts: Kts;
}

/** `side` is −1 west of the centerline, +1 east. */
function northStar(name: string, gateName: string, side: -1 | 1, fixes: [FixSpec, FixSpec, FixSpec]): Star {
  const gate = gateFor(gateName);
  const corner: Point = { x: side * NORTH_CORNER_NM, y: PLATFORM_NM };
  const positions = [
    midpoint(gate.position, corner),
    corner,
    { x: side * MERGE_OFFSET_NM, y: PLATFORM_NM },
  ];
  return build(name, gate, fixes.map((fix, i) => ({ ...fix, position: positions[i]! })));
}

function southStar(name: string, gateName: string, side: -1 | 1, fixes: [FixSpec, FixSpec, FixSpec]): Star {
  const gate = gateFor(gateName);
  // Turning onto the downwind where the gate's own inbound track reaches the
  // offset keeps the first leg dead straight from the handover.
  const corner = inboundTrackAtX(gate, side * DOWNWIND_OFFSET_NM);
  const positions = [
    midpoint(gate.position, corner),
    corner,
    { x: side * DOWNWIND_OFFSET_NM, y: DOWNWIND_END_NM },
  ];
  return build(name, gate, fixes.map((fix, i) => ({ ...fix, position: positions[i]! })));
}

/**
 * The published profile of every route, fix by fix.
 *
 * Each crossing stands on its own — nothing here is shared between routes or
 * derived from a common constant, so a single fix can be retuned without
 * dragging the other eleven with it. Republishing 250 kt at the first fix of
 * each route holds the entry speed that far instead of bleeding it off from the
 * gate; the reduction happens over the legs after it.
 *
 * The last fix of a north route is an intercept platform and must stay below
 * the glideslope where the route ends (4882 ft at 15.3 NM along the final
 * course). The last fix of a south route is a downwind that is turned base, and
 * it too sits below the glideslope wherever that base turn is flown — 3000 ft is
 * under the 3° path from about 9.5 NM out, which is inside every reasonable
 * base turn off an 11 NM downwind.
 */
export const STARS: readonly Star[] = [
  northStar('VANDA1A', 'VANDA', -1, [
    { name: 'OKPUR', altitudeFt: 9000, speedKts: 250 },
    { name: 'ALVOR', altitudeFt: 7000, speedKts: 230 },
    { name: 'ARDIS', altitudeFt: 3000, speedKts: 200 },
  ]),
  northStar('KOVAL1A', 'KOVAL', 1, [
    { name: 'NIVEL', altitudeFt: 9000, speedKts: 250 },
    { name: 'BELGA', altitudeFt: 7000, speedKts: 230 },
    { name: 'BOXAR', altitudeFt: 3000, speedKts: 200 },
  ]),
  southStar('RIMOL1A', 'RIMOL', -1, [
    { name: 'SUDIX', altitudeFt: 10_000, speedKts: 250 },
    { name: 'LOMSA', altitudeFt: 7000, speedKts: 230 },
    { name: 'PIKON', altitudeFt: 3000, speedKts: 210 },
  ]),
  southStar('TEMBA1A', 'TEMBA', 1, [
    { name: 'TAVIR', altitudeFt: 10_000, speedKts: 250 },
    { name: 'DEMUX', altitudeFt: 7000, speedKts: 230 },
    { name: 'KETAN', altitudeFt: 3000, speedKts: 210 },
  ]),
];

export function starForGate(gateName: string): Star | undefined {
  return STARS.find((star) => star.gate === gateName);
}

/**
 * Waypoint 0 of every STAR is the gate itself, so the route proper begins at 1.
 *
 * That contract was spelled `waypoints[1]` in three unrelated places — the
 * sequencer's starting index, the holding-stack scan and the profile raise — and
 * is now stated here once.
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
 * arrival delivered into a holding stack flies the run in to the entry fix
 * above the published crossing (§4.5), so the constraint list it is flying is
 * its own rather than the chart's. Everything else passes nothing and gets the
 * chart. The speeds have no equivalent — a stack changes the level, not the
 * speed — so they are always the route's.
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

/**
 * The route's altitude list with everything from the gate to the entry fix
 * raised to `levelFt` — the profile an arrival flies when the entry fix already
 * has a holding stack on it (§4.5).
 *
 * Only the constraints at or before the entry fix move. Past it the chart is
 * unchanged, so the aircraft rejoins the published descent on the next leg
 * rather than carrying the extra height all the way down, and the interpolation
 * between the two turns the join into a descent rather than a step.
 */
export function raisedToLevel(star: Star, levelFt: Ft): readonly StarConstraint[] {
  const entryDtgNm = entryFix(star).dtgNm;
  return star.altitudes.map((constraint) =>
    constraint.dtgNm >= entryDtgNm
      ? { ...constraint, value: Math.max(constraint.value, levelFt) }
      : constraint,
  );
}

export function speedAheadKts(star: Star, dtgNm: Nm): Kts {
  return ahead(star.speeds, dtgNm);
}
