/**
 * Flying a STAR (docs §4.5).
 *
 * While an aircraft is on its STAR the autopilot owns all three axes: it tracks
 * the route waypoint to waypoint, descends on the published profile and slows
 * to the published speed. The controller takes an axis back by instructing it —
 * a heading takes the aircraft off the route altogether, an altitude or a speed
 * overrides just that part of the profile and leaves it on the lateral track.
 */
import {
  altitudeAheadFt,
  ENTRY_FIX_INDEX,
  raisedToLevel,
  speedAheadKts,
  starProfileAt,
  type Star,
  type StarConstraint,
} from '../scenario/stars.js';
import type { Aircraft } from './aircraft.js';
import { STAR_FIX_CAPTURE_NM, STAR_MAX_ANTICIPATION_NM } from './constants.js';
import { fixPassed, routeAnticipationNm } from './dynamics.js';
import { stepHold, type HoldEvent, type HoldNav } from './hold.js';
import { bearing, distance, trueAirspeed, type Ft, type Nm, type Sec } from './units.js';

export interface StarNav {
  route: Star;
  /** Index of the waypoint being flown to. */
  index: number;
  /** The controller has assigned an altitude; the published profile is off. */
  altitudeManual: boolean;
  /** The controller has assigned a speed; the published speed is off. */
  speedManual: boolean;
  /**
   * Holding pattern at the waypoint at `index`, or null when not holding
   * (§4.6). The aircraft stays on its STAR throughout: the hold suspends route
   * following rather than replacing it, so exiting resumes from the same fix.
   */
  hold: HoldNav | null;
  /**
   * True while the aircraft is descending back down to the published profile
   * after holding above it (§4.6). The profile is normally written straight
   * onto the aircraft, which assumes it is already on it — true for an ordinary
   * arrival, but a teleport for one leaving a hold thousands of feet high. So
   * it flies down on ordinary kinematic rates until it reaches the profile,
   * which is a descent through it: the capture test is simply "no longer above".
   */
  rejoining: boolean;
  /**
   * The altitude constraints this aircraft is actually flying.
   *
   * Normally the route's own, and shared with it. It differs only when the
   * entry fix had a holding stack on it at handover, in which case the run in
   * to that fix is raised to sit above the stack (§4.5) — so the profile is a
   * property of the aircraft rather than of the chart, and everything that
   * reads it must read it from here.
   */
  altitudes: readonly StarConstraint[];
}

export type StarEvent = { kind: 'starComplete'; fix: string } | HoldEvent;

/**
 * Put a freshly handed-over arrival on its route, tracking the fix after the
 * gate. `levelFt` raises the run in to the entry fix above a holding stack
 * already on it (§4.5); without one the aircraft flies the published chart.
 */
export function joinStar(route: Star, levelFt: Ft | null = null): StarNav {
  return {
    route,
    index: ENTRY_FIX_INDEX,
    altitudeManual: false,
    speedManual: false,
    hold: null,
    rejoining: false,
    altitudes: levelFt === null ? route.altitudes : raisedToLevel(route, levelFt),
  };
}

export function activeFix(nav: StarNav) {
  return nav.route.waypoints[nav.index]!;
}

/**
 * True while the published profile owns the vertical, in which case the
 * altitude comes straight from the route geometry and kinematics must not also
 * integrate it — exactly as on the glideslope.
 *
 * Read *after* `stepStar`, since a hold can end mid-tick and hand the vertical
 * straight back to the profile on the same tick.
 */
export function starOwnsVertical(ac: Aircraft): boolean {
  const nav = ac.star;
  // A hold is flown level at a target, like any other assigned altitude, so
  // kinematics keep the vertical while the pattern is being flown.
  if (!nav || nav.altitudeManual || nav.hold) return false;
  // An aircraft rejoining from a holding level is descending *to* the profile,
  // not sitting on it; kinematics own that descent until it is captured.
  return !nav.rejoining;
}

/** Distance still to fly along the route, from wherever the aircraft actually is. */
export function distanceToGoNm(ac: Aircraft, nav: StarNav): Nm {
  const fix = activeFix(nav);
  return distance({ x: ac.x, y: ac.y }, fix.position) + fix.dtgNm;
}

/**
 * The published speed the aircraft is slowing towards, or null when the
 * controller owns the speed. The autopilot's own target moves continuously
 * down the profile; this is the number on the chart.
 */
export function starTargetSpeedKts(ac: Aircraft): number | null {
  const nav = ac.star;
  if (!nav || nav.speedManual) return null;
  return speedAheadKts(nav.route, distanceToGoNm(ac, nav));
}

/**
 * Come off the route. Whatever the controller has not taken over stays where
 * the published profile left it: the descent clearance to the next published
 * altitude stands, which is what "descend 5000, turn left heading 090" means.
 */
export function leaveStar(ac: Aircraft): void {
  const nav = ac.star;
  if (!nav) return;
  // A vector out of a holding pattern takes the aircraft off the route the same
  // way a vector off any other part of it does (§4.6): the pattern goes with
  // it, and so does the forced right turn it was flying.
  nav.hold = null;
  ac.turnDirection = null;
  const dtgNm = distanceToGoNm(ac, nav);
  if (!nav.altitudeManual) ac.targetAltitudeFt = altitudeAheadFt(nav.route, dtgNm, nav.altitudes);
  if (!nav.speedManual) ac.targetIasKts = speedAheadKts(nav.route, dtgNm);
  ac.targetHeadingDeg = ac.headingDeg;
  ac.star = null;
}

/** Drive one tick of route following. Kinematics run after, except the vertical. */
export function stepStar(ac: Aircraft, dt: Sec, timeS: Sec = 0): StarEvent[] {
  const nav = ac.star;
  if (!nav) return [];

  // Holding suspends route following: the pattern owns the lateral track, and
  // sequencing stays parked on the holding fix until the aircraft leaves.
  if (nav.hold) {
    const events = stepHold(ac, nav, timeS);
    if (nav.hold) return events;
    // The hold ended on this tick. Fall through so the STAR resumes from the
    // holding fix on the same tick rather than after a tick of nothing.
    return [...events, ...stepStar(ac, dt, timeS)];
  }

  const fix = activeFix(nav);
  const position = { x: ac.x, y: ac.y };
  const rangeNm = distance(position, fix.position);
  const courseDeg = bearing(position, fix.position);
  const dtgNm = rangeNm + fix.dtgNm;

  const profile = starProfileAt(nav.route, dtgNm, nav.altitudes);
  if (!nav.altitudeManual) {
    // The profile is captured the moment the aircraft is no longer above it.
    // Descending onto it is the only way to rejoin, so this needs no tolerance
    // window: the descent crosses the profile and the crossing is the capture.
    if (nav.rejoining && ac.altitudeFt <= profile.altitudeFt) nav.rejoining = false;

    if (nav.rejoining) {
      // Still above it — fly down on ordinary rates rather than being written
      // onto the chart, which for an aircraft leaving a hold thousands of feet
      // high would be a teleport (§4.6). `starOwnsVertical` agrees for this
      // tick, so kinematics integrate the vertical.
      ac.targetAltitudeFt = profile.altitudeFt;
    } else {
      // Fly the published profile exactly, so every crossing altitude is made
      // good; the vertical rate falls out of the geometry (~400–600 fpm) and its
      // energy is still charged against the speed budget by stepKinematics.
      const previous = ac.altitudeFt;
      ac.altitudeFt = profile.altitudeFt;
      ac.targetAltitudeFt = altitudeAheadFt(nav.route, dtgNm, nav.altitudes);
      ac.vsFpm = dt > 0 ? ((ac.altitudeFt - previous) / dt) * 60 : 0;
    }
  }
  if (!nav.speedManual) ac.targetIasKts = profile.speedKts;
  ac.targetHeadingDeg = courseDeg;

  const passed = fixPassed(rangeNm, ac.headingDeg, courseDeg, STAR_FIX_CAPTURE_NM);
  const last = nav.index === nav.route.waypoints.length - 1;

  if (last) {
    if (passed) {
      leaveStar(ac);
      return [{ kind: 'starComplete', fix: fix.name }];
    }
    return [];
  }

  const anticipationNm = routeAnticipationNm(
    nav.route.waypoints,
    nav.index,
    trueAirspeed(ac.iasKts, ac.altitudeFt),
    STAR_FIX_CAPTURE_NM,
    STAR_MAX_ANTICIPATION_NM,
  );
  if (passed || rangeNm <= anticipationNm) nav.index += 1;
  return [];
}
