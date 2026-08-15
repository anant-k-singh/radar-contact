import { describe, expect, it } from 'vitest';
import { adjustAltitude, adjustHeading } from '../src/sim/commands.js';
import { PHYSICS_DT, PILOT_DELAY_MAX_S, PILOT_DELAY_MIN_S } from '../src/sim/constants.js';
import { assignedAltitudeFt, assignedHeadingDeg } from '../src/sim/pilot.js';
import { step } from '../src/sim/world.js';
import { makeAircraft, quietWorld, run } from './helpers.js';

describe('pilot reaction time', () => {
  it('flies an instruction 1–3 s after it is transmitted', () => {
    const reactions: number[] = [];

    for (let seed = 0; seed < 40; seed += 1) {
      const ac = makeAircraft({ x: 0, y: 20, headingDeg: 90, targetHeadingDeg: 90 });
      const world = quietWorld(ac);
      world.pilotRng.next = () => seed / 40; // sweep the whole spread

      adjustHeading(world, ac, 1);
      const transmittedAtS = world.timeS;
      for (let i = 0; i < 100 && ac.targetHeadingDeg === 90; i += 1) step(world, PHYSICS_DT);

      expect(ac.targetHeadingDeg).toBe(100);
      reactions.push(world.timeS - transmittedAtS);
    }

    expect(Math.min(...reactions)).toBeGreaterThanOrEqual(PILOT_DELAY_MIN_S);
    expect(Math.max(...reactions)).toBeLessThanOrEqual(PILOT_DELAY_MAX_S + PHYSICS_DT);
    // Not a fixed delay: the sweep produces a spread of reaction times.
    expect(new Set(reactions).size).toBeGreaterThan(10);
  });

  it('holds the aircraft on its old target until the readback', () => {
    const ac = makeAircraft({ x: 0, y: 20, headingDeg: 90, targetHeadingDeg: 90, altitudeFt: 6000 });
    const world = quietWorld(ac);

    adjustHeading(world, ac, 1);
    adjustAltitude(world, ac, -1);

    // Transmitted: the scope shows what was assigned straight away...
    expect(assignedHeadingDeg(ac)).toBe(100);
    expect(assignedAltitudeFt(ac)).toBe(5000);
    // ...but nothing is flying it yet.
    run(world, PILOT_DELAY_MIN_S - 0.1);
    expect(ac.targetHeadingDeg).toBe(90);
    expect(ac.targetAltitudeFt).toBe(6000);
    expect(ac.headingDeg).toBe(90);
    expect(world.messages).toHaveLength(0);

    run(world, PILOT_DELAY_MAX_S);
    expect(ac.targetHeadingDeg).toBe(100);
    expect(ac.targetAltitudeFt).toBe(5000);
    expect(ac.pending).toHaveLength(0);
    expect(world.messages).toHaveLength(2); // one readback each
  });

  it('keeps a session reproducible whatever the player does', () => {
    // Reaction times come off their own stream, so talking to one aircraft
    // cannot shift the traffic a seed generates.
    const spawnLog = (talk: boolean): string[] => {
      const world = quietWorld();
      world.traffic.nextSpawnAtS = 5;
      const seen: string[] = [];
      for (let i = 0; i < 20_000; i += 1) {
        step(world, PHYSICS_DT);
        for (const ac of world.aircraft) {
          if (ac.spawnedAtS === world.timeS) seen.push(`${ac.callsign}@${ac.entryGate}`);
        }
        if (talk && world.aircraft.length > 0) adjustHeading(world, world.aircraft[0]!, 1);
      }
      return seen;
    };

    expect(spawnLog(true)).toEqual(spawnLog(false));
  });
});
