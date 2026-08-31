/**
 * Flight dynamics: nothing snaps, everything moves toward its target at a
 * bounded rate. The interesting part is `planRates`, which makes descending and
 * decelerating compete for one energy budget (docs §4.3).
 */
import { AIRPORT } from '../scenario/airport.js';
import {
  ALT_CAPTURE_FT,
  ALT_CAPTURE_MIN_FRACTION,
  ALT_SETTLE_FT,
  DEPARTURE_ACCEL_ALT_FT,
  DEPARTURE_THRUST_BUDGET_FPM,
  INITIAL_CLIMB_REDUCTION_FPM,
  ENERGY_BUDGET_FPM,
  MAX_ACCEL_KTS_S,
  MAX_DECEL_KTS_S,
  MAX_TURN_RATE_DEG_S,
  MIN_SPEED_RATE_KTS_S,
  SPEED_CAPTURE_KTS,
  THRUST_BUDGET_FPM,
  TURN_COEFF,
  energyFtPerKnot,
} from './constants.js';
import { isDeparture, type Aircraft } from './aircraft.js';
import {
  bearing,
  clamp,
  headingDelta,
  headingDiff,
  headingVector,
  normalizeHeading,
  toRad,
  trueAirspeed,
  type Deg,
  type Fpm,
  type Nm,
  type Point,
  type Sec,
} from './units.js';

/**
 * Rate of turn at 25° of bank, capped at standard rate.
 * ω = 1091·tan(bank)/TAS → 1.75°/s at 290 kt, 2.83°/s at 180 kt.
 */
export function turnRateDegPerSec(tasKts: number): Deg {
  return Math.min(MAX_TURN_RATE_DEG_S, TURN_COEFF / tasKts);
}

/** Radius of a 25°-bank turn, NM. ~2.6 NM at 290 kt, ~1.0 NM at 180 kt. */
export function turnRadiusNm(tasKts: number): number {
  const rate = turnRateDegPerSec(tasKts);
  return (tasKts / 3600) / (rate * (Math.PI / 180));
}

/**
 * How far before a fix to start the turn onto the next leg, so the track is
 * flown as a fly-by rather than an overshoot and a correction back.
 * `d = R·tan(θ/2)` is the tangent distance of the turn arc.
 *
 * Shared by the STARs and the SIDs; they differ only in the bounds they clamp it
 * to, which are their own published tolerances.
 */
export function routeAnticipationNm(
  waypoints: readonly { position: Point }[],
  index: number,
  tasKts: number,
  minNm: Nm,
  maxNm: Nm,
): Nm {
  const inbound = bearing(waypoints[index - 1]!.position, waypoints[index]!.position);
  const outbound = bearing(waypoints[index]!.position, waypoints[index + 1]!.position);
  const turnDeg = Math.abs(headingDelta(inbound, outbound));
  return clamp(turnRadiusNm(tasKts) * Math.tan(toRad(turnDeg / 2)), minNm, maxNm);
}

/**
 * True once a fix has been reached or left behind — the sequencing test every
 * route follower uses.
 *
 * The abeam half is a backstop rather than the normal case: pure pursuit only
 * leaves a fix behind unreached if an earlier tight turn threw the aircraft off
 * the leg. Shared by the STARs, the SIDs and the holding patterns, which differ
 * only in the capture radius they pass.
 */
export function fixPassed(
  rangeNm: Nm,
  headingDeg: Deg,
  courseDeg: Deg,
  captureNm: Nm,
): boolean {
  return rangeNm < captureNm || headingDiff(headingDeg, courseDeg) > 90;
}

export interface RatePlanInput {
  tasKts: number;
  /** target − current. Positive means climb wanted. */
  altErrorFt: number;
  /** target − current. Negative means deceleration wanted. */
  speedErrorKts: number;
  descentFpm: Fpm;
  climbFpm: Fpm;
  budgetScale: number;
  /**
   * Energy available for climbing *and* accelerating, before `budgetScale`.
   * Defaults to the arrival-stream figure; a departure at take-off thrust has
   * far more of it (§4.7), which is what lets it accelerate to 250 kt without
   * giving up the climb it needs to make the 13,000 ft exit crossing.
   */
  thrustBudgetFpm?: Fpm;
  /**
   * Vertical rate imposed from outside (following the glideslope). Its energy
   * cost is still charged against the budget, so an aircraft descending on the
   * G/S decelerates more slowly than one in level flight.
   */
  imposedVsFpm?: number | null;
}

export interface RatePlan {
  vsFpm: Fpm;
  /** Signed: negative while decelerating. */
  speedRateKtsS: number;
  /** True when altitude and speed had to share one budget. */
  coupled: boolean;
}

/**
 * Split the available energy between the vertical rate and the speed change.
 *
 * A jet at idle dissipates energy at a roughly fixed rate and does not care
 * whether it leaves as altitude or as speed, so descending and slowing compete.
 * Climbing and accelerating compete for thrust in the same way. Descending
 * while accelerating (or climbing while slowing) trades one for the other and
 * is not limited here.
 */
export function planRates(input: RatePlanInput): RatePlan {
  const { tasKts, altErrorFt, speedErrorKts, descentFpm, climbFpm, budgetScale } = input;

  const wantsClimb = altErrorFt > 0;
  const nominalFpm = wantsClimb ? climbFpm : descentFpm;

  let vsDemandFpm = 0;
  if (input.imposedVsFpm != null) {
    vsDemandFpm = input.imposedVsFpm;
  } else if (Math.abs(altErrorFt) > ALT_SETTLE_FT) {
    // Taper the rate close to the target so 1 Hz sampling cannot overshoot visibly.
    const taper = clamp(Math.abs(altErrorFt) / ALT_CAPTURE_FT, ALT_CAPTURE_MIN_FRACTION, 1);
    vsDemandFpm = Math.sign(altErrorFt) * nominalFpm * taper;
  }

  const wantsDecel = speedErrorKts < -SPEED_CAPTURE_KTS;
  const wantsAccel = speedErrorKts > SPEED_CAPTURE_KTS;
  let speedDemandKtsS = 0;
  if (wantsDecel) speedDemandKtsS = MAX_DECEL_KTS_S;
  else if (wantsAccel) speedDemandKtsS = MAX_ACCEL_KTS_S;

  // Do the two demands draw on the same budget?
  const dissipating = wantsDecel && vsDemandFpm <= 0;
  const adding = wantsAccel && vsDemandFpm >= 0;
  const coupled = dissipating || adding;

  let vsFpm = vsDemandFpm;
  let speedMagnitude = speedDemandKtsS;

  if (coupled) {
    const thrustFpm = input.thrustBudgetFpm ?? THRUST_BUDGET_FPM;
    const budgetFpm = (dissipating ? ENERGY_BUDGET_FPM : thrustFpm) * budgetScale;
    const ftPerKnot = energyFtPerKnot(tasKts);

    // Altitude has priority; speed gets what is left over.
    const vsUsed = Math.min(Math.abs(vsDemandFpm), budgetFpm);
    let remainingFpm = Math.max(0, budgetFpm - vsUsed);
    let available = remainingFpm / 60 / ftPerKnot;

    if (speedDemandKtsS > 0 && available < MIN_SPEED_RATE_KTS_S) {
      // Never let an aircraft look frozen at the wrong speed: buy the floor
      // rate back out of the vertical rate.
      available = MIN_SPEED_RATE_KTS_S;
      const neededFpm = available * ftPerKnot * 60;
      const vsAllowed = Math.max(0, budgetFpm - neededFpm);
      vsFpm = Math.sign(vsDemandFpm) * Math.min(Math.abs(vsDemandFpm), vsAllowed);
    } else {
      vsFpm = Math.sign(vsDemandFpm) * vsUsed;
    }

    speedMagnitude = Math.min(speedDemandKtsS, available);
  }

  return {
    vsFpm,
    speedRateKtsS: Math.sign(speedErrorKts) * speedMagnitude,
    coupled,
  };
}

/**
 * Rate of climb available to a departure right now (§4.7).
 *
 * The type's published figure is the *clean* rate. Below the acceleration
 * altitude the flaps are still out, and the drag costs it 500 fpm — so a
 * departure climbs away noticeably less steeply for the first 3000 ft than it
 * does once cleaned up, which is what the initial climb actually looks like.
 */
export function departureClimbRateFpm(ac: Aircraft): Fpm {
  const aglFt = ac.altitudeFt - AIRPORT.elevationFt;
  if (aglFt >= DEPARTURE_ACCEL_ALT_FT) return ac.type.departureClimbFpm;
  return Math.max(0, ac.type.departureClimbFpm - INITIAL_CLIMB_REDUCTION_FPM);
}

/**
 * Advance heading, altitude, speed and position by `dt`.
 * Pure kinematics — approach logic lives in ils.ts and sets the targets.
 */
export function stepKinematics(ac: Aircraft, dt: Sec, controlVertical = true): void {
  const tasKts = trueAirspeed(ac.iasKts, ac.altitudeFt);
  // A departure is at take-off/climb thrust and climbs on its own performance
  // figures, not on the gentler rate an arrival uses for a level change (§4.7).
  const departing = isDeparture(ac);

  // Heading: turn the short way, unless a direction has been forced — a 180°
  // reversal has no short way, so the holding pattern states its own (§4.6).
  const delta = headingDelta(ac.headingDeg, ac.targetHeadingDeg);
  if (Math.abs(delta) > 0.01) {
    const direction = ac.turnDirection ?? (Math.sign(delta) as -1 | 1);
    // Going the forced way round means the remaining turn is the reflex angle,
    // not the shortest one, or the turn would stop 180° early.
    const remaining = direction === Math.sign(delta) ? Math.abs(delta) : 360 - Math.abs(delta);
    const step = Math.min(remaining, turnRateDegPerSec(tasKts) * dt);
    ac.headingDeg = normalizeHeading(ac.headingDeg + direction * step);
  }

  // Altitude and speed: share one energy budget.
  const plan = planRates({
    tasKts,
    altErrorFt: ac.targetAltitudeFt - ac.altitudeFt,
    speedErrorKts: ac.targetIasKts - ac.iasKts,
    descentFpm: ac.type.descentFpm,
    climbFpm: departing ? departureClimbRateFpm(ac) : ac.type.climbFpm,
    budgetScale: ac.type.budgetScale,
    thrustBudgetFpm: departing ? DEPARTURE_THRUST_BUDGET_FPM : THRUST_BUDGET_FPM,
    // On the glideslope the vertical profile comes from the geometry, but its
    // energy still has to be paid for.
    imposedVsFpm: controlVertical ? null : ac.vsFpm,
  });

  if (controlVertical) {
    ac.vsFpm = plan.vsFpm;
    if (plan.vsFpm !== 0) {
      const next = ac.altitudeFt + (plan.vsFpm * dt) / 60;
      // Do not overshoot the assigned altitude.
      ac.altitudeFt =
        plan.vsFpm > 0
          ? Math.min(next, ac.targetAltitudeFt)
          : Math.max(next, ac.targetAltitudeFt);
    } else if (Math.abs(ac.targetAltitudeFt - ac.altitudeFt) <= ALT_SETTLE_FT) {
      // Inside the deadband the rate is zero, so without this the aircraft
      // would rest wherever the taper ran out — and "level at 10,000" a foot
      // high is 999 ft from the aircraft stacked above it, which §9.1 calls a
      // violation. Level means level.
      ac.altitudeFt = ac.targetAltitudeFt;
    }
  }
  if (plan.speedRateKtsS !== 0) {
    const next = ac.iasKts + plan.speedRateKtsS * dt;
    ac.iasKts =
      plan.speedRateKtsS > 0 ? Math.min(next, ac.targetIasKts) : Math.max(next, ac.targetIasKts);
  } else if (Math.abs(ac.targetIasKts - ac.iasKts) <= SPEED_CAPTURE_KTS) {
    // Same again on the speed, and it bites harder: half a knot of residual on
    // an aircraft assigned exactly 230 fails the intercept ceiling of §6.1a.
    ac.iasKts = ac.targetIasKts;
  }

  // Position. No wind, so heading = track and TAS = ground speed.
  const distNm = (tasKts / 3600) * dt;
  const dir = headingVector(ac.headingDeg);
  ac.x += dir.x * distNm;
  ac.y += dir.y * distNm;
  ac.trackMilesFlown += distNm;
}

/** Ground speed. With no wind this is simply TAS — kept as a seam for adding wind later. */
export function groundSpeed(ac: Aircraft): number {
  return trueAirspeed(ac.iasKts, ac.altitudeFt);
}
