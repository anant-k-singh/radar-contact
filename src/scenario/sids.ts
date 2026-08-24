/**
 * Standard instrument departures — three SIDs off runway 18 (docs §4.7).
 *
 * A SID is the mirror of a STAR and is deliberately *not* the same shape. A STAR
 * publishes a continuous descent profile that the autopilot is flown onto; a SID
 * publishes **restrictions**, and between them the aircraft climbs at whatever
 * its own performance gives. So a fix here carries an `at or below` or an
 * `at or above`, never a level to sit on, and the climb comes out of
 * `departure.ts` reading the type's performance rather than out of this file.
 *
 * Geometry, all three routes:
 *
 * Runway 18 departs to the south, so every SID starts on runway heading to
 * NORVU, 3.2 NM off the departure end — far enough that the turn happens at a
 * realistic 1000 ft or so rather than at the wheels-up point.
 *
 * - **Turning SIDs** (west and east) then cross the south STARs' downwind legs
 *   at x = ±8. Those legs are descending 6000 → 4000 as they run north, and the
 *   crossing is placed at y = −5, where the arrival above is still at about
 *   5800 ft: a departure held at or below 3500 passes 2300 ft underneath it.
 *   The restriction runs on to x = ±13, five miles past the crossing, so the
 *   climb does not start until the track is laterally clear of the arrival route
 *   (see `RELEASE_X_NM`). From there they climb to 12,000 by the exit fix and
 *   leave due west / due east — through the middle of the gaps between the
 *   arrival gates, so no SID crosses a STAR anywhere except underneath the
 *   downwind.
 * - **The straight SID** runs down the extended departure centreline, which is
 *   the one direction with no arrival traffic in it at all: the nearest STAR
 *   fix is 8 NM abeam. It is an unrestricted climb the whole way.
 *
 * The exit fixes sit inside the boundary rather than on it, so the aircraft
 * finishes the route and flies the last few miles on its exit heading — the same
 * thing a STAR does at its last fix, and what the airspace exit check expects.
 */
import { CEILING_FT } from '../sim/constants.js';
import { bearing, distance, headingVector, type Ft, type Nm, type Point } from '../sim/units.js';
import { AIRPORT } from './airport.js';

export interface SidWaypoint {
  name: string;
  position: Point;
  /**
   * Published "at or below" — the ceiling in force from the start of the route
   * until this fix is passed. This is the whole point of a turning SID here:
   * it is what takes the departure under the arrival downwind.
   */
  maxAltitudeFt?: Ft;
  /**
   * Published "at or above". Nothing reads this to fly the aircraft — a
   * departure is always climbing as hard as it can — so it is documentation on
   * the chart and the thing the performance tests assert against.
   */
  minAltitudeFt?: Ft;
  /** Route distance from the departure end of the runway to this fix. */
  alongNm: Nm;
}

export interface Sid {
  /** Chart name, e.g. `SABAR1A`. */
  name: string;
  /** Which way it turns off the runway — what the chart and the log line say. */
  turn: 'left' | 'right' | 'straight';
  waypoints: readonly SidWaypoint[];
  lengthNm: Nm;
}

// ── Route geometry ──────────────────────────────────────────────────────────

/** How far down the departure track the initial fix sits, in NM south of the ARP. */
const INITIAL_FIX_NM = 4;
/**
 * Where the turning SIDs cross the south STARs' downwind legs. The legs run
 * along x = ±8; y = −5 is south enough that the arrival above is still near
 * 5800 ft, and the whole point of the restriction is that gap.
 */
const CROSSING_X_NM = 8;
const CROSSING_Y_NM = -5;
/**
 * Where the crossing restriction is released, 5 NM beyond the downwind.
 *
 * It is deliberately *not* released at the crossing. A departure that started
 * climbing the moment it passed the downwind would still be within 3 NM of the
 * arrival route for the next three miles — and 3 NM of climb is 1500 ft, which
 * is enough to eat the whole gap it was just held under. So the restriction runs
 * until the track is laterally clear of the arrival route, and the climb begins
 * where the geometry allows it rather than where the conflict happens to end.
 * This is what a real SID does: the "at or below" is published at the fix past
 * the conflict, not at the conflict.
 */
const RELEASE_X_NM = 13;
/**
 * How far past the release fix the exit fix sits. A heavy leaving 3500 ft needs
 * about 21 NM to make 12,000 (docs §4.7), so 28 NM is the requirement plus a
 * margin that holds for every type in the fleet, and still leaves the exit fix
 * inside the boundary with a leg to fly out on.
 */
const EXIT_LEG_NM = 28;
/** Where the straight SID's exit fix sits, in NM south of the ARP. */
const STRAIGHT_EXIT_NM = 34;

/** Published ceiling under the arrival downwind. */
const CROSSING_MAX_FT = 3500;

interface Draft {
  name: string;
  position: Point;
  maxAltitudeFt?: Ft;
  minAltitudeFt?: Ft;
}

function build(name: string, turn: Sid['turn'], drafts: readonly Draft[]): Sid {
  // The departure end of the runway is the first waypoint: it is where the
  // route starts on the chart, and the aircraft is already past it by the time
  // it is tracking anything. Nothing is published there, the way nothing is
  // published at a STAR's last fix beyond where it hands over.
  const drafted: Draft[] = [
    { name: `RWY${AIRPORT.runway.id}`, position: AIRPORT.runway.farEnd },
    ...drafts,
  ];

  const waypoints: SidWaypoint[] = drafted.map((draft) => ({ ...draft, alongNm: 0 }));
  for (let i = 1; i < waypoints.length; i += 1) {
    const here = waypoints[i]!;
    const previous = waypoints[i - 1]!;
    here.alongNm = previous.alongNm + distance(previous.position, here.position);
  }

  return { name, turn, waypoints, lengthNm: waypoints[waypoints.length - 1]!.alongNm };
}

/** `side` is −1 west of the centreline, +1 east. */
function turningSid(
  name: string,
  side: -1 | 1,
  crossing: string,
  release: string,
  exit: string,
): Sid {
  return build(name, side < 0 ? 'right' : 'left', [
    { name: 'NORVU', position: { x: 0, y: -INITIAL_FIX_NM } },
    {
      name: crossing,
      position: { x: side * CROSSING_X_NM, y: CROSSING_Y_NM },
      maxAltitudeFt: CROSSING_MAX_FT,
    },
    // The same restriction republished, which is what carries it past the
    // conflict: `ceilingAtFt` takes the lowest of every crossing not yet passed,
    // so the aircraft is still held at 3500 between the two.
    {
      name: release,
      position: { x: side * RELEASE_X_NM, y: CROSSING_Y_NM },
      maxAltitudeFt: CROSSING_MAX_FT,
    },
    {
      name: exit,
      position: { x: side * (RELEASE_X_NM + EXIT_LEG_NM), y: CROSSING_Y_NM },
      minAltitudeFt: CEILING_FT,
    },
  ]);
}

/**
 * The three published departures.
 *
 * Turning right off runway 18 heads west and turning left heads east, which is
 * why the west route is the right turn. Both share NORVU: real SIDs off one
 * runway do, and two departures are never closer together than the release
 * interval anyway.
 */
export const SIDS: readonly Sid[] = [
  turningSid('SABAR1A', -1, 'MORVA', 'VELSA', 'SABAR'),
  turningSid('KIROS1A', 1, 'TELMU', 'ZANDU', 'KIROS'),
  build('RAMOX1A', 'straight', [
    { name: 'NORVU', position: { x: 0, y: -INITIAL_FIX_NM } },
    { name: 'RAMOX', position: { x: 0, y: -STRAIGHT_EXIT_NM }, minAltitudeFt: CEILING_FT },
  ]),
];

export function sidByName(name: string): Sid | undefined {
  return SIDS.find((sid) => sid.name === name);
}

/**
 * True once the aircraft is physically past a fix, measured along the leg
 * *out* of it rather than the leg into it.
 *
 * This is deliberately not the route sequencer's idea of "passed". Sequencing
 * moves to the next fix early so the turn is flown as a fly-by, which for the
 * downwind crossing would start the climb up to half a mile *before* the fix —
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
  const track = headingVector(outbound);
  return (position.x - fix.position.x) * track.x + (position.y - fix.position.y) * track.y > 0;
}

/**
 * The lowest "at or below" still in force where the aircraft is, or the airspace
 * ceiling once every restriction is behind it.
 *
 * Taken from the position rather than from the sequencing index, which is what
 * makes the restriction hold all the way to its fix (see `isPastFix`).
 */
export function ceilingAtFt(sid: Sid, position: Point): Ft {
  let ceilingFt = CEILING_FT;
  for (let i = 1; i < sid.waypoints.length; i += 1) {
    const maxAltitudeFt = sid.waypoints[i]!.maxAltitudeFt;
    if (maxAltitudeFt === undefined) continue;
    if (!isPastFix(sid, i, position)) ceilingFt = Math.min(ceilingFt, maxAltitudeFt);
  }
  return ceilingFt;
}
