import { describe, expect, it } from 'vitest';
import type { Aircraft } from '../src/sim/aircraft.js';
import { adjustHeading, adjustSpeed, clearForIls } from '../src/sim/commands.js';
import { PHYSICS_DT } from '../src/sim/constants.js';
import {
  approachSpeedTargetKts,
  evaluateClearance,
  canCaptureGlideslope,
  isEstablished,
  localizerHeading,
} from '../src/sim/ils.js';
import { step } from '../src/sim/world.js';
import { headingDiff } from '../src/sim/units.js';
import { geo, makeAircraft, onFinal, onGlideslope, pilotActs, quietWorld, RUNWAY, SCENARIO } from './helpers.js';

/**
 * An aircraft correctly set up for a 30° intercept at 12 NM.
 * 2500 ft puts the glideslope intercept at 7.9 NM, comfortably after the
 * localizer capture at ~9.4 NM, so the two captures stay distinct.
 */
function goodSetup() {
  const position = onFinal(12, -2);
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
    expect(onGlideslope(1)).toBeCloseTo(318, 0);
    expect(onGlideslope(2)).toBeCloseTo(637, 0);
    // The cone is ~11 NM long, so the G/S there is ~3500 ft.
    expect(onGlideslope(11)).toBeCloseTo(3503, 0);
    // The intercept table in the requirements doc.
    expect(3000 / 318.4).toBeCloseTo(9.4, 1);
  });
});

describe('final approach geometry', () => {
  it('measures along-track distance from the threshold', () => {
    const position = onFinal(10);
    const g = geo(makeAircraft({ x: position.x, y: position.y, headingDeg: 180 }));
    expect(g.alongNm).toBeCloseTo(10, 6);
    expect(g.xtkNm).toBeCloseTo(0, 6);
    expect(g.interceptAngleDeg).toBeCloseTo(0, 6);
  });

  it('puts traffic east of the centerline on the pilot’s left', () => {
    const position = onFinal(10, -3);
    const g = geo(makeAircraft({ x: position.x, y: position.y, headingDeg: 180 }));
    expect(g.xtkNm).toBeCloseTo(-3, 6);
    // Landing southbound, left of course is east of the field.
    expect(position.x).toBeGreaterThan(0);
  });

  it('detects whether the track is closing on the localizer', () => {
    const position = onFinal(12, -3);
    const closing = geo(makeAircraft({ ...position, headingDeg: 210 }));
    const diverging = geo(makeAircraft({ ...position, headingDeg: 150 }));
    expect(closing.closing).toBe(true);
    expect(diverging.closing).toBe(false);
  });
});

describe('the clearance gate', () => {
  it('accepts a textbook 30° intercept from below the glideslope', () => {
    const ac = goodSetup();
    const result = evaluateClearance(SCENARIO.airspace.mvaFt, ac, geo(ac));
    expect(result.ok).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it('clears an aircraft still perpendicular to the localizer', () => {
    // The whole point of §6.1a: the clearance is a prediction about the
    // intercept, so it may be given before the turn has even been flown.
    const ac = goodSetup();
    ac.headingDeg = 270;
    expect(evaluateClearance(SCENARIO.airspace.mvaFt, ac, geo(ac)).ok).toBe(true);
  });

  it('clears an aircraft still descending to the intercept altitude', () => {
    const ac = goodSetup();
    ac.vsFpm = -1200;
    expect(evaluateClearance(SCENARIO.airspace.mvaFt, ac, geo(ac)).ok).toBe(true);
  });

  it('clears an aircraft above the glideslope, warning by how much', () => {
    const ac = goodSetup();
    ac.altitudeFt = 5000; // G/S at 12 NM is ~3821 ft
    const result = evaluateClearance(SCENARIO.airspace.mvaFt, ac, geo(ac));
    expect(result.ok).toBe(true);
    expect(result.warnings.join(' ')).toContain('1179 ft above the glideslope');
  });

  it('clears an aircraft beyond localizer range', () => {
    // Range is a fact about now, not about the intercept: it is re-tested
    // continuously and only gates the capture itself (§6.1a).
    const position = onFinal(30, -2);
    const ac = makeAircraft({ ...position, altitudeFt: 8000, headingDeg: 210, vsFpm: 0 });
    expect(evaluateClearance(SCENARIO.airspace.mvaFt, ac, geo(ac)).ok).toBe(true);
  });

  it('clears an aircraft that has overshot and is still diverging', () => {
    // The case the split exists for: clear it and turn it back in one go,
    // instead of watching it until the turn has taken effect.
    const position = onFinal(12, -3);
    const ac = makeAircraft({ ...position, altitudeFt: 3000, headingDeg: 150, vsFpm: 0 });
    expect(evaluateClearance(SCENARIO.airspace.mvaFt, ac, geo(ac)).ok).toBe(true);
  });

  it('still refuses past the threshold and below the MVA', () => {
    // What is left in the gate: the clearance could never mean anything.
    const past = makeAircraft({ ...onFinal(-3), altitudeFt: 3000, headingDeg: 180 });
    expect(evaluateClearance(SCENARIO.airspace.mvaFt, past, geo(past)).code).toBe('pastThreshold');
    const low = makeAircraft({ ...onFinal(12, -2), altitudeFt: 1500, headingDeg: 210 });
    expect(evaluateClearance(SCENARIO.airspace.mvaFt, low, geo(low)).code).toBe('belowMva');
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
    const position = onFinal(16, -2.5);
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
    const position = onFinal(12, -3);
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

  it('captures the localizer while still descending — the vertical is the G/S’s business', () => {
    const position = onFinal(10, -1);
    const ac = makeAircraft({
      ...position,
      altitudeFt: 4000,
      targetAltitudeFt: 2000, // still well over 200 fpm down at the course
      headingDeg: 210,
      iasKts: 180,
      phase: 'cleared',
    });
    const world = runToIntercept(ac);

    expect(ac.phase).toBe('loc');
    expect(Math.abs(ac.vsFpm)).toBeGreaterThan(200);
    expect(world.stats.missedIntercepts.size).toBe(0);
  });

  it('does not capture the localizer outside 25 NM, and keeps the clearance', () => {
    // Crossing the centerline at 30 NM is not an intercept — the localizer is
    // not being received — so nothing is tested and nothing is lost.
    const ac = makeAircraft({
      ...onFinal(30, -0.2),
      altitudeFt: 6000,
      headingDeg: 240, // crosses the course well outside the service volume
      iasKts: 250, // would fail the intercept had one been attempted
      vsFpm: 0,
      phase: 'cleared',
    });
    const world = quietWorld(ac);
    for (let i = 0; i < 600; i += 1) step(world, PHYSICS_DT);

    expect(geo(ac).xtkNm).toBeGreaterThan(0.5); // it went through
    expect(ac.phase).toBe('cleared');
    expect(world.stats.missedIntercepts.size).toBe(0);
  });

  it('lands an aircraft cleared while diverging from an overshot final', () => {
    // The whole point: clear it and turn it back in the same breath, then look
    // away. The clearance survives the diverging leg and intercepts on its own.
    const ac = makeAircraft({
      ...onFinal(18, 2), // right of course, having overshot
      altitudeFt: 3000,
      headingDeg: 240, // still tracking away from the course
      iasKts: 200,
      vsFpm: 0,
    });
    const world = quietWorld(ac);
    expect(geo(ac).closing).toBe(false);

    clearForIls(world, ac);
    for (let i = 0; i < 3; i += 1) adjustHeading(world, ac, 1); // 240 → 270, back through
    pilotActs(world);
    expect(ac.phase).toBe('cleared');

    let landed = false;
    for (let i = 0; i < 40_000 && !landed; i += 1) {
      step(world, PHYSICS_DT);
      if (world.aircraft.length === 0) landed = true;
    }
    expect(landed).toBe(true);
    expect(world.stats.missedIntercepts.size).toBe(0);
  });

  it('flies through the localizer above 230 kt', () => {
    const position = onFinal(12, -1.5);
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
      ...onFinal(22, -4),
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
    const position = onFinal(22, -6);
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

describe('the glideslope gate', () => {
  /** On the localizer at 8 NM, level 40 ft under the path. */
  function onPath(overrides: Partial<Aircraft> = {}) {
    const ac = makeAircraft({
      ...onFinal(8),
      altitudeFt: onGlideslope(8, -40),
      headingDeg: 180,
      iasKts: 180,
      vsFpm: 0,
      ...overrides,
    });
    ac.phase = 'loc';
    return ac;
  }

  it('captures from below, level, on the localizer', () => {
    const ac = onPath();
    expect(canCaptureGlideslope(ac, geo(ac))).toBe(true);
  });

  it('refuses to capture while still descending', () => {
    const ac = onPath({ vsFpm: -800 });
    expect(canCaptureGlideslope(ac, geo(ac))).toBe(false);
  });

  it('refuses to capture above 230 kt', () => {
    const ac = onPath({ iasKts: 240 });
    expect(canCaptureGlideslope(ac, geo(ac))).toBe(false);
  });

  it('never captures from above', () => {
    const ac = onPath({ altitudeFt: onGlideslope(8, +40) });
    expect(canCaptureGlideslope(ac, geo(ac))).toBe(false);
  });

  it('refuses to capture outside 25 NM', () => {
    const ac = makeAircraft({
      ...onFinal(30),
      altitudeFt: onGlideslope(30, -40),
      headingDeg: 180,
      iasKts: 180,
      vsFpm: 0,
    });
    ac.phase = 'loc';
    expect(canCaptureGlideslope(ac, geo(ac))).toBe(false);
  });

  it('flies through the path while descending, and captures once it levels off', () => {
    // The gate is checked at the path, on its own, so an aircraft descending
    // through it does not capture — but nothing is lost either: it levels at
    // its assigned altitude under the path and captures on the way in.
    const ac = makeAircraft({
      ...onFinal(14, -1),
      altitudeFt: 5000,
      targetAltitudeFt: 2000, // descends straight through the ~4458 ft path
      headingDeg: 200,
      iasKts: 190,
      phase: 'cleared',
    });
    const world = quietWorld(ac);

    let crossedDescending = false;
    let landed = false;
    for (let i = 0; i < 40_000 && !landed; i += 1) {
      const above = ac.altitudeFt > geo(ac).gsAltitudeFt;
      step(world, PHYSICS_DT);
      if (world.aircraft.length === 0) {
        landed = true;
        break;
      }
      if (above && ac.altitudeFt < geo(ac).gsAltitudeFt && ac.vsFpm < -200) {
        crossedDescending = true;
        expect(ac.phase).toBe('loc'); // through the path, not on it
      }
    }

    expect(crossedDescending).toBe(true);
    expect(landed).toBe(true);
    expect(world.stats.goArounds).toBe(0);
    expect(world.stats.missedIntercepts.size).toBe(0); // the localizer was fine
  });
});

describe('localizer tracking', () => {
  it('steers back toward the centerline from the right', () => {
    const position = onFinal(8, 0.4); // right of course
    const ac = makeAircraft({ ...position, headingDeg: 180 });
    const g = geo(ac);
    expect(g.xtkNm).toBeGreaterThan(0); // right of course
    // Correcting left of the 180° course.
    expect(localizerHeading(RUNWAY, ac, g)).toBeLessThan(180);
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
    expect(isEstablished(ac, geo(ac))).toBe(false);

    // A little later — the 5° alignment test is the last one to come good.
    for (let i = 0; i < 1200; i += 1) step(world, PHYSICS_DT);
    expect(isEstablished(ac, geo(ac))).toBe(true);
  });

  it('goes around when the approach is unstable inside 5 NM', () => {
    const position = onFinal(4.5);
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
      ...onFinal(1),
      altitudeFt: 318,
      headingDeg: 180,
      iasKts: 140,
      phase: 'gs',
    });
    const follower = makeAircraft({
      ...onFinal(4.5),
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
      ...onFinal(2),
      altitudeFt: 637,
      headingDeg: 180,
      iasKts: 140,
      phase: 'gs',
    });
    const follower = makeAircraft({
      ...onFinal(4),
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

/**
 * The speed schedule is a ceiling that a post-clearance assignment cannot lift.
 *
 * Assigning a speed after the clearance used to replace the schedule outright, so
 * the aircraft held the assigned speed to 5 NM — where the target drops to Vapp and
 * the stability gate starts checking on the same tick. There was no distance left
 * to lose the speed in, and a correctly flown approach went around for excessive
 * speed. The 190 case is the sharp one: it is `minCleanKts` for a medium, the
 * slowest speed a clean assignment is allowed to be (§6.2).
 */
describe('a speed assigned after the clearance', () => {
  /** Established on final at `alongNm`, holding `assignedKts` by the real command path. */
  function onFinalHolding(assignedKts: number, alongNm = 15) {
    // Level at 4000 rather than on the profile: the aircraft has to fly down to
    // the glideslope and intercept it, which is what keeps it off Tower's
    // frequency long enough to take a speed — the handoff comes with the
    // glideslope, and a handed-off aircraft takes no instructions.
    const ac = makeAircraft({
      ...onFinal(alongNm),
      headingDeg: RUNWAY.courseDeg,
      altitudeFt: 4000,
      iasKts: assignedKts,
      targetIasKts: assignedKts,
      vsFpm: 0,
    });
    const world = quietWorld(ac);
    clearForIls(world, ac);
    pilotActs(world, ac);
    // The flag arms on an *established* aircraft, not a merely cleared one, so the
    // approach has to be flown to capture before the speed is assigned — which is
    // the order the technique is used in anyway.
    for (let i = 0; i < 4000 && ac.phase !== 'loc'; i += 1) step(world, PHYSICS_DT);
    expect(ac.phase).toBe('loc');

    // Press the speed key, which is what arms the override.
    adjustSpeed(world, ac, -1);
    adjustSpeed(world, ac, 1);
    pilotActs(world, ac);
    expect(ac.speedAssignedAfterClearance).toBe(true);
    expect(ac.targetIasKts).toBe(assignedKts);
    return { ac, world };
  }

  for (const assignedKts of [190, 200]) {
    it(`${assignedKts} kt held to the marker still lands`, () => {
      const { ac, world } = onFinalHolding(assignedKts);
      for (let i = 0; i < 20_000 && world.aircraft.length > 0; i += 1) step(world, PHYSICS_DT);

      expect(world.stats.goArounds).toBe(0);
      expect(world.stats.landings).toBe(1);
      expect(ac.goArounds).toBe(0);
    });
  }

  it('is honoured out to the 8 NM gate, then gives way to it', () => {
    const { ac } = onFinalHolding(200);
    // Outside 8 NM the assignment stands; at the gate the schedule takes over, so
    // the aircraft arrives at the 5 NM stability check at 180 rather than at 200.
    expect(approachSpeedTargetKts(ac, 10)).toBe(200);
    expect(approachSpeedTargetKts(ac, 8.1)).toBe(200);
    expect(approachSpeedTargetKts(ac, 8)).toBe(180);
    expect(approachSpeedTargetKts(ac, 5.1)).toBe(180);
  });

  it('can still slow an aircraft below the schedule, which is the other half of the technique', () => {
    // The flag is set by *any* post-clearance assignment, so it never meant "stay
    // fast": an assignment under every gate has to survive all of them.
    const { ac } = onFinalHolding(200);
    ac.targetIasKts = 160;
    for (const alongNm of [12, 10, 8, 6, 5.1]) {
      expect(approachSpeedTargetKts(ac, alongNm)).toBe(160);
    }
  });
});
