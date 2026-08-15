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
  speedAheadKts,
  starProfileAt,
  type Star,
} from '../scenario/stars.js';
import type { Aircraft } from './aircraft.js';
import { STAR_FIX_CAPTURE_NM, STAR_MAX_ANTICIPATION_NM } from './constants.js';
import { turnRadiusNm } from './dynamics.js';
import {
  bearing,
  clamp,
  distance,
  headingDelta,
  headingDiff,
  toRad,
  trueAirspeed,
  type Nm,
  type Sec,
} from './units.js';

export interface StarNav {
  route: Star;
  /** Index of the waypoint being flown to. */
  index: number;
  /** The controller has assigned an altitude; the published profile is off. */
  altitudeManual: boolean;
  /** The controller has assigned a speed; the published speed is off. */
  speedManual: boolean;
}

export type StarEvent = { kind: 'starComplete'; fix: string };

/** Put a freshly handed-over arrival on its route, tracking the fix after the gate. */
export function joinStar(route: Star): StarNav {
  return { route, index: 1, altitudeManual: false, speedManual: false };
}

export function activeFix(nav: StarNav) {
  return nav.route.waypoints[nav.index]!;
}

/**
 * True while the published profile owns the vertical, in which case the
 * altitude comes straight from the route geometry and kinematics must not also
 * integrate it — exactly as on the glideslope.
 */
export function starOwnsVertical(ac: Aircraft): boolean {
  return ac.star !== null && !ac.star.altitudeManual;
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
  const dtgNm = distanceToGoNm(ac, nav);
  if (!nav.altitudeManual) ac.targetAltitudeFt = altitudeAheadFt(nav.route, dtgNm);
  if (!nav.speedManual) ac.targetIasKts = speedAheadKts(nav.route, dtgNm);
  ac.targetHeadingDeg = ac.headingDeg;
  ac.star = null;
}

/**
 * How far before a fix to start the turn onto the next leg, so the track is
 * flown as a fly-by rather than an overshoot and a correction back.
 * `d = R·tan(θ/2)` is the tangent distance of the turn arc.
 */
function anticipationNm(ac: Aircraft, nav: StarNav): Nm {
  const waypoints = nav.route.waypoints;
  const inbound = bearing(waypoints[nav.index - 1]!.position, waypoints[nav.index]!.position);
  const outbound = bearing(waypoints[nav.index]!.position, waypoints[nav.index + 1]!.position);
  const turnDeg = Math.abs(headingDelta(inbound, outbound));
  const radiusNm = turnRadiusNm(trueAirspeed(ac.iasKts, ac.altitudeFt));
  return clamp(
    radiusNm * Math.tan(toRad(turnDeg / 2)),
    STAR_FIX_CAPTURE_NM,
    STAR_MAX_ANTICIPATION_NM,
  );
}

/** Drive one tick of route following. Kinematics run after, except the vertical. */
export function stepStar(ac: Aircraft, dt: Sec): StarEvent[] {
  const nav = ac.star;
  if (!nav) return [];

  const fix = activeFix(nav);
  const position = { x: ac.x, y: ac.y };
  const rangeNm = distance(position, fix.position);
  const courseDeg = bearing(position, fix.position);
  const dtgNm = rangeNm + fix.dtgNm;

  const profile = starProfileAt(nav.route, dtgNm);
  if (!nav.altitudeManual) {
    // Fly the published profile exactly, so every crossing altitude is made
    // good; the vertical rate falls out of the geometry (~400–600 fpm) and its
    // energy is still charged against the speed budget by stepKinematics.
    const previous = ac.altitudeFt;
    ac.altitudeFt = profile.altitudeFt;
    ac.targetAltitudeFt = altitudeAheadFt(nav.route, dtgNm);
    ac.vsFpm = dt > 0 ? ((ac.altitudeFt - previous) / dt) * 60 : 0;
  }
  if (!nav.speedManual) ac.targetIasKts = profile.speedKts;
  ac.targetHeadingDeg = courseDeg;

  // Sequencing. The abeam test is a backstop: pure pursuit only leaves a fix
  // behind if the aircraft was thrown off the leg by an earlier tight turn.
  const passed = rangeNm < STAR_FIX_CAPTURE_NM || headingDiff(ac.headingDeg, courseDeg) > 90;
  const last = nav.index === nav.route.waypoints.length - 1;

  if (last) {
    if (passed) {
      leaveStar(ac);
      return [{ kind: 'starComplete', fix: fix.name }];
    }
    return [];
  }

  if (passed || rangeNm <= anticipationNm(ac, nav)) nav.index += 1;
  return [];
}
