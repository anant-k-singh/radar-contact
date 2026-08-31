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
 * realistic thousand feet or so rather than at the wheels-up point. NORVU sits
 * on the turning leg, 4 NM south of the field, which the two turning routes then
 * follow due west and due east.
 *
 * - **Turning SIDs** cross the south STARs' downwind legs at x = ±6, where the
 *   arrival above is descending 7000 → 3000 on its way north. At the crossing
 *   latitude it is still at about 6700 ft, so a departure held at or below
 *   **4000** passes some 2700 ft underneath it.
 * - **The restriction ends at MORVA / TELMU, two miles beyond the crossing —
 *   not at the crossing itself.** Release the climb where the tracks cross and
 *   the departure is still inside 3 NM of the arrival route as it goes, so the
 *   `at or below` has to be carried past the conflict, which is what a real SID
 *   does. The crossing itself is left unlabelled: it is visible where the amber
 *   line passes under the blue one. Two miles is the shortest hold-down the
 *   geometry allows, and no more than that on purpose — a departure cruising
 *   level at 4000 ft any longer reads as one that has forgotten to climb.
 * - **The straight SID** runs down the extended departure centreline, the one
 *   direction with no arrival traffic in it at all: the nearest STAR fix is 6 NM
 *   abeam. It is an unrestricted climb the whole way.
 *
 * All three finish at 13,000 ft — a thousand above the airspace ceiling the
 * player is held to, and therefore above the highest arrival — and leave due
 * west, due east and due south, through the middle of the gaps between the
 * arrival gates. No SID crosses a STAR anywhere except underneath the downwind.
 *
 * The exit fixes sit inside the boundary rather than on it, so the aircraft
 * finishes the route and flies the last few miles on its exit heading — the same
 * thing a STAR does at its last fix, and what the airspace exit check expects.
 */
import { DEPARTURE_TOP_FT } from '../sim/constants.js';
import {
  bearing,
  distance,
  headingVector,
  project,
  type Ft,
  type Nm,
  type Point,
} from '../sim/units.js';
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

/**
 * How far south of the field the turning leg runs, and therefore where NORVU
 * sits on the centreline. 4 NM puts it 3.2 NM off the departure end — far enough
 * that the turn is flown at a realistic height — while keeping the leg itself
 * clear of LOMSA and DEMUX, which sit a mile further south at the corner of the
 * downwind.
 */
const TURN_LEG_NM = 4;
/**
 * Where the crossing restriction ends, in NM abeam the field. The downwind legs
 * are at x = ±6, so this is two miles beyond the crossing — the whole reason the
 * fix is past the crossing rather than on it is that a departure released at the
 * crossing climbs straight back into the gap it was just held under.
 *
 * Two miles is as close in as the geometry allows, and it is deliberately no
 * further: every mile of restriction is another 20 seconds of a departure
 * cruising level at 4000 ft in plain view, which reads as an aircraft that has
 * forgotten to climb. The margin that makes it work is vertical rather than
 * lateral — the arrival above is on 7000 ft at the corner and higher on the leg
 * in from the gate, so the departure is still 2000 ft or more below it over the
 * mile or two it takes to get outside 3 NM of the arrival route.
 */
const RESTRICTION_END_NM = 8;
/**
 * How far past the restriction fix the exit fix sits. A heavy leaving 4000 ft
 * needs about 22 NM to make 13,000 (docs §4.7), so 28 NM is the requirement plus
 * a margin that holds for every type in the fleet, and still leaves the exit fix
 * inside the boundary with a leg to fly out on.
 */
const EXIT_LEG_NM = 28;
/** Where the straight SID's exit fix sits, in NM south of the ARP. */
const STRAIGHT_EXIT_NM = 36;

/** Published ceiling across the arrival downwind. */
const CROSSING_MAX_FT = 4000;

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
function turningSid(name: string, side: -1 | 1, restriction: string, exit: string): Sid {
  return build(name, side < 0 ? 'right' : 'left', [
    { name: 'NORVU', position: { x: 0, y: -TURN_LEG_NM } },
    {
      name: restriction,
      position: { x: side * RESTRICTION_END_NM, y: -TURN_LEG_NM },
      maxAltitudeFt: CROSSING_MAX_FT,
    },
    {
      name: exit,
      position: { x: side * (RESTRICTION_END_NM + EXIT_LEG_NM), y: -TURN_LEG_NM },
      minAltitudeFt: DEPARTURE_TOP_FT,
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
  turningSid('SABAR1A', -1, 'MORVA', 'SABAR'),
  turningSid('KIROS1A', 1, 'TELMU', 'KIROS'),
  build('RAMOX1A', 'straight', [
    { name: 'NORVU', position: { x: 0, y: -TURN_LEG_NM } },
    { name: 'RAMOX', position: { x: 0, y: -STRAIGHT_EXIT_NM }, minAltitudeFt: DEPARTURE_TOP_FT },
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
  return project(fix.position, position, headingVector(outbound)).alongNm > 0;
}

/**
 * The lowest "at or below" still in force where the aircraft is, or the top of
 * the departure climb once every restriction is behind it.
 *
 * Taken from the position rather than from the sequencing index, which is what
 * makes the restriction hold all the way to its fix (see `isPastFix`).
 */
export function ceilingAtFt(sid: Sid, position: Point): Ft {
  let ceilingFt = DEPARTURE_TOP_FT;
  for (let i = 1; i < sid.waypoints.length; i += 1) {
    const maxAltitudeFt = sid.waypoints[i]!.maxAltitudeFt;
    if (maxAltitudeFt === undefined) continue;
    if (!isPastFix(sid, i, position)) ceilingFt = Math.min(ceilingFt, maxAltitudeFt);
  }
  return ceilingFt;
}
