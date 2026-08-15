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
 * - **North gates** (KOVAL, VANDA) run straight in to a corner fix abeam the
 *   field, then a level leg at 5000 ft along 090/270 that stops 2 NM short of
 *   the extended centerline at 16 NM final — right at the 5000 ft glideslope
 *   intercept range. Turn one onto final; the other has to wait.
 * - **South gates** (TEMBA, RIMOL) run straight in until they cross 8 NM abeam
 *   the centerline, then turn north onto a parallel leg at 5000 ft that ends
 *   11 NM north of the field. That leg is a downwind: turn base when the gap
 *   in the sequence is there, and descend for the intercept on the way round.
 *
 * No two routes cross. Only the two north routes end pointing at each other,
 * 4 NM apart, which is the sequencing problem the player is here to solve.
 */
import {
  ENTRY_SPEED_KTS,
  STAR_ARRIVAL_SPEED_KTS,
  STAR_INTERMEDIATE_ALT_FT,
  STAR_PLATFORM_ALT_FT,
} from '../sim/constants.js';
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
const DOWNWIND_OFFSET_NM = 8;
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

/** `side` is −1 west of the centerline, +1 east. */
function northStar(name: string, gateName: string, side: -1 | 1, fixes: [string, string, string]): Star {
  const gate = gateFor(gateName);
  const corner: Point = { x: side * NORTH_CORNER_NM, y: PLATFORM_NM };
  return build(name, gate, [
    { name: fixes[0], position: midpoint(gate.position, corner), altitudeFt: STAR_INTERMEDIATE_ALT_FT },
    {
      name: fixes[1],
      position: corner,
      altitudeFt: STAR_PLATFORM_ALT_FT,
      speedKts: STAR_ARRIVAL_SPEED_KTS,
    },
    {
      name: fixes[2],
      position: { x: side * MERGE_OFFSET_NM, y: PLATFORM_NM },
      altitudeFt: STAR_PLATFORM_ALT_FT,
      speedKts: STAR_ARRIVAL_SPEED_KTS,
    },
  ]);
}

function southStar(name: string, gateName: string, side: -1 | 1, fixes: [string, string, string]): Star {
  const gate = gateFor(gateName);
  // Turning onto the downwind where the gate's own inbound track reaches the
  // offset keeps the first leg dead straight from the handover.
  const corner = inboundTrackAtX(gate, side * DOWNWIND_OFFSET_NM);
  return build(name, gate, [
    { name: fixes[0], position: midpoint(gate.position, corner), altitudeFt: STAR_INTERMEDIATE_ALT_FT },
    {
      name: fixes[1],
      position: corner,
      altitudeFt: STAR_PLATFORM_ALT_FT,
      speedKts: STAR_ARRIVAL_SPEED_KTS,
    },
    {
      name: fixes[2],
      position: { x: side * DOWNWIND_OFFSET_NM, y: DOWNWIND_END_NM },
      altitudeFt: STAR_PLATFORM_ALT_FT,
      speedKts: STAR_ARRIVAL_SPEED_KTS,
    },
  ]);
}

export const STARS: readonly Star[] = [
  northStar('VANDA1A', 'VANDA', -1, ['OKPUR', 'ALVOR', 'ARDIS']),
  northStar('KOVAL1A', 'KOVAL', 1, ['NIVEL', 'BELGA', 'BOXAR']),
  southStar('RIMOL1A', 'RIMOL', -1, ['SUDIX', 'LOMSA', 'PIKON']),
  southStar('TEMBA1A', 'TEMBA', 1, ['TAVIR', 'DEMUX', 'KETAN']),
];

export function starForGate(gateName: string): Star | undefined {
  return STARS.find((star) => star.gate === gateName);
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

export function starProfileAt(star: Star, dtgNm: Nm): { altitudeFt: Ft; speedKts: Kts } {
  return {
    altitudeFt: interpolate(star.altitudes, dtgNm),
    speedKts: interpolate(star.speeds, dtgNm),
  };
}

export function altitudeAheadFt(star: Star, dtgNm: Nm): Ft {
  return ahead(star.altitudes, dtgNm);
}

export function speedAheadKts(star: Star, dtgNm: Nm): Kts {
  return ahead(star.speeds, dtgNm);
}
