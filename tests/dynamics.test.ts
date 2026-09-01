import { describe, expect, it } from 'vitest';
import {
  planRates,
  stepKinematics,
  turnRadiusNm,
  turnRateDegPerSec,
} from '../src/sim/dynamics.js';
import {
  MAX_INTERCEPT_SPEED_KTS,
  PHYSICS_DT,
  SEP_VERT_FT,
} from '../src/sim/constants.js';
import { trueAirspeed } from '../src/sim/units.js';
import { analyzeSeparation } from '../src/sim/separation.js';
import { makeAircraft, quietWorld, run, RUNWAY } from './helpers.js';

describe('turn performance', () => {
  it('is bank-limited at high speed and standard-rate-limited at low speed', () => {
    // ω = 1091·tan(25°)/TAS, capped at 3°/s.
    expect(turnRateDegPerSec(290)).toBeCloseTo(1.75, 2);
    expect(turnRateDegPerSec(250)).toBeCloseTo(2.03, 2);
    expect(turnRateDegPerSec(180)).toBeCloseTo(2.83, 2);
    // Below ~170 kt the 25° bank would exceed standard rate, so the cap binds.
    expect(turnRateDegPerSec(160)).toBe(3.0);
    expect(turnRateDegPerSec(120)).toBe(3.0);
  });

  it('gives the documented turn radii', () => {
    expect(turnRadiusNm(290)).toBeCloseTo(2.6, 1);
    expect(turnRadiusNm(250)).toBeCloseTo(1.95, 1);
    expect(turnRadiusNm(180)).toBeCloseTo(1.0, 1);
  });

  it('turns the short way across north', () => {
    const ac = makeAircraft({ headingDeg: 350, iasKts: 200, altitudeFt: 5000 });
    ac.targetHeadingDeg = 10;
    for (let i = 0; i < 200; i += 1) stepKinematics(ac, PHYSICS_DT);
    expect(ac.headingDeg).toBeCloseTo(10, 1);
  });
});

describe('true airspeed', () => {
  it('matches the 2% per 1000 ft rule of thumb', () => {
    // 250 KIAS at 9000 ft ≈ 290 kt.
    expect(trueAirspeed(250, 9000)).toBeCloseTo(295, 0);
    expect(trueAirspeed(250, 0)).toBe(250);
  });
});

describe('energy budget', () => {
  const medium = { descentFpm: 1800, climbFpm: 1800, budgetScale: 1 };

  it('gives the full deceleration rate in level flight', () => {
    const plan = planRates({ tasKts: 250, altErrorFt: 0, speedErrorKts: -30, ...medium });
    expect(plan.coupled).toBe(true);
    expect(plan.speedRateKtsS).toBeCloseTo(-1.0, 2); // clamped by the airframe limit
    expect(plan.vsFpm).toBe(0);
  });

  it('starves deceleration while descending', () => {
    const plan = planRates({ tasKts: 250, altErrorFt: -2000, speedErrorKts: -30, ...medium });
    expect(plan.vsFpm).toBeCloseTo(-1800, 0);
    // 2500 fpm budget − 1800 fpm of descent = 700 fpm left ≈ 0.53 kt/s.
    expect(plan.speedRateKtsS).toBeCloseTo(-0.53, 2);
  });

  it('does not couple a descent with an acceleration', () => {
    const plan = planRates({ tasKts: 250, altErrorFt: -2000, speedErrorKts: 20, ...medium });
    expect(plan.coupled).toBe(false);
    expect(plan.vsFpm).toBeCloseTo(-1800, 0);
    expect(plan.speedRateKtsS).toBeCloseTo(0.8, 2);
  });

  it('charges the glideslope descent against the budget', () => {
    const level = planRates({ tasKts: 160, altErrorFt: 0, speedErrorKts: -20, ...medium });
    const onGs = planRates({
      tasKts: 160,
      altErrorFt: 0,
      speedErrorKts: -20,
      imposedVsFpm: -740,
      ...medium,
    });
    expect(Math.abs(onGs.speedRateKtsS)).toBeLessThanOrEqual(Math.abs(level.speedRateKtsS));
  });

  it('never freezes the speed, even when the vertical demand eats the budget', () => {
    const plan = planRates({
      tasKts: 250,
      altErrorFt: -5000,
      speedErrorKts: -40,
      descentFpm: 4000, // beyond the dissipation budget
      climbFpm: 1800,
      budgetScale: 1,
    });
    expect(Math.abs(plan.speedRateKtsS)).toBeGreaterThanOrEqual(0.3);
    expect(Math.abs(plan.vsFpm)).toBeLessThan(4000); // the descent gave way
  });

  it('makes descending-and-slowing take much longer than slowing alone', () => {
    const timeToSlow = (descend: boolean): number => {
      const ac = makeAircraft({ altitudeFt: 8000, iasKts: 250, headingDeg: 180 });
      ac.targetIasKts = 220;
      ac.targetAltitudeFt = descend ? 6000 : 8000;
      let elapsed = 0;
      while (ac.iasKts > 220.5 && elapsed < 600) {
        stepKinematics(ac, PHYSICS_DT);
        elapsed += PHYSICS_DT;
      }
      return elapsed;
    };

    const level = timeToSlow(false);
    const descending = timeToSlow(true);
    expect(level).toBeGreaterThan(25);
    expect(level).toBeLessThan(35);
    // ~1.6× at a 1600 fpm descent: of the 2500 fpm dissipation budget the
    // descent takes 1600 and the deceleration lives on what is left. The band
    // is what makes the coupling a mechanic rather than a rounding error — if a
    // change to the descent rate or the budget pushes it near 1.0, descending
    // has stopped costing anything and §4.3 no longer holds.
    expect(descending / level).toBeGreaterThan(1.4);
    expect(descending / level).toBeLessThan(2.6);
  });
});

// ── Levelling off exactly (§4.3) ────────────────────────────────────────────

describe('settling on an assignment', () => {
  it('levels exactly at the assigned altitude, from above and from below', () => {
    for (const [from, to] of [
      [10_500, 10_000],
      [9500, 10_000],
      [3000, 7000],
    ]) {
      const ac = makeAircraft({ altitudeFt: from, targetAltitudeFt: to });
      run(quietWorld(ac), 600);
      expect(ac.altitudeFt, `${from} -> ${to}`).toBe(to);
      expect(ac.vsFpm).toBe(0);
    }
  });

  it('stacks two aircraft exactly 1000 ft apart, which is not a violation', () => {
    // The bug this exists for: the rate is zero inside the deadband, so an
    // aircraft used to rest wherever the taper ran out — up to a foot off. One
    // delivered level at 11,000 and one descending to 10,000 ended up 999 ft
    // apart, which §9.1 calls a violation against two legal assignments.
    const low = makeAircraft({ altitudeFt: 10_500, targetAltitudeFt: 10_000 });
    const high = makeAircraft({ altitudeFt: 11_000, targetAltitudeFt: 11_000 });
    run(quietWorld(low, high), 600);

    expect(Math.abs(high.altitudeFt - low.altitudeFt)).toBe(SEP_VERT_FT);
    // Stacked directly on top of each other, which is what a holding stack is:
    // the vertical is the only thing keeping them apart, and 1000 ft exactly is
    // legal (§9.1). The pair is measured once settled — the descent through the
    // gap on the way down is a real conflict and not what this is about.
    expect(analyzeSeparation(RUNWAY, [low, high]).pairs).toHaveLength(0);
  });

  it('settles exactly on the assigned speed', () => {
    for (const [from, to] of [
      [250, 230],
      [210, 230],
      [250, 180],
    ]) {
      const ac = makeAircraft({ iasKts: from, targetIasKts: to });
      run(quietWorld(ac), 600);
      expect(ac.iasKts, `${from} -> ${to}`).toBe(to);
    }
  });

  it('keeps an aircraft assigned the intercept ceiling inside it', () => {
    // Half a knot of residual on an aircraft assigned exactly 230 used to fail
    // the §6.1a speed test and throw away the clearance.
    const ac = makeAircraft({ iasKts: 250, targetIasKts: MAX_INTERCEPT_SPEED_KTS });
    run(quietWorld(ac), 600);
    expect(ac.iasKts).toBeLessThanOrEqual(MAX_INTERCEPT_SPEED_KTS);
  });
});
