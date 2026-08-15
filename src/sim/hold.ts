/**
 * Holding patterns (docs §4.6).
 *
 * A standard hold is a racetrack anchored on a fix: right turns, one-minute
 * legs, 230 kt below 14,000 ft. The real thing has three published entry
 * procedures (direct, parallel, teardrop) chosen from the angle the aircraft
 * arrives at; all of that exists to get an aircraft onto the inbound leg from
 * an arbitrary direction without leaving protected airspace. Here the aircraft
 * is always arriving along its own STAR leg, so the entry is always a direct
 * one and the geometry reduces to a loop flown from the fix:
 *
 *     inbound  ──────────────▶ FIX ─┐  outbound turn, 180° right
 *                                   │
 *     ◀───────── 1 min ─────────────┘
 *
 * i.e. cross the fix, turn right through 180°, fly a minute, turn right through
 * 180° again, and track back to the fix. The pattern is held indefinitely until
 * the controller takes it out.
 *
 * The aircraft never leaves its STAR while holding — `ac.star` stays set and
 * `nav.index` keeps pointing at the holding fix — so exiting is just a matter
 * of dropping the hold state and letting `stepStar` resume from that fix.
 */
import type { Aircraft } from './aircraft.js';
import { HOLD_LEG_S, HOLD_SPEED_KTS, STAR_FIX_CAPTURE_NM } from './constants.js';
import { starProfileAt } from '../scenario/stars.js';
import { activeFix, distanceToGoNm, type StarNav } from './star.js';
import { bearing, distance, headingDiff, normalizeHeading, type Deg, type Sec } from './units.js';

/**
 * Where in the racetrack the aircraft is.
 *
 * `inbound` covers both the run from wherever H was pressed to the fix for the
 * first time and every subsequent inbound leg, which is why the loop counter
 * matters more than the leg name: `exitRequested` set during `inbound` on the
 * first pass means "never mind", and the same flag on a later pass means
 * "complete this one and leave".
 */
export type HoldLeg = 'inbound' | 'outbound' | 'return';

export interface HoldNav {
  /** Fix the pattern is anchored on — always the STAR waypoint at `nav.index`. */
  fix: string;
  leg: HoldLeg;
  /**
   * Altitude the pattern is flown at. Frozen at the fix's published altitude on
   * entry (§4.6): the STAR's descent profile is keyed to distance-to-go, which
   * stops decreasing once the aircraft is going round in circles.
   */
  altitudeFt: number;
  /** Heading being flown on the outbound leg — the reciprocal of the inbound. */
  outboundHeadingDeg: Deg;
  /** Sim time the outbound leg ends; only meaningful while `leg` is `outbound`. */
  legEndsAtS: Sec;
  /**
   * True while a commanded turn must be flown to the right regardless of which
   * way round is shorter. Both turns in the pattern are exact 180° reversals,
   * and "turn the short way" has no answer for a reversal: the sign of the
   * error is decided by floating-point noise, so the aircraft would turn left
   * out of the hold about half the time. A standard hold is right-hand by
   * definition (§4.6), so the direction is stated rather than derived.
   */
  turningRight: boolean;
  /**
   * Whether the controller already owned the altitude when the hold began.
   *
   * An altitude assigned *inside* the pattern is a holding level — "descend to
   * 7000 in the hold" — not a permanent takeover of the vertical, so it must
   * not outlive the hold. Without this, stacking an aircraft in the pattern
   * silently cancels the published profile and it flies the rest of the arrival
   * level at whatever the last holding level was (§4.6).
   */
  altitudeWasManual: boolean;
  /** True once the aircraft has crossed the fix at least once. */
  established: boolean;
  /** H pressed a second time: leave at the next crossing of the fix. */
  exitRequested: boolean;
}

export type HoldEvent =
  | { kind: 'holdEntered'; fix: string }
  | { kind: 'holdExited'; fix: string };

export function isHolding(ac: Aircraft): boolean {
  return ac.star?.hold != null;
}

/**
 * Begin the hold. The aircraft carries on to the fix it is already tracking and
 * slows to 230 kt on the way, so nothing about the lateral track changes until
 * it gets there — the pattern only starts at the fix.
 */
export function enterHold(ac: Aircraft, nav: StarNav): HoldNav {
  const fix = activeFix(nav);
  const hold: HoldNav = {
    fix: fix.name,
    leg: 'inbound',
    // The published altitude for the holding fix, which is what the aircraft
    // was descending towards anyway; if the controller has already taken the
    // altitude over, that assignment stands.
    altitudeFt: nav.altitudeManual ? ac.targetAltitudeFt : (fix.altitudeFt ?? ac.targetAltitudeFt),
    outboundHeadingDeg: ac.headingDeg,
    legEndsAtS: 0,
    turningRight: false,
    altitudeWasManual: nav.altitudeManual,
    established: false,
    exitRequested: false,
  };
  nav.hold = hold;
  // The hold owns both of these from now on, so the published profile does not
  // fight them on the way in.
  ac.targetAltitudeFt = hold.altitudeFt;
  ac.targetIasKts = HOLD_SPEED_KTS;
  return hold;
}

/**
 * Take the aircraft out of the pattern. Before it has ever reached the fix this
 * cancels outright; afterwards it flags the exit and the loop finishes first.
 * Returns true if the hold ended immediately.
 */
export function requestHoldExit(ac: Aircraft, hold: HoldNav): boolean {
  if (!hold.established) {
    leaveHold(ac);
    return true;
  }
  hold.exitRequested = true;
  return false;
}

/** Drop the hold and hand the aircraft back to its STAR at the holding fix. */
export function leaveHold(ac: Aircraft): void {
  const nav = ac.star;
  const hold = nav?.hold;
  if (nav && hold) {
    nav.hold = null;
    // A holding level is part of the pattern, not a standing altitude
    // assignment: unless the controller had already taken the vertical over
    // before the hold, the published profile gets it back (§4.6).
    nav.altitudeManual = hold.altitudeWasManual;
    // Stacked above the profile, the aircraft has to descend back down to it
    // rather than be written onto it. Cleared by `stepStar` on capture.
    if (!nav.altitudeManual) {
      const profileFt = starProfileAt(nav.route, distanceToGoNm(ac, nav)).altitudeFt;
      nav.rejoining = ac.altitudeFt > profileFt;
    }
  }
  // The forced right turn belongs to the pattern; anything else turns the short
  // way, including the vector that may have just taken it out of the hold.
  ac.turnDirection = null;
}

/**
 * Drive one tick of the racetrack, replacing `stepStar`'s lateral tracking.
 * Returns true while the hold still owns the aircraft; false on the tick it
 * ends, on which the caller lets the STAR take over again.
 *
 * The vertical is level by definition here, so — unlike the STAR profile and
 * the glideslope — this writes only targets and lets kinematics fly them.
 */
export function stepHold(ac: Aircraft, nav: StarNav, timeS: Sec): HoldEvent[] {
  const hold = nav.hold;
  if (!hold) return [];

  const fix = activeFix(nav);
  const position = { x: ac.x, y: ac.y };
  const rangeNm = distance(position, fix.position);
  const courseDeg = bearing(position, fix.position);

  // The controller may move the aircraft up or down in the pattern (§4.6), so
  // the hold only claims the altitude when it has not been reassigned.
  if (!nav.altitudeManual) ac.targetAltitudeFt = hold.altitudeFt;
  if (!nav.speedManual) ac.targetIasKts = HOLD_SPEED_KTS;

  switch (hold.leg) {
    case 'inbound': {
      ac.targetHeadingDeg = courseDeg;
      // Same capture test the STAR sequencing uses, minus the fly-by
      // anticipation: a hold is flown over the fix, not cut short of it.
      const reached = rangeNm < STAR_FIX_CAPTURE_NM || headingDiff(ac.headingDeg, courseDeg) > 90;
      if (!reached) return [];

      if (hold.exitRequested) {
        leaveHold(ac);
        return [{ kind: 'holdExited', fix: hold.fix }];
      }

      // Over the fix: turn outbound. The outbound leg is the reciprocal of the
      // track flown in, so the pattern aligns itself with however the aircraft
      // arrived rather than needing a published inbound course.
      const entered = !hold.established;
      hold.established = true;
      hold.leg = 'outbound';
      hold.outboundHeadingDeg = normalizeHeading(ac.headingDeg + 180);
      ac.targetHeadingDeg = hold.outboundHeadingDeg;
      // Standard hold: this reversal is flown to the right, not whichever way
      // the rounding of an exact 180° happens to fall.
      hold.turningRight = true;
      ac.turnDirection = 1;
      // The minute is timed from the roll-out, not from the fix, so the leg is
      // a minute of straight flight — the turn itself is not part of it.
      hold.legEndsAtS = 0;
      return entered ? [{ kind: 'holdEntered', fix: hold.fix }] : [];
    }

    case 'outbound': {
      ac.targetHeadingDeg = hold.outboundHeadingDeg;
      // Start the clock once the turn is finished.
      if (hold.legEndsAtS === 0) {
        if (headingDiff(ac.headingDeg, hold.outboundHeadingDeg) > 5) return [];
        // Rolled out: release the forced turn so the leg can be held straight.
        hold.turningRight = false;
        ac.turnDirection = null;
        hold.legEndsAtS = timeS + HOLD_LEG_S;
        return [];
      }
      if (timeS >= hold.legEndsAtS) {
        hold.leg = 'return';
        ac.targetHeadingDeg = normalizeHeading(hold.outboundHeadingDeg + 180);
        hold.turningRight = true;
        ac.turnDirection = 1;
      }
      return [];
    }

    case 'return': {
      // Turn back through 180° and then chase the fix. Steering straight at it
      // during the turn would cut the corner and shrink the pattern; the turn
      // is flown first, and the inbound leg picks up the tracking.
      const reciprocal = normalizeHeading(hold.outboundHeadingDeg + 180);
      if (headingDiff(ac.headingDeg, reciprocal) > 5) {
        ac.targetHeadingDeg = reciprocal;
        return [];
      }
      // Rolled out onto the inbound: tracking to the fix takes over, and it
      // corrects whichever way is shorter like any other pursuit.
      hold.turningRight = false;
      ac.turnDirection = null;
      hold.leg = 'inbound';
      ac.targetHeadingDeg = courseDeg;
      return [];
    }
  }
}
