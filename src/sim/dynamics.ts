/**
 * Flight dynamics: nothing snaps, everything moves toward its target at a
 * bounded rate. The interesting part is `planRates`, which makes descending and
 * decelerating compete for one energy budget (docs §4.3).
 */
import {
  ALT_CAPTURE_FT,
  ALT_CAPTURE_MIN_FRACTION,
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
import type { Aircraft } from './aircraft.js';
import {
  clamp,
  headingDelta,
  headingVector,
  normalizeHeading,
  trueAirspeed,
  type Deg,
  type Fpm,
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
  } else if (Math.abs(altErrorFt) > 1) {
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
    const budgetFpm = (dissipating ? ENERGY_BUDGET_FPM : THRUST_BUDGET_FPM) * budgetScale;
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
 * Advance heading, altitude, speed and position by `dt`.
 * Pure kinematics — approach logic lives in ils.ts and sets the targets.
 */
export function stepKinematics(ac: Aircraft, dt: Sec, controlVertical = true): void {
  const tasKts = trueAirspeed(ac.iasKts, ac.altitudeFt);

  // Heading: turn the short way.
  const delta = headingDelta(ac.headingDeg, ac.targetHeadingDeg);
  if (Math.abs(delta) > 0.01) {
    const step = Math.min(Math.abs(delta), turnRateDegPerSec(tasKts) * dt);
    ac.headingDeg = normalizeHeading(ac.headingDeg + Math.sign(delta) * step);
  }

  // Altitude and speed: share one energy budget.
  const plan = planRates({
    tasKts,
    altErrorFt: ac.targetAltitudeFt - ac.altitudeFt,
    speedErrorKts: ac.targetIasKts - ac.iasKts,
    descentFpm: ac.type.descentFpm,
    climbFpm: ac.type.climbFpm,
    budgetScale: ac.type.budgetScale,
    // On the glideslope the vertical profile comes from the geometry, but its
    // energy still has to be paid for.
    imposedVsFpm: controlVertical ? null : ac.vsFpm,
  });

  if (controlVertical) ac.vsFpm = plan.vsFpm;
  if (controlVertical && plan.vsFpm !== 0) {
    const next = ac.altitudeFt + (plan.vsFpm * dt) / 60;
    // Do not overshoot the assigned altitude.
    ac.altitudeFt =
      plan.vsFpm > 0
        ? Math.min(next, ac.targetAltitudeFt)
        : Math.max(next, ac.targetAltitudeFt);
  }
  if (plan.speedRateKtsS !== 0) {
    const next = ac.iasKts + plan.speedRateKtsS * dt;
    ac.iasKts =
      plan.speedRateKtsS > 0 ? Math.min(next, ac.targetIasKts) : Math.max(next, ac.targetIasKts);
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
