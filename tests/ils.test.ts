import { describe, expect, it } from 'vitest';
import type { Aircraft } from '../src/sim/aircraft.js';
import { adjustHeading, adjustSpeed, clearForIls } from '../src/sim/commands.js';
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
import { makeAircraft, onFinalApproach, pilotActs, quietWorld } from './helpers.js';

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
  it('follows a 3° path — the 300 ft per NM rule of thumb', () => {
    expect(glideslopeAltitudeFt(1)).toBeCloseTo(318, 0);
    expect(glideslopeAltitudeFt(2)).toBeCloseTo(637, 0);
    // The cone is ~11 NM long, so the G/S there is ~3500 ft.
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

  it('clears an aircraft still perpendicular to the localizer', () => {
    // The whole point of §6.1a: the clearance is a prediction about the
    // intercept, so it may be given before the turn has even been flown.
    const ac = goodSetup();
    ac.headingDeg = 270;
    expect(evaluateClearance(ac, finalGeometry(ac)).ok).toBe(true);
  });

  it('clears an aircraft still descending to the intercept altitude', () => {
    const ac = goodSetup();
    ac.vsFpm = -1200;
    expect(evaluateClearance(ac, finalGeometry(ac)).ok).toBe(true);
  });

  it('clears an aircraft above the glideslope, warning by how much', () => {
    const ac = goodSetup();
    ac.altitudeFt = 5000; // G/S at 12 NM is ~3821 ft
    const result = evaluateClearance(ac, finalGeometry(ac));
    expect(result.ok).toBe(true);
    expect(result.warnings.join(' ')).toContain('1179 ft above the glideslope');
  });

  it('refuses beyond localizer range', () => {
    const position = onFinalApproach(30, 2);
    const ac = makeAircraft({ ...position, altitudeFt: 8000, headingDeg: 210, vsFpm: 0 });
    const result = evaluateClearance(ac, finalGeometry(ac));
    expect(result.ok).toBe(false);
    expect(result.code).toBe('outOfRange');
  });

  it('refuses an aircraft that is not closing on the localizer', () => {
    // Not a prediction that has yet to come true — this track never reaches
    // the window at all.
    const position = onFinalApproach(12, 3);
    const ac = makeAircraft({ ...position, altitudeFt: 3000, headingDeg: 150, vsFpm: 0 });
    const result = evaluateClearance(ac, finalGeometry(ac));
    expect(result.ok).toBe(false);
    expect(result.code).toBe('notClosing');
  });
});

describe('the intercept window', () => {
  /** Fly until the clearance is resolved one way or the other. */
  function runToIntercept(ac: Aircraft) {
    const world = quietWorld(ac);
    for (let i = 0; i < 20_000 && ac.phase === 'cleared'; i += 1) step(world, PHYSICS_DT);
    return world;
  }

  it('captures the localizer when the aircraft arrives inside the window', () => {
    const ac = goodSetup();
    ac.phase = 'cleared';
    runToIntercept(ac);
    expect(ac.phase).toBe('loc');
  });

  it('warns about a 40° intercept but still captures', () => {
    const ac = goodSetup();
    ac.headingDeg = 220;
    ac.targetHeadingDeg = 220;
    ac.phase = 'cleared';
    const world = runToIntercept(ac);
    expect(ac.phase).toBe('loc');
    expect(world.messages.some((m) => m.text.includes('intercept angle 40°'))).toBe(true);
  });

  it('captures the localizer above the glideslope, but says it cannot capture it', () => {
    // The path falls away inbound, so this one is a 5 NM go-around already.
    // The intercept is the last moment the controller can still be told.
    const position = onFinalApproach(16, 2.5);
    const ac = makeAircraft({
      ...position,
      altitudeFt: 5000, // G/S at the ~13.6 NM capture is ~4335 ft
      headingDeg: 210,
      iasKts: 200,
      vsFpm: 0,
      phase: 'cleared',
    });
    const world = runToIntercept(ac);

    expect(ac.phase).toBe('loc');
    expect(world.messages.some((m) => m.text.includes('above the glideslope'))).toBe(true);
    expect(world.messages.some((m) => m.text.includes('cannot capture from here'))).toBe(true);
  });

  it('flies through the localizer when the angle is still beyond 45°', () => {
    const position = onFinalApproach(12, 3);
    const ac = makeAircraft({
      ...position,
      altitudeFt: 2500,
      headingDeg: 260, // 80° to the course — never turned onto the intercept
      iasKts: 180,
      vsFpm: 0,
      phase: 'cleared',
    });
    const world = runToIntercept(ac);

    expect(ac.phase).toBe('inbound');
    expect(world.stats.missedIntercepts.get('interceptAngle')).toBe(1);
    expect(world.messages.some((m) => m.text.includes('unable to intercept'))).toBe(true);
    expect(world.stats.goArounds).toBe(0); // it flies through, it does not go around
  });

  it('flies through the localizer when it is still descending', () => {
    const position = onFinalApproach(10, 1);
    const ac = makeAircraft({
      ...position,
      altitudeFt: 4000,
      targetAltitudeFt: 2000, // still 1800 fpm down when it reaches the course
      headingDeg: 210,
      iasKts: 180,
      phase: 'cleared',
    });
    const world = runToIntercept(ac);

    expect(ac.phase).toBe('inbound');
    expect(world.stats.missedIntercepts.get('notLevel')).toBe(1);
  });

  it('flies through the localizer above 230 kt', () => {
    const position = onFinalApproach(12, 1.5);
    const ac = makeAircraft({
      ...position,
      altitudeFt: 2500,
      headingDeg: 210,
      iasKts: 250,
      vsFpm: 0,
      phase: 'cleared',
    });
    const world = runToIntercept(ac);

    expect(ac.phase).toBe('inbound');
    expect(world.stats.missedIntercepts.get('tooFast')).toBe(1);
  });

  it('still slows on schedule after a speed given between clearance and intercept', () => {
    // The clearance comes first now, so sequencing speed control routinely
    // follows it. That must not read as "maintain 200 to 5 mile final" and
    // strand the aircraft 60 kt fast over the threshold.
    const ac = makeAircraft({
      ...onFinalApproach(22, 4),
      altitudeFt: 3000,
      headingDeg: 210,
      iasKts: 230,
      vsFpm: 0,
    });
    const world = quietWorld(ac);

    clearForIls(world, ac);
    pilotActs(world);
    for (let i = 0; i < 3; i += 1) adjustSpeed(world, ac, -1); // 230 → 200
    pilotActs(world);
    expect(ac.speedAssignedAfterClearance).toBe(false);

    let landed = false;
    for (let i = 0; i < 60_000 && !landed; i += 1) {
      step(world, PHYSICS_DT);
      if (world.aircraft.length === 0) landed = true;
    }
    expect(landed).toBe(true);
    expect(world.stats.goArounds).toBe(0);
  });

  it('lands an aircraft cleared while perpendicular, then turned onto the intercept', () => {
    // The scenario the mechanic exists for: turn onto a 30° intercept and
    // clear in the same breath, from a downwind heading well off the course.
    const position = onFinalApproach(22, 6);
    const ac = makeAircraft({
      ...position,
      altitudeFt: 3000,
      headingDeg: 270,
      iasKts: 210,
      vsFpm: 0,
    });
    const world = quietWorld(ac);

    for (let i = 0; i < 6; i += 1) adjustHeading(world, ac, -1); // 270 → 210
    clearForIls(world, ac);
    pilotActs(world);
    expect(ac.targetHeadingDeg).toBe(210);
    expect(ac.phase).toBe('cleared');

    let landed = false;
    for (let i = 0; i < 40_000 && !landed; i += 1) {
      step(world, PHYSICS_DT);
      if (world.aircraft.length === 0) landed = true;
    }
    expect(landed).toBe(true);
    expect(world.stats.landings).toBe(1);
    expect(world.stats.missedIntercepts.size).toBe(0);
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

  it('lets 3.5 NM land inside 5 NM rather than sending it around', () => {
    // The 4 NM gap is a sequencing requirement out at 10 NM (§9.3). This close
    // in, squeezing the aircraft achieves nothing, so it is left alone.
    const lead = makeAircraft({
      ...onFinalApproach(1),
      altitudeFt: 318,
      headingDeg: 180,
      iasKts: 140,
      phase: 'gs',
    });
    const follower = makeAircraft({
      ...onFinalApproach(4.5),
      altitudeFt: 1433,
      headingDeg: 180,
      iasKts: 150,
      phase: 'gs',
    });
    follower.id = 2;

    const world = quietWorld(lead, follower);
    step(world, PHYSICS_DT);

    expect(follower.phase).toBe('gs');
    expect(world.stats.goArounds).toBe(0);
  });

  it('still goes around as a backstop below 2.5 NM', () => {
    const lead = makeAircraft({
      ...onFinalApproach(2),
      altitudeFt: 637,
      headingDeg: 180,
      iasKts: 140,
      phase: 'gs',
    });
    const follower = makeAircraft({
      ...onFinalApproach(4),
      altitudeFt: 1274,
      headingDeg: 180,
      iasKts: 150,
      phase: 'gs',
    });
    follower.id = 2;

    const world = quietWorld(lead, follower);
    step(world, PHYSICS_DT);

    expect(follower.phase).toBe('goAround');
    expect(lead.phase).toBe('gs'); // the one ahead is unaffected
    expect(world.messages.some((m) => m.text.includes('insufficient spacing'))).toBe(true);
  });
});
