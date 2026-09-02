import { describe, expect, it } from 'vitest';
import {
  adjustAltitude,
  adjustHeading,
  adjustSpeed,
  clearForIls,
  speedFloorKts,
} from '../src/sim/commands.js';
import {
  HEADING_HINT_S,
  PHYSICS_DT,
  SPEED_FLOOR_CLEAN_KTS,
} from '../src/sim/constants.js';
import { step } from '../src/sim/world.js';
import { displayHeading } from '../src/sim/units.js';
import { HEAVY_TYPE, makeAircraft, MEDIUM_TYPE, onFinal, pilotActs, quietWorld, RUNWAY, SCENARIO } from './helpers.js';

describe('heading assignment', () => {
  it('moves in 10° steps and wraps through north', () => {
    const ac = makeAircraft({ headingDeg: 190 });
    const world = quietWorld(ac);

    adjustHeading(world, ac, 1);
    pilotActs(world);
    expect(ac.targetHeadingDeg).toBe(200);

    adjustHeading(world, ac, -1);
    adjustHeading(world, ac, -1);
    pilotActs(world);
    expect(ac.targetHeadingDeg).toBe(180);

    ac.targetHeadingDeg = 350;
    adjustHeading(world, ac, 1);
    adjustHeading(world, ac, 1);
    pilotActs(world);
    expect(ac.targetHeadingDeg).toBe(10);
  });

  it('counts repeated presses from the last value transmitted, not the last flown', () => {
    // Four presses inside the reaction window are one turn instruction, read
    // back once, at the final value.
    const ac = makeAircraft({ headingDeg: 90, targetHeadingDeg: 90 });
    const world = quietWorld(ac);

    for (let i = 0; i < 4; i += 1) adjustHeading(world, ac, 1);
    expect(ac.targetHeadingDeg).toBe(90); // nothing flown yet
    expect(ac.pending).toHaveLength(1);

    pilotActs(world);
    expect(ac.targetHeadingDeg).toBe(130);
    expect(world.messages.filter((m) => m.text.includes('turning right'))).toHaveLength(1);
  });

  it('reads out 360 rather than 000', () => {
    expect(displayHeading(0)).toBe('360');
    expect(displayHeading(360)).toBe('360');
    expect(displayHeading(40)).toBe('040');
  });

  it('arms the assigned-heading hint from the moment it is transmitted', () => {
    const ac = makeAircraft({ headingDeg: 90 });
    const world = quietWorld(ac);
    world.timeS = 120;

    expect(ac.headingHintUntilS).toBe(0);
    adjustHeading(world, ac, 1);
    expect(ac.headingHintUntilS).toBe(120 + HEADING_HINT_S);

    // A later press restarts the window rather than extending the first one.
    world.timeS = 123;
    adjustHeading(world, ac, 1);
    expect(ac.headingHintUntilS).toBe(123 + HEADING_HINT_S);
  });

  it('reports the direction of turn', () => {
    const ac = makeAircraft({ headingDeg: 90 });
    const world = quietWorld(ac);
    adjustHeading(world, ac, -1);
    pilotActs(world);
    expect(world.messages.at(-1)!.text).toContain('turning left heading 080');
  });
});

describe('altitude assignment', () => {
  it('clamps to the MVA and the ceiling', () => {
    const ac = makeAircraft({ altitudeFt: SCENARIO.airspace.mvaFt });
    const world = quietWorld(ac);

    adjustAltitude(world, ac, -1);
    pilotActs(world);
    expect(ac.targetAltitudeFt).toBe(SCENARIO.airspace.mvaFt);
    expect(world.messages.at(-1)!.text).toContain(`MVA ${SCENARIO.airspace.mvaFt}`);

    ac.targetAltitudeFt = SCENARIO.airspace.ceilingFt;
    adjustAltitude(world, ac, 1);
    pilotActs(world);
    expect(ac.targetAltitudeFt).toBe(SCENARIO.airspace.ceilingFt);
  });
});

describe('speed assignment', () => {
  it('holds a clean minimum until 20 track miles', () => {
    // Against the type's own clean speed, not a literal: the floor is whichever
    // of that and SPEED_FLOOR_CLEAN_KTS is higher, so retuning either must not
    // silently retune the rule.
    const floorKts = Math.max(SPEED_FLOOR_CLEAN_KTS, MEDIUM_TYPE.minCleanKts);
    const far = makeAircraft({ ...onFinal(30), iasKts: floorKts, targetIasKts: floorKts });
    expect(speedFloorKts(RUNWAY, far)).toBe(floorKts);

    const world = quietWorld(far);
    adjustSpeed(world, far, -1);
    pilotActs(world);
    expect(far.targetIasKts).toBe(floorKts);
    expect(world.messages.some((m) => m.text.includes('track miles'))).toBe(true);
  });

  it('gives heavies a higher clean minimum', () => {
    const heavy = makeAircraft({ ...onFinal(30), type: HEAVY_TYPE });
    expect(speedFloorKts(RUNWAY, heavy)).toBe(HEAVY_TYPE.minCleanKts);
    expect(HEAVY_TYPE.minCleanKts).toBeGreaterThan(MEDIUM_TYPE.minCleanKts);
  });

  it('allows 160 kt once inside 20 track miles', () => {
    const near = makeAircraft({ ...onFinal(12), iasKts: 170, targetIasKts: 170 });
    expect(speedFloorKts(RUNWAY, near)).toBe(160);

    const world = quietWorld(near);
    adjustSpeed(world, near, -1);
    pilotActs(world);
    expect(near.targetIasKts).toBe(160);
    adjustSpeed(world, near, -1);
    pilotActs(world);
    expect(near.targetIasKts).toBe(160);
  });

  it('marks a speed issued once established so it survives to 5 NM', () => {
    const ac = makeAircraft({ ...onFinal(12), iasKts: 200, targetIasKts: 200 });
    ac.phase = 'loc';
    const world = quietWorld(ac);

    adjustSpeed(world, ac, -1);
    pilotActs(world);
    expect(ac.speedAssignedAfterClearance).toBe(true);
  });

  it('does not arm 6.14.4 for a speed issued before the intercept', () => {
    // A clearance may be given 20 NM out now (§6.1a), so ordinary sequencing
    // speed control lands in the `cleared` window constantly. Treating it as
    // "maintain XXX until X mile final" would switch off the deceleration
    // schedule and carry the speed to 5 NM — a go-around for excessive speed
    // on an approach that was set up correctly.
    const ac = makeAircraft({ ...onFinal(20), iasKts: 230, targetIasKts: 230 });
    ac.phase = 'cleared';
    const world = quietWorld(ac);

    adjustSpeed(world, ac, -1);
    pilotActs(world);
    expect(ac.targetIasKts).toBe(220);
    expect(ac.speedAssignedAfterClearance).toBe(false);
  });
});

describe('the C key', () => {
  it('clears a good setup and records nothing against the player', () => {
    const ac = makeAircraft({
      ...onFinal(12, -2),
      altitudeFt: 3000,
      headingDeg: 210,
      iasKts: 180,
      vsFpm: 0,
    });
    const world = quietWorld(ac);

    clearForIls(world, ac);
    expect(ac.phase).toBe('inbound'); // still being read back
    pilotActs(world);

    expect(ac.phase).toBe('cleared');
    expect(world.stats.rejections.size).toBe(0);
    expect(world.messages.at(-1)!.text).toContain('cleared ILS approach runway 18');
  });

  it('refuses and records the reason when the aircraft is past the threshold', () => {
    const ac = makeAircraft({
      ...onFinal(-4),
      altitudeFt: 6000,
      headingDeg: 180,
      vsFpm: 0,
    });
    const world = quietWorld(ac);

    clearForIls(world, ac);
    pilotActs(world);
    expect(ac.phase).toBe('inbound');
    expect(world.stats.rejections.get('pastThreshold')).toBe(1);
  });

  it('accepts a clearance well outside localizer range', () => {
    // Range is settled at the intercept now, not at the clearance (§6.1a).
    const ac = makeAircraft({
      ...onFinal(30, -2),
      altitudeFt: 6000,
      headingDeg: 210,
      vsFpm: 0,
    });
    const world = quietWorld(ac);

    clearForIls(world, ac);
    pilotActs(world);
    expect(ac.phase).toBe('cleared');
    expect(world.stats.rejections.size).toBe(0);
  });

  it('does not let a vector given in the same breath cancel the clearance', () => {
    // Both instructions are outstanding at once and each draws its own reaction
    // time, so without the ordering rule the turn can land after the clearance
    // and read as a vector off the approach (§7.2).
    const ac = makeAircraft({
      ...onFinal(14, -4),
      altitudeFt: 3000,
      headingDeg: 270,
      iasKts: 200,
      vsFpm: 0,
    });
    const world = quietWorld(ac);

    adjustHeading(world, ac, -1);
    clearForIls(world, ac);
    pilotActs(world);

    expect(ac.targetHeadingDeg).toBe(260);
    expect(ac.phase).toBe('cleared');
    expect(world.messages.some((m) => m.text.includes('cancelling'))).toBe(false);
  });

  it('still cancels the clearance for a vector given after it', () => {
    const ac = makeAircraft({
      ...onFinal(14, -4),
      altitudeFt: 3000,
      headingDeg: 210,
      iasKts: 200,
      vsFpm: 0,
    });
    const world = quietWorld(ac);

    clearForIls(world, ac);
    pilotActs(world);
    expect(ac.phase).toBe('cleared');

    adjustHeading(world, ac, 1);
    pilotActs(world);
    expect(ac.phase).toBe('inbound');
    expect(world.messages.some((m) => m.text.includes('cancelling'))).toBe(true);
  });

  it('is not cancelled by a descent given to set up the intercept', () => {
    // "Descend 3000, cleared ILS" is the standard set-up: vectored onto a 30°
    // intercept at 15 NM and 4000, the aircraft reaches the centreline where the
    // glideslope is already below 4000, so it has to be given the lower level to
    // join from. The descent supports the clearance rather than abandoning it
    // (§6.1c).
    const ac = makeAircraft({
      ...onFinal(15, -2),
      altitudeFt: 4000,
      headingDeg: RUNWAY.courseDeg + 30,
      iasKts: 200,
      vsFpm: 0,
    });
    const world = quietWorld(ac);

    clearForIls(world, ac);
    pilotActs(world);
    expect(ac.phase).toBe('cleared');

    adjustAltitude(world, ac, -1);
    pilotActs(world);

    expect(ac.phase).toBe('cleared');
    expect(ac.targetAltitudeFt).toBe(3000);
    expect(world.messages.some((m) => m.text.includes('cancelling'))).toBe(false);
  });

  it('flies that set-up all the way to a landing', () => {
    // The end the technique exists for: level at 3000 by the localizer, the
    // glideslope then caught from below where it comes down to meet it.
    const ac = makeAircraft({
      ...onFinal(15, -2),
      altitudeFt: 4000,
      headingDeg: RUNWAY.courseDeg + 30,
      iasKts: 200,
      vsFpm: 0,
    });
    const world = quietWorld(ac);

    clearForIls(world, ac);
    pilotActs(world);
    adjustAltitude(world, ac, -1);
    pilotActs(world);

    for (let i = 0; i < 20_000 && world.aircraft.length > 0; i += 1) step(world, PHYSICS_DT);

    expect(world.stats.landings).toBe(1);
    expect(world.stats.goArounds).toBe(0);
  });

  it('is still cancelled by an altitude given on the glideslope', () => {
    // The one altitude that cannot stand: the path writes `altitudeFt` directly,
    // so an assigned level is not something the aircraft can fly while on it.
    const ac = makeAircraft({ ...onFinal(8), phase: 'gs', altitudeFt: 2546, iasKts: 160, vsFpm: -700 });
    const world = quietWorld(ac);

    adjustAltitude(world, ac, 1);
    pilotActs(world);

    expect(ac.phase).toBe('inbound');
    expect(world.messages.some((m) => m.text.includes('cancelling'))).toBe(true);
  });

  it('is ignored once the aircraft is with Tower', () => {
    const ac = makeAircraft({ ...onFinal(6), phase: 'gs', handedOff: true });
    const world = quietWorld(ac);

    adjustHeading(world, ac, 1);
    expect(ac.pending).toHaveLength(0);
    expect(world.messages.at(-1)!.text).toContain('Tower frequency');
  });
});

describe('vectoring off an approach', () => {
  it('cancels the clearance when a heading is assigned', () => {
    const ac = makeAircraft({ ...onFinal(9), phase: 'loc', headingDeg: 180 });
    const world = quietWorld(ac);

    adjustHeading(world, ac, 1);
    pilotActs(world);
    expect(ac.phase).toBe('inbound');
    expect(world.messages.some((m) => m.text.includes('cancelling the approach'))).toBe(true);
  });
});
