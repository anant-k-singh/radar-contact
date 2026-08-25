/**
 * Flying a SID (docs §4.7).
 *
 * A departure is the mirror image of an arrival in every way that matters here.
 * It is never on our frequency, so nothing competes to write its targets: this
 * module owns all three axes for the whole time the aircraft is on the scope,
 * and there is no `altitudeManual` / `speedManual` seam because there is no
 * controller to take an axis back.
 *
 * The three phases:
 *
 * - **Ground roll.** The only place in the simulation where an aircraft is not
 *   flying. `stepKinematics` is skipped entirely for it — its acceleration is an
 *   order of magnitude above `MAX_ACCEL_KTS_S`, and a wheels-on-the-ground
 *   aircraft must not turn, climb or gain TAS with altitude. So the roll
 *   integrates itself, here, and the caller is told not to run kinematics.
 * - **Climb.** Targets come from the route and from the type's own performance:
 *   the initial-climb IAS until the flaps are up, then 250 kt, and a target
 *   altitude that is simply the lowest published "at or below" still ahead. That
 *   is the whole vertical model — the aircraft climbs as hard as it can toward a
 *   ceiling, which is what a departure actually does, rather than being flown
 *   onto a profile the way a STAR arrival is.
 * - **After the last fix.** The route is finished and the aircraft holds its
 *   exit heading until the airspace boundary takes it. Nothing else changes:
 *   `ac.sid` stays set, because it is what marks the aircraft as a departure.
 *
 * Unlike `stepStar`, this never writes `ac.altitudeFt` directly. There is no
 * published profile to sit on, so kinematics own the vertical throughout and the
 * `controlVertical: false` seam is not one of this module's problems.
 */
import { AIRCRAFT_TYPES, type AircraftType } from '../scenario/aircraftTypes.js';
import { AIRPORT } from '../scenario/airport.js';
import { ceilingAtFt, type Sid, type SidWaypoint } from '../scenario/sids.js';
import type { Aircraft } from './aircraft.js';
import {
  DEPARTURE_ACCEL_ALT_FT,
  DEPARTURE_CLIMB_SPEED_KTS,
  SID_FIX_CAPTURE_NM,
  SID_MAX_ANTICIPATION_NM,
  TAKEOFF_ACCEL_KTS_S,
} from './constants.js';
import { flyByAnticipationNm } from './dynamics.js';
import {
  bearing,
  distance,
  headingDelta,
  headingDiff,
  headingVector,
  trueAirspeed,
  type Nm,
  type Sec,
} from './units.js';

export interface SidNav {
  route: Sid;
  /** Index of the waypoint being flown to. */
  index: number;
  /**
   * True once the last fix is behind the aircraft. The route is over but the
   * aircraft is not: it flies the exit heading out of the airspace, and stays a
   * departure the whole way.
   */
  complete: boolean;
}

export type DepartureEvent =
  | { kind: 'airborne'; sid: string }
  | { kind: 'sidComplete'; fix: string };

/**
 * How long this type needs on the runway to reach V2 (§4.7).
 *
 * The ground roll is a constant acceleration to V2, so the time falls straight
 * out of the two figures rather than needing to be flown to find out — which is
 * what lets the tower's release decision ask "will it be airborne in time"
 * before there is an aircraft to ask about.
 */
export function departureRollTimeS(type: AircraftType): Sec {
  return type.v2Kts / (TAKEOFF_ACCEL_KTS_S * type.budgetScale);
}

/**
 * The longest take-off roll in the fleet.
 *
 * The release decision is made before the departure exists — the type is drawn
 * at the release, not when it joins the queue — so it has to assume the worst
 * type it might be about to build. Being conservative for a medium is the right
 * way round: the cost is a departure held slightly longer than it needed to be.
 */
export const MAX_DEPARTURE_ROLL_S: Sec = Math.max(...AIRCRAFT_TYPES.map(departureRollTimeS));

/** Put a departure at the holding point, tracking the first fix after the runway. */
export function joinSid(route: Sid): SidNav {
  return { route, index: 1, complete: false };
}

export function activeSidFix(nav: SidNav): SidWaypoint {
  return nav.route.waypoints[Math.min(nav.index, nav.route.waypoints.length - 1)]!;
}

/**
 * One tick of the take-off roll. Returns true while the aircraft is still on the
 * ground, in which case the caller must *not* run kinematics over it.
 *
 * Acceleration scales with the type's energy budget for the same reason
 * everything else does: a heavy uses more runway. Ground speed is IAS at field
 * elevation, so the position integration needs no TAS correction — but it is
 * written through `trueAirspeed` anyway, so a field above sea level would be
 * right without anyone having to remember this line.
 */
function stepGroundRoll(ac: Aircraft, dt: Sec): boolean {
  ac.iasKts = Math.min(
    ac.type.v2Kts,
    ac.iasKts + TAKEOFF_ACCEL_KTS_S * ac.type.budgetScale * dt,
  );

  const groundSpeedKts = trueAirspeed(ac.iasKts, ac.altitudeFt);
  const distNm = (groundSpeedKts / 3600) * dt;
  // Straight down the runway: no turning on the ground, whatever the route says.
  const dir = headingVector(ac.headingDeg);
  ac.x += dir.x * distNm;
  ac.y += dir.y * distNm;
  ac.trackMilesFlown += distNm;
  ac.vsFpm = 0;

  return ac.iasKts < ac.type.v2Kts;
}

/** How far before a fix to start the turn onto the next leg of the SID. */
function anticipationNm(ac: Aircraft, nav: SidNav): Nm {
  const waypoints = nav.route.waypoints;
  const inbound = bearing(waypoints[nav.index - 1]!.position, waypoints[nav.index]!.position);
  const outbound = bearing(waypoints[nav.index]!.position, waypoints[nav.index + 1]!.position);
  return flyByAnticipationNm(
    headingDelta(inbound, outbound),
    trueAirspeed(ac.iasKts, ac.altitudeFt),
    SID_FIX_CAPTURE_NM,
    SID_MAX_ANTICIPATION_NM,
  );
}

/**
 * Drive one tick of a departure. Returns the events for `world.ts` to log; the
 * caller decides whether to run kinematics afterwards by reading `ac.phase`,
 * which is `roll` for exactly as long as the aircraft is on the ground.
 */
export function stepDeparture(ac: Aircraft, dt: Sec): DepartureEvent[] {
  const nav = ac.sid;
  if (!nav) return [];

  if (ac.phase === 'roll') {
    if (stepGroundRoll(ac, dt)) return [];
    // Rotation. From here it is an ordinary aircraft again and kinematics take
    // over; the climb targets are set by the rest of this function on the same
    // tick, so there is never a frame of a rotated aircraft with no climb in it.
    ac.phase = 'climb';
    ac.targetIasKts = ac.type.initialClimbKts;
    return [{ kind: 'airborne', sid: nav.route.name }, ...stepDeparture(ac, dt)];
  }

  const position = { x: ac.x, y: ac.y };

  // Speed: the initial-climb IAS until the flaps are up, then the 250 kt climb
  // speed. Measured above the *field*, not above sea level — an acceleration
  // altitude is an AGL number.
  const aglFt = ac.altitudeFt - AIRPORT.elevationFt;
  ac.targetIasKts =
    aglFt < DEPARTURE_ACCEL_ALT_FT ? ac.type.initialClimbKts : DEPARTURE_CLIMB_SPEED_KTS;

  // Vertical: climb at the type's own rate towards the lowest restriction still
  // in force, or to the airspace ceiling once they are all behind. Read from the
  // position rather than the sequencing index, so a crossing restriction holds
  // right up to its fix even though the turn onto the next leg begins earlier.
  // Kinematics do the integrating, so the level-off at a restriction comes out
  // of the ordinary capture taper rather than being a special case here.
  ac.targetAltitudeFt = ceilingAtFt(nav.route, position);

  // The route is over; the exit heading and the climb are all that is left.
  if (nav.complete) return [];

  const fix = activeSidFix(nav);
  const rangeNm = distance(position, fix.position);
  const courseDeg = bearing(position, fix.position);
  ac.targetHeadingDeg = courseDeg;

  // Sequencing, exactly as on a STAR: the abeam test is the backstop for a fix
  // that a tight turn threw the aircraft past.
  const passed = rangeNm < SID_FIX_CAPTURE_NM || headingDiff(ac.headingDeg, courseDeg) > 90;
  const last = nav.index === nav.route.waypoints.length - 1;

  if (last) {
    if (passed) {
      nav.complete = true;
      // Whatever heading it is on is the heading it leaves on. The exit fixes
      // sit inside the boundary precisely so this last leg exists.
      ac.targetHeadingDeg = ac.headingDeg;
      return [{ kind: 'sidComplete', fix: fix.name }];
    }
    return [];
  }

  if (passed || rangeNm <= anticipationNm(ac, nav)) nav.index += 1;
  return [];
}
