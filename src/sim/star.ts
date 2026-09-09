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
} from '../scenario/routes.js';
import type { Star, StarConstraint } from '../scenario/types.js';
import type { Aircraft } from './aircraft.js';
import {
  ALT_CAPTURE_FT,
  MAX_REJOIN_ANGLE_DEG,
  STAR_FIX_CAPTURE_NM,
  STAR_MAX_ANTICIPATION_NM,
  STAR_REJOIN_XTK_NM,
  XTK_ON_COURSE_NM,
} from './constants.js';
import { fixPassed, routeAnticipationNm } from './dynamics.js';
import { stepHold, type HoldEvent, type HoldNav } from './hold.js';
import {
  bearing,
  distance,
  headingDiff,
  headingVector,
  project,
  rightOf,
  trueAirspeed,
  type Deg,
  type Ft,
  type Nm,
  type Point,
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
  /**
   * Holding pattern at the waypoint at `index`, or null when not holding
   * (§4.6). The aircraft stays on its STAR throughout: the hold suspends route
   * following rather than replacing it, so exiting resumes from the same fix.
   */
  hold: HoldNav | null;
  /**
   * Which side of the published profile the aircraft is rejoining from — 1
   * above, -1 below, 0 once it is on it (§4.6). The profile is normally written
   * straight onto the aircraft, which assumes it is already on it — right for an
   * ordinary arrival, a teleport for one leaving a hold thousands of feet high.
   * Off the profile it flies on ordinary kinematic rates until it reaches it,
   * and the capture test is simply "no longer on the side it started".
   *
   * Signed rather than boolean because a rejoin from *below* has to be a
   * level-off rather than a climb, and captures when the descending profile
   * comes down to meet it.
   */
  rejoining: -1 | 0 | 1;
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

/**
 * The arrival an aircraft is being given, kept so `R` can hand it over (§4.5a).
 *
 * At most one of `Aircraft.star` and `Aircraft.rejoin` is ever set: the route is
 * either being flown or being remembered. Parking the whole `StarNav` rather
 * than the route's name is what preserves `altitudes` — the raised profile of an
 * aircraft delivered above a holding stack is a property of the aircraft, not of
 * the chart — and `index`, which is what "never a leg already flown" is measured
 * against.
 *
 * It starts as the route the aircraft was vectored off and is usually still
 * that, but `armRejoin` replaces it when the heading reaches another STAR
 * first: the aircraft then flies that one as if it were its own.
 */
export interface RejoinNav {
  nav: StarNav;
  /**
   * Leg being intercepted — `waypoints[leg-1] → waypoints[leg]` — or null while
   * the route is merely remembered.
   */
  leg: number | null;
}

export type StarEvent =
  | { kind: 'starComplete'; fix: string }
  | { kind: 'rejoinEstablished'; fix: string; route: string }
  | { kind: 'rejoinMissed'; fix: string; reason: string }
  | HoldEvent;

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
    rejoining: 0,
    altitudes: levelFt === null ? route.altitudes : raisedToLevel(route, levelFt),
  };
}

export function activeFix(nav: StarNav) {
  return nav.route.waypoints[nav.index]!;
}

/**
 * Where a hold anchors: the active fix, or the next one publishing a level.
 * `enterHold` takes the level *at* the fix, and a bare one would take whatever
 * height the aircraft was passing. Null if nothing ahead has one.
 */
export function holdFixIndex(nav: StarNav): number | null {
  for (let i = nav.index; i < nav.route.waypoints.length; i += 1) {
    if (nav.route.waypoints[i]!.altitudeFt !== undefined) return i;
  }
  return null;
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
  // An armed rejoin is already flying the published profile (§4.5a), so it owns
  // the vertical on the same terms an aircraft on the route does.
  const nav = ac.star ?? (ac.rejoin?.leg != null ? ac.rejoin.nav : null);
  // A hold is flown level at a target, like any other assigned altitude, so
  // kinematics keep the vertical while the pattern is being flown.
  if (!nav || nav.altitudeManual || nav.hold) return false;
  // An aircraft rejoining is flying *to* the profile, not sitting on it;
  // kinematics own that until it is captured.
  return nav.rejoining === 0;
}

/** Distance still to fly along the route, from wherever the aircraft actually is. */
export function distanceToGoNm(ac: Aircraft, nav: StarNav): Nm {
  const fix = activeFix(nav);
  return distance({ x: ac.x, y: ac.y }, fix.position) + fix.dtgNm;
}

/**
 * The published speed the aircraft is slowing towards, or null when the route is
 * not flying the speed — the controller has taken it, or the aircraft is in a
 * hold at `HOLD_SPEED_KTS`. The autopilot's own target moves continuously down
 * the profile; this is the number on the chart, and the one displayed.
 */
export function starTargetSpeedKts(ac: Aircraft): number | null {
  const nav = ac.star;
  if (!nav || nav.speedManual || nav.hold) return null;
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
  // Remembered, not discarded: `R` gives it back (§4.5a). Every caller wants
  // this — a vector, an approach clearance (which then forgets it, the arrival
  // being over) and running out of route.
  ac.rejoin = { nav, leg: null };
  ac.star = null;
}

/**
 * Where the aircraft sits relative to one leg of a route, in the same terms
 * `finalGeometry` reports for the localizer — which is what the rejoin capture
 * is modelled on (§6.1a).
 */
export interface LegGeometry {
  /** Along the leg from its start fix. Negative before it, past `lengthNm` after it. */
  alongNm: Nm;
  lengthNm: Nm;
  /** Cross-track error; positive is right of the leg's course. */
  xtkNm: Nm;
  courseDeg: Deg;
  interceptAngleDeg: Deg;
  /** True when the current track is reducing the cross-track error. */
  closing: boolean;
}

export function legGeometry(route: Star, leg: number, ac: Aircraft): LegGeometry {
  const a = route.waypoints[leg - 1]!.position;
  const b = route.waypoints[leg]!.position;
  const courseDeg = bearing(a, b);
  const dir = headingVector(courseDeg);
  const frame = project(a, { x: ac.x, y: ac.y }, dir);
  const right = rightOf(dir);
  const track = headingVector(ac.headingDeg);
  const xtkRate = track.x * right.x + track.y * right.y;
  return {
    alongNm: frame.alongNm,
    lengthNm: distance(a, b),
    xtkNm: frame.rightNm,
    courseDeg,
    interceptAngleDeg: headingDiff(ac.headingDeg, courseDeg),
    closing: Math.abs(frame.rightNm) < XTK_ON_COURSE_NM || frame.rightNm * xtkRate < 0,
  };
}

/** How far along `dir` the ray from `from` crosses segment a→b, or null. */
function rayHitNm(from: Point, dir: Point, a: Point, b: Point): Nm | null {
  const seg = { x: b.x - a.x, y: b.y - a.y };
  const den = dir.x * seg.y - dir.y * seg.x;
  if (Math.abs(den) < 1e-9) return null; // parallel: never crosses
  const rel = { x: a.x - from.x, y: a.y - from.y };
  const alongRay = (rel.x * seg.y - rel.y * seg.x) / den;
  const alongSeg = (rel.x * dir.y - rel.y * dir.x) / den;
  return alongRay > 0 && alongSeg >= 0 && alongSeg <= 1 ? alongRay : null;
}

/**
 * First leg of `route` at or after `fromLeg` that the ray crosses, nearest
 * first. `headingDeg` is only read for `onlyJoinable`, which drops the legs the
 * ray crosses too steeply to be joined at all.
 */
function firstLegHit(
  route: Star,
  from: Point,
  dir: Point,
  fromLeg: number,
  headingDeg: Deg,
  onlyJoinable: boolean,
): { leg: number; hitNm: Nm } | null {
  let best: { leg: number; hitNm: Nm } | null = null;
  const waypoints = route.waypoints;
  for (let leg = Math.max(fromLeg, 1); leg < waypoints.length; leg += 1) {
    if (onlyJoinable && rejoinAngleDeg(route, leg, headingDeg) > MAX_REJOIN_ANGLE_DEG) continue;
    const hit = rayHitNm(from, dir, waypoints[leg - 1]!.position, waypoints[leg]!.position);
    // Strictly nearer, so a ray aimed at a fix — which hits both of its legs at
    // the same point — keeps the earlier one and its crossing.
    if (hit !== null && (best === null || hit < best.hitNm)) best = { leg, hitNm: hit };
  }
  return best;
}

/** The route and leg a rejoin would join. */
export interface RejoinTarget {
  route: Star;
  leg: number;
}

/**
 * The route and leg a rejoin would join, or null when the heading reaches none
 * (§4.5a).
 *
 * Extend the assigned heading and take the first leg it crosses — which is
 * where the aircraft is actually going, and so the one question the scope
 * already answers by drawing the heading vector across the routes. Aiming
 * across the arc crosses a later leg first, which is how a rejoin doubles as a
 * shortcut.
 *
 * The heading is passed in rather than read off the aircraft so the *assigned*
 * one can be used — pressing `R` and turning in the same breath must use the
 * turn the player just gave — and so `star.ts` need not import `pilot.ts`,
 * which imports it.
 *
 * Every published STAR is a candidate, not just the one the aircraft came off:
 * a vectored arrival often ends up nearer another route and is going to
 * sequence behind the traffic already on it, so that is the arrival it joins,
 * and it then flies it as if it were its own.
 *
 * `own` is scanned first and a hit has to be strictly nearer to displace it, so
 * where two routes share a leg — VABB's do, separated only by level — the
 * aircraft keeps the one it is already on and the level it was given. On a
 * foreign route the scan floor is leg 1: "backwards is impossible" is measured
 * against a leg already flown, and there are none on a route never flown, which
 * leaves the ray as the whole guard there.
 *
 * A foreign leg counts only if the ray crosses it inside `MAX_REJOIN_ANGLE_DEG`
 * — a leg nobody aimed at, lying square across the heading, is flown through
 * rather than refused. "Refused, not skipped" is about the route the aircraft
 * came off, which is why `own` is never filtered: a steep crossing of that one
 * still has to be heard, with the number in it.
 */
export function rejoinTarget(
  stars: readonly Star[],
  ac: Aircraft,
  headingDeg: Deg,
  own: StarNav | null,
): RejoinTarget | null {
  const from = { x: ac.x, y: ac.y };
  const dir = headingVector(headingDeg);
  let best: RejoinTarget | null = null;
  let bestNm = Infinity;
  const consider = (route: Star, fromLeg: number, onlyJoinable: boolean) => {
    const hit = firstLegHit(route, from, dir, fromLeg, headingDeg, onlyJoinable);
    if (hit !== null && hit.hitNm < bestNm) {
      best = { route, leg: hit.leg };
      bestNm = hit.hitNm;
    }
  };
  if (own) consider(own.route, own.index, false);
  for (const route of stars) if (route !== own?.route) consider(route, 1, true);
  return best;
}

/**
 * Arm `rejoin` on a target, adopting the route when it is not the one being
 * remembered. A foreign route is flown exactly as published: the parked
 * `altitudes` are the raise over a holding stack on the *old* entry fix (§4.5),
 * which this aircraft is long past. `index` moves to the joining leg so a later
 * re-cast cannot pick a leg behind the one already aimed at.
 */
export function armRejoin(rejoin: RejoinNav, target: RejoinTarget): void {
  if (target.route !== rejoin.nav.route) {
    rejoin.nav = joinStar(target.route);
    rejoin.nav.index = target.leg;
  }
  rejoin.leg = target.leg;
}

/** The angle the assigned heading would cross `leg` at; `MAX_REJOIN_ANGLE_DEG` gates it. */
export function rejoinAngleDeg(route: Star, leg: number, headingDeg: Deg): Deg {
  const course = bearing(route.waypoints[leg - 1]!.position, route.waypoints[leg]!.position);
  return headingDiff(headingDeg, course);
}

/**
 * Fly the published vertical and speed profile for a given distance to go.
 *
 * Shared by an aircraft on its route and one still positioning to rejoin it
 * (§4.5a), which is the point: "resume the arrival" has to descend like the
 * arrival. Given the level at the joining fix as a plain assignment instead, a
 * rejoining aircraft dives at the full kinematic rate and levels off early —
 * 1400 fpm against the 700 an untouched arrival alongside it is doing, which is
 * the dive-and-drive §4.5 exists to avoid.
 */
function flyProfile(ac: Aircraft, nav: StarNav, dtgNm: Nm, dt: Sec): void {
  const profile = starProfileAt(nav.route, dtgNm, nav.altitudes);
  if (!nav.altitudeManual) {
    // The profile is captured the moment the aircraft is no longer on the side
    // it started. Both approaches to it are a crossing, so this needs no
    // tolerance window: the crossing is the capture. `Math.sign(0)` is 0, so
    // arriving exactly on the profile captures too.
    const offsetFt = ac.altitudeFt - profile.altitudeFt;
    if (nav.rejoining !== 0 && Math.sign(offsetFt) !== nav.rejoining) nav.rejoining = 0;

    if (nav.rejoining !== 0) {
      // Off the profile — fly on ordinary rates rather than being written onto
      // the chart, which for an aircraft leaving a hold thousands of feet high
      // would be a teleport (§4.6). `starOwnsVertical` agrees for this tick, so
      // kinematics integrate the vertical.
      //
      // From below, hold the level and let the descending profile come down to
      // meet it: an arrival is never climbed back up to a profile it is under.
      //
      // From above, aim `ALT_CAPTURE_FT` *under* the profile rather than at it.
      // The vertical rate tapers to 15 % inside that band (§4.3), and a profile
      // that is itself descending at 700 fpm then walks away from an aircraft
      // creeping onto it — it converges to a hundred feet above and stays there,
      // never crossing, so the capture never fires and the published crossings
      // are never made good. Aiming through the profile means the descent
      // actually reaches it, and the crossing is still the capture.
      ac.targetAltitudeFt =
        nav.rejoining > 0 ? profile.altitudeFt - ALT_CAPTURE_FT : ac.altitudeFt;
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
}

/**
 * Distance to run for an aircraft positioning to join `leg`: straight to the
 * fix that ends it, then the route's own distance from there. The same shape as
 * `distanceToGoNm`, which is what makes the profile continuous across the
 * capture — the fix does not change, only who is tracking to it.
 */
export function rejoinDistanceToGoNm(nav: StarNav, leg: number, ac: Aircraft): Nm {
  const fix = nav.route.waypoints[leg]!;
  return distance({ x: ac.x, y: ac.y }, fix.position) + fix.dtgNm;
}

/**
 * Watch an armed rejoin for its leg. The aircraft is flying the heading and the
 * levels it was given at the press, so nothing here writes a target until the
 * capture — on which the published profile takes all three axes back.
 */
export function stepRejoin(ac: Aircraft, dt: Sec): StarEvent[] {
  const rejoin = ac.rejoin;
  if (!rejoin || rejoin.leg === null) return [];
  const { nav, leg } = rejoin;
  const fix = nav.route.waypoints[leg]!;
  const geo = legGeometry(nav.route, leg, ac);

  // The vertical and the speed are the route's from the moment `R` is read
  // back, so the aircraft arrives at the leg already on the profile and the
  // capture is lateral only. Only the lateral track is still the controller's.
  flyProfile(ac, nav, rejoinDistanceToGoNm(nav, leg, ac), dt);

  // The leg's own end fix is the range limit — no localizer service volume to
  // borrow, and nothing is left to intercept once it is behind.
  if (geo.alongNm > geo.lengthNm) {
    rejoin.leg = null;
    return [{ kind: 'rejoinMissed', fix: fix.name, reason: `past ${fix.name}` }];
  }
  if (Math.abs(geo.xtkNm) >= STAR_REJOIN_XTK_NM || !geo.closing) return [];

  // Checked again here even though `resumeArrival` refused a steep crossing at
  // the press: that was a prediction off the assigned heading, and an aircraft
  // still rolling out of a large turn can reach a nearby leg before it is true.
  // No speed gate — `MAX_INTERCEPT_SPEED_KTS` exists for the localizer roll-out
  // against threshold geometry, and every outer STAR leg is published at 250 kt.
  if (geo.interceptAngleDeg > MAX_REJOIN_ANGLE_DEG) {
    rejoin.leg = null;
    return [
      {
        kind: 'rejoinMissed',
        fix: fix.name,
        reason:
          `intercept angle ${Math.round(geo.interceptAngleDeg)}° ` +
          `exceeds ${MAX_REJOIN_ANGLE_DEG}°`,
      },
    ];
  }

  // `rejoining` is already being maintained by `flyProfile` above, against the
  // same fix — so the profile does not restart at the capture, it continues.
  nav.index = leg;
  ac.star = nav;
  ac.rejoin = null;
  return [{ kind: 'rejoinEstablished', fix: fix.name, route: nav.route.name }];
}

/** Drive one tick of route following. Kinematics run after, except the vertical. */
export function stepStar(ac: Aircraft, dt: Sec, timeS: Sec = 0): StarEvent[] {
  const nav = ac.star;
  if (!nav) {
    if (ac.rejoin?.leg == null) return [];
    const events = stepRejoin(ac, dt);
    // Captured on this tick: fall through so the profile owns all three axes
    // now rather than after a tick of nothing, as a hold ending does below.
    return ac.star ? [...events, ...stepStar(ac, dt, timeS)] : events;
  }

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

  flyProfile(ac, nav, rangeNm + fix.dtgNm, dt);
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
