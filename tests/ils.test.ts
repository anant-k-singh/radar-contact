import { describe, expect, it } from 'vitest';
import { PHYSICS_DT } from '../src/sim/constants.js';
import {
  evaluateClearance,
  finalGeometry,
  glideslopeAltitudeFt,
  isEstablished,
  localizerHeading,
} from '../src/sim/ils.js';
import { step } from '../src/sim/world.js';
import { headingDiff } from '../src/sim/units.js';
import { makeAircraft, onFinalApproach, quietWorld } from './helpers.js';

/**
 * An aircraft correctly set up for a 30° intercept at 12 NM.
 * 2500 ft puts the glideslope intercept at 7.9 NM, comfortably after the
 * localizer capture at ~9.4 NM, so the two captures stay distinct.
 */
function goodSetup() {
  const position = onFinalApproach(12, 2);
  return makeAircraft({
    x: position.x,
    y: position.y,
    altitudeFt: 2500,
    headingDeg: 210,
    iasKts: 180,
    vsFpm: 0,
  });
}

describe('glideslope geometry', () => {
  it('follows a 3° path — the manual’s 300 ft per NM rule of thumb', () => {
    expect(glideslopeAltitudeFt(1)).toBeCloseTo(318, 0);
    expect(glideslopeAltitudeFt(2)).toBeCloseTo(637, 0);
    // IF 6.11.6: the cone is ~11 NM long, so the G/S there is ~3500 ft.
    expect(glideslopeAltitudeFt(11)).toBeCloseTo(3503, 0);
    // The intercept table in the requirements doc.
    expect(3000 / 318.4).toBeCloseTo(9.4, 1);
  });
});

describe('final approach geometry', () => {
  it('measures along-track distance from the threshold', () => {
    const position = onFinalApproach(10);
    const geo = finalGeometry(makeAircraft({ x: position.x, y: position.y, headingDeg: 180 }));
    expect(geo.alongNm).toBeCloseTo(10, 6);
    expect(geo.xtkNm).toBeCloseTo(0, 6);
    expect(geo.interceptAngleDeg).toBeCloseTo(0, 6);
  });

  it('puts traffic east of the centerline on the pilot’s left', () => {
    const position = onFinalApproach(10, 3);
    const geo = finalGeometry(makeAircraft({ x: position.x, y: position.y, headingDeg: 180 }));
    // Landing southbound, east is to the left, so the cross-track is negative.
    expect(geo.xtkNm).toBeCloseTo(-3, 6);
  });

  it('detects whether the track is closing on the localizer', () => {
    const position = onFinalApproach(12, 3);
    const closing = finalGeometry(makeAircraft({ ...position, headingDeg: 210 }));
    const diverging = finalGeometry(makeAircraft({ ...position, headingDeg: 150 }));
    expect(closing.closing).toBe(true);
    expect(diverging.closing).toBe(false);
  });
});

describe('the clearance gate', () => {
  it('accepts a textbook 30° intercept from below the glideslope', () => {
    const ac = goodSetup();
    const result = evaluateClearance(ac, finalGeometry(ac));
    expect(result.ok).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it('refuses an aircraft above the glideslope and says by how much', () => {
    const ac = goodSetup();
    ac.altitudeFt = 5000; // G/S at 12 NM is ~3821 ft
    const result = evaluateClearance(ac, finalGeometry(ac));
    expect(result.ok).toBe(false);
    expect(result.code).toBe('aboveGlideslope');
    expect(result.reason).toContain('above the glideslope');
    expect(result.reason).toContain('1179 ft');
  });

  it('refuses an intercept angle beyond 45°', () => {
    const ac = goodSetup();
    ac.headingDeg = 250;
    const result = evaluateClearance(ac, finalGeometry(ac));
    expect(result.ok).toBe(false);
    expect(result.code).toBe('interceptAngle');
  });

  it('refuses beyond localizer range', () => {
    const position = onFinalApproach(30, 2);
    const ac = makeAircraft({ ...position, altitudeFt: 8000, headingDeg: 210, vsFpm: 0 });
    const result = evaluateClearance(ac, finalGeometry(ac));
    expect(result.ok).toBe(false);
    expect(result.code).toBe('outOfRange');
  });

  it('refuses while still descending to the intercept altitude', () => {
    const ac = goodSetup();
    ac.vsFpm = -1200;
    const result = evaluateClearance(ac, finalGeometry(ac));
    expect(result.ok).toBe(false);
    expect(result.code).toBe('notLevel');
  });

  it('refuses an aircraft that is not closing on the localizer', () => {
    const position = onFinalApproach(12, 3);
    const ac = makeAircraft({ ...position, altitudeFt: 3000, headingDeg: 150, vsFpm: 0 });
    const result = evaluateClearance(ac, finalGeometry(ac));
    expect(result.ok).toBe(false);
    expect(result.code).toBe('notClosing');
  });

  it('accepts a shallow intercept but flags it as poor practice', () => {
    const ac = goodSetup();
    ac.headingDeg = 220; // 40° — legal, but beyond the ideal 30°
    const result = evaluateClearance(ac, finalGeometry(ac));
    expect(result.ok).toBe(true);
    expect(result.warnings.join(' ')).toContain('40°');
  });
});

describe('localizer tracking', () => {
  it('steers back toward the centerline from the right', () => {
    const position = onFinalApproach(8, -0.4); // west of the centerline
    const ac = makeAircraft({ ...position, headingDeg: 180 });
    const geo = finalGeometry(ac);
    expect(geo.xtkNm).toBeGreaterThan(0); // right of course
    // Correcting left of the 180° course.
    expect(localizerHeading(ac, geo)).toBeLessThan(180);
  });
});

describe('a complete approach', () => {
  it('captures the localizer, then the glideslope, hands off and lands', () => {
    const ac = goodSetup();
    ac.phase = 'cleared';
    const world = quietWorld(ac);

    const phases: string[] = [];
    let landed = false;
    for (let i = 0; i < 20_000 && !landed; i += 1) {
      step(world, PHYSICS_DT);
      if (world.aircraft.length === 0) landed = true;
      else if (phases.at(-1) !== ac.phase) phases.push(ac.phase);
    }

    expect(phases).toEqual(['cleared', 'loc', 'gs']);
    expect(landed).toBe(true);
    expect(world.stats.landings).toBe(1);
    expect(world.stats.handoffs).toBe(1);
    expect(world.stats.goArounds).toBe(0);
  });

  it('is established only once aligned with the centerline, not merely nearby', () => {
    const ac = goodSetup();
    ac.phase = 'cleared';
    const world = quietWorld(ac);

    // Step until the localizer is captured.
    for (let i = 0; i < 20_000 && ac.phase === 'cleared'; i += 1) step(world, PHYSICS_DT);
    expect(ac.phase).toBe('loc');
    // At the moment of capture it is still turning, so not yet established.
    expect(headingDiff(ac.headingDeg, 180)).toBeGreaterThan(5);
    expect(isEstablished(ac, finalGeometry(ac))).toBe(false);

    // A little later — the 5° alignment test is the last one to come good.
    for (let i = 0; i < 1200; i += 1) step(world, PHYSICS_DT);
    expect(isEstablished(ac, finalGeometry(ac))).toBe(true);
  });

  it('goes around when the approach is unstable inside 5 NM', () => {
    const position = onFinalApproach(4.5, 0);
    // Aligned on the localizer but far above the glideslope (~1433 ft at 4.5 NM),
    // so the path never passes through its level and it stays high.
    const ac = makeAircraft({
      ...position,
      altitudeFt: 3000,
      headingDeg: 180,
      iasKts: 180,
      phase: 'loc',
    });
    const world = quietWorld(ac);
    step(world, PHYSICS_DT);

    expect(ac.phase).toBe('goAround');
    expect(world.stats.goArounds).toBe(1);
    expect(world.messages.some((m) => m.text.includes('high on the glideslope'))).toBe(true);
  });
});
