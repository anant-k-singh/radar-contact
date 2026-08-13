import { describe, expect, it } from 'vitest';
import {
  AIRSPACE_RADIUS_NM,
  ENTRY_ALTITUDE_FT,
  ENTRY_SPEED_KTS,
  MIN_SPAWN_INTERVAL_S,
  PHYSICS_DT,
  SEP_HORIZ_NM,
} from '../src/sim/constants.js';
import { createRng } from '../src/sim/rng.js';
import { createTrafficState, scheduleNextSpawn } from '../src/sim/traffic.js';
import { bearing } from '../src/sim/units.js';
import { createWorld, projectedSpacingNm, step } from '../src/sim/world.js';
import { makeAircraft, onFinalApproach, quietWorld } from './helpers.js';

/** Run the world forward by `seconds` of sim time. */
function run(world: ReturnType<typeof createWorld>, seconds: number): void {
  const steps = Math.round(seconds / PHYSICS_DT);
  for (let i = 0; i < steps; i += 1) step(world, PHYSICS_DT);
}

describe('traffic generation', () => {
  it('schedules arrivals at the configured mean interval', () => {
    const rng = createRng(99);
    const state = createTrafficState();
    let time = 0;
    const intervals: number[] = [];
    for (let i = 0; i < 4000; i += 1) {
      scheduleNextSpawn(state, rng, time, 25);
      intervals.push(state.nextSpawnAtS - time);
      time = state.nextSpawnAtS;
    }

    const mean = intervals.reduce((sum, v) => sum + v, 0) / intervals.length;
    // Exponential with a 144 s mean, floored at 45 s, gives E[interval] ≈ 150 s.
    expect(mean).toBeGreaterThan(140);
    expect(mean).toBeLessThan(162);
    expect(Math.min(...intervals)).toBeGreaterThanOrEqual(MIN_SPAWN_INTERVAL_S);
  });

  it('delivers close to the configured flow rate over an hour', () => {
    const world = createWorld(7, 25);
    let spawned = 0;
    const seen = new Set<number>();

    const steps = Math.round(3600 / PHYSICS_DT);
    for (let i = 0; i < steps; i += 1) {
      step(world, PHYSICS_DT);
      for (const ac of world.aircraft) {
        if (!seen.has(ac.id)) {
          seen.add(ac.id);
          spawned += 1;
        }
      }
    }
    // Nobody is controlling, so unattended traffic drifts across the airspace
    // and blocks the far gates — a few arrivals get deferred. With a controller
    // working the traffic this sits much closer to the nominal 25.
    expect(spawned).toBeGreaterThan(15);
    expect(spawned).toBeLessThan(32);
  });

  it('hands over at the contracted altitude, speed and position', () => {
    const world = createWorld(3, 40);
    while (world.aircraft.length === 0) step(world, PHYSICS_DT);

    const ac = world.aircraft[0]!;
    expect(ac.altitudeFt).toBe(ENTRY_ALTITUDE_FT);
    expect(ac.iasKts).toBe(ENTRY_SPEED_KTS);
    // One physics step of flying has already happened since the handover.
    expect(Math.hypot(ac.x, ac.y)).toBeCloseTo(AIRSPACE_RADIUS_NM, 1);
    // Pointed at the airport reference point.
    expect(bearing({ x: ac.x, y: ac.y }, { x: 0, y: 0 })).toBeCloseTo(ac.headingDeg, 4);
  });

  it('never hands over traffic that is already in conflict', () => {
    const world = createWorld(11, 40);
    const steps = Math.round(1800 / PHYSICS_DT);
    for (let i = 0; i < steps; i += 1) {
      step(world, PHYSICS_DT);
      for (const ac of world.aircraft) {
        if (ac.spawnedAtS !== world.timeS) continue;
        for (const other of world.aircraft) {
          if (other === ac) continue;
          const distance = Math.hypot(ac.x - other.x, ac.y - other.y);
          expect(distance).toBeGreaterThan(SEP_HORIZ_NM);
        }
      }
    }
  });
});

describe('the radar return', () => {
  it('updates the data block once a second while the aircraft moves smoothly', () => {
    const ac = makeAircraft({ ...onFinalApproach(20), headingDeg: 180, iasKts: 250 });
    const world = quietWorld(ac);
    // The first sample lands on the first step; the next is due at 1.05 s.
    run(world, 0.5);

    const blockAltitude = ac.radar.altitudeFt;
    const blockHeading = ac.radar.headingDeg;
    ac.targetAltitudeFt = 4000;
    ac.targetHeadingDeg = 90;

    const positionBefore = { x: ac.x, y: ac.y };
    run(world, 0.4); // now at 0.9 s — still inside the same radar period

    // Position has moved...
    expect(Math.hypot(ac.x - positionBefore.x, ac.y - positionBefore.y)).toBeGreaterThan(0);
    // ...but the displayed values are still the last radar return.
    expect(ac.radar.altitudeFt).toBe(blockAltitude);
    expect(ac.radar.headingDeg).toBe(blockHeading);

    run(world, 0.3); // past 1.05 s — a fresh return
    expect(ac.radar.altitudeFt).toBeLessThan(blockAltitude);
    expect(ac.radar.headingDeg).not.toBe(blockHeading);
  });
});

describe('airspace boundary', () => {
  it('hands an outbound aircraft back to Center and scores an exit', () => {
    const ac = makeAircraft({
      x: 0,
      y: AIRSPACE_RADIUS_NM - 0.2,
      headingDeg: 360,
      altitudeFt: 6000,
      iasKts: 250,
    });
    const world = quietWorld(ac);
    run(world, 30);

    expect(world.aircraft).toHaveLength(0);
    expect(world.stats.exits).toBe(1);
    expect(world.messages.some((m) => m.text.includes('returned to Center'))).toBe(true);
  });

  it('leaves inbound traffic at the boundary alone', () => {
    const ac = makeAircraft({
      x: 0,
      y: AIRSPACE_RADIUS_NM,
      headingDeg: 180,
      altitudeFt: 8000,
      iasKts: 250,
    });
    const world = quietWorld(ac);
    run(world, 30);

    expect(world.aircraft).toHaveLength(1);
    expect(world.stats.exits).toBe(0);
  });
});

describe('handover to Tower', () => {
  it('holds an aircraft on frequency when the closure rate is unacceptable', () => {
    // Follower 3.2 NM behind but 60 kt faster: it will be inside 3 NM by the
    // time the lead touches down (IF 6.14.3).
    const lead = makeAircraft({
      ...onFinalApproach(5),
      altitudeFt: 1592,
      headingDeg: 180,
      iasKts: 140,
      phase: 'gs',
    });
    const follower = makeAircraft({
      ...onFinalApproach(8.2),
      altitudeFt: 2611,
      headingDeg: 180,
      iasKts: 200,
      phase: 'gs',
    });
    follower.id = 2;

    expect(projectedSpacingNm(follower, lead)).toBeLessThan(SEP_HORIZ_NM);

    const world = quietWorld(lead, follower);
    step(world, PHYSICS_DT);
    expect(follower.handedOff).toBe(false);
  });
});
