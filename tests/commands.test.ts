import { describe, expect, it } from 'vitest';
import {
  adjustAltitude,
  adjustHeading,
  adjustSpeed,
  clearForIls,
  speedFloorKts,
} from '../src/sim/commands.js';
import { CEILING_FT, HEADING_HINT_S, MVA_FT } from '../src/sim/constants.js';
import { displayHeading } from '../src/sim/units.js';
import { HEAVY_TYPE, makeAircraft, onFinalApproach, pilotActs, quietWorld } from './helpers.js';

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
    const ac = makeAircraft({ altitudeFt: MVA_FT });
    const world = quietWorld(ac);

    adjustAltitude(world, ac, -1);
    pilotActs(world);
    expect(ac.targetAltitudeFt).toBe(MVA_FT);
    expect(world.messages.at(-1)!.text).toContain(`MVA ${MVA_FT}`);

    ac.targetAltitudeFt = CEILING_FT;
    adjustAltitude(world, ac, 1);
    pilotActs(world);
    expect(ac.targetAltitudeFt).toBe(CEILING_FT);
  });
});

describe('speed assignment', () => {
  it('holds a clean minimum until 20 track miles (IF 6.15.8)', () => {
    const far = makeAircraft({ ...onFinalApproach(30), iasKts: 180, targetIasKts: 180 });
    expect(speedFloorKts(far)).toBe(180);

    const world = quietWorld(far);
    adjustSpeed(world, far, -1);
    pilotActs(world);
    expect(far.targetIasKts).toBe(180);
    expect(world.messages.some((m) => m.text.includes('track miles'))).toBe(true);
  });

  it('gives heavies a higher clean minimum', () => {
    const heavy = makeAircraft({ ...onFinalApproach(30), type: HEAVY_TYPE });
    expect(speedFloorKts(heavy)).toBe(190);
  });

  it('allows 160 kt once inside 20 track miles', () => {
    const near = makeAircraft({ ...onFinalApproach(12), iasKts: 170, targetIasKts: 170 });
    expect(speedFloorKts(near)).toBe(160);

    const world = quietWorld(near);
    adjustSpeed(world, near, -1);
    pilotActs(world);
    expect(near.targetIasKts).toBe(160);
    adjustSpeed(world, near, -1);
    pilotActs(world);
    expect(near.targetIasKts).toBe(160);
  });

  it('marks a speed issued after the clearance so it survives to 5 NM', () => {
    const ac = makeAircraft({ ...onFinalApproach(12), iasKts: 200, targetIasKts: 200 });
    ac.phase = 'loc';
    const world = quietWorld(ac);

    adjustSpeed(world, ac, -1);
    pilotActs(world);
    expect(ac.speedAssignedAfterClearance).toBe(true);
  });
});

describe('the C key', () => {
  it('clears a good setup and records nothing against the player', () => {
    const ac = makeAircraft({
      ...onFinalApproach(12, 2),
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

  it('refuses and records the reason when the aircraft is too high', () => {
    const ac = makeAircraft({
      ...onFinalApproach(12, 2),
      altitudeFt: 6000,
      headingDeg: 210,
      vsFpm: 0,
    });
    const world = quietWorld(ac);

    clearForIls(world, ac);
    pilotActs(world);
    expect(ac.phase).toBe('inbound');
    expect(world.stats.rejections.get('aboveGlideslope')).toBe(1);
  });

  it('is ignored once the aircraft is with Tower', () => {
    const ac = makeAircraft({ ...onFinalApproach(6), phase: 'gs', handedOff: true });
    const world = quietWorld(ac);

    adjustHeading(world, ac, 1);
    expect(ac.pending).toHaveLength(0);
    expect(world.messages.at(-1)!.text).toContain('Tower frequency');
  });
});

describe('vectoring off an approach', () => {
  it('cancels the clearance when a heading is assigned', () => {
    const ac = makeAircraft({ ...onFinalApproach(9), phase: 'loc', headingDeg: 180 });
    const world = quietWorld(ac);

    adjustHeading(world, ac, 1);
    pilotActs(world);
    expect(ac.phase).toBe('inbound');
    expect(world.messages.some((m) => m.text.includes('cancelling the approach'))).toBe(true);
  });
});
