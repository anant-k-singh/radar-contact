import { describe, expect, it } from 'vitest';
import { AIRPORT } from '../src/scenario/airport.js';
import { boundaryRangeAtBearing } from '../src/sim/airspace.js';
import {
  AIRSPACE_HALF_HEIGHT_NM,
  AIRSPACE_RADIUS_NM,
  ENTRY_ALTITUDE_FT,
  ENTRY_ALTITUDE_NEAR_FT,
  ENTRY_SPEED_KTS,
  IN_TRAIL_SEQUENCING_MIN_NM,
  LANDING_RATE_MIN_ELAPSED_S,
  LANDING_RATE_WINDOW_S,
  MIN_SPAWN_INTERVAL_S,
  PILOT_DELAY_MAX_S,
  PHYSICS_DT,
  SEP_HORIZ_NM,
} from '../src/sim/constants.js';
import { adjustHeading } from '../src/sim/commands.js';
import { createRng } from '../src/sim/rng.js';
import { createArrival, createTrafficState, scheduleNextSpawn } from '../src/sim/traffic.js';
import { bearing } from '../src/sim/units.js';
import {
  createWorld,
  landingRatePerHour,
  log,
  messagesFor,
  projectedSpacingNm,
  step,
} from '../src/sim/world.js';
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
    const gate = AIRPORT.gates.find((g) => g.name === ac.entryGate)!;
    expect(ac.altitudeFt).toBe(gate.entryAltitudeFt);
    expect(ac.iasKts).toBe(ENTRY_SPEED_KTS);
    // One physics step of flying has already happened since the handover.
    expect(Math.hypot(ac.x, ac.y)).toBeCloseTo(AIRSPACE_RADIUS_NM, 1);
    // Established on the first leg of its STAR.
    const first = ac.star!.route.waypoints[1]!;
    expect(bearing(gate.position, first.position)).toBeCloseTo(ac.headingDeg, 4);
  });

  it('hands the two northern gates over 1000 ft lower', () => {
    const byName = new Map(AIRPORT.gates.map((g) => [g.name, g.entryAltitudeFt]));
    expect(byName.get('KOVAL')).toBe(ENTRY_ALTITUDE_NEAR_FT);
    expect(byName.get('VANDA')).toBe(ENTRY_ALTITUDE_NEAR_FT);
    expect(byName.get('TEMBA')).toBe(ENTRY_ALTITUDE_FT);
    expect(byName.get('RIMOL')).toBe(ENTRY_ALTITUDE_FT);

    // And an arrival actually spawns at its gate's altitude, level.
    for (const gate of AIRPORT.gates) {
      const ac = createArrival(createRng(7), createTrafficState(), gate, [], 0);
      expect(ac.altitudeFt).toBe(gate.entryAltitudeFt);
      expect(ac.targetAltitudeFt).toBe(gate.entryAltitudeFt);
      expect(ac.radar.altitudeFt).toBe(gate.entryAltitudeFt);
    }
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
    // Due east, where the boundary is still the 50 NM arc.
    const ac = makeAircraft({
      x: AIRSPACE_RADIUS_NM - 0.2,
      y: 0,
      headingDeg: 90,
      altitudeFt: 6000,
      iasKts: 250,
    });
    const world = quietWorld(ac);
    run(world, 30);

    expect(world.aircraft).toHaveLength(0);
    expect(world.stats.exits).toBe(1);
    expect(world.messages.some((m) => m.text.includes('returned to Center'))).toBe(true);
  });

  it('exits north through the chord, well inside 50 NM', () => {
    // The caps are cut off (§3.1), so running out of airspace northbound
    // happens at 42 NM — the radius alone would still call this inside.
    const ac = makeAircraft({
      x: 0,
      y: AIRSPACE_HALF_HEIGHT_NM - 0.2,
      headingDeg: 360,
      altitudeFt: 6000,
      iasKts: 250,
    });
    const world = quietWorld(ac);
    run(world, 30);

    expect(world.aircraft).toHaveLength(0);
    expect(world.stats.exits).toBe(1);
  });

  it('leaves inbound traffic at the boundary alone', () => {
    const ac = makeAircraft({
      x: 0,
      y: AIRSPACE_HALF_HEIGHT_NM,
      headingDeg: 180,
      altitudeFt: 8000,
      iasKts: 250,
    });
    const world = quietWorld(ac);
    run(world, 30);

    expect(world.aircraft).toHaveLength(1);
    expect(world.stats.exits).toBe(0);
  });

  it('keeps every entry gate inside the shape, with room for its label', () => {
    // The chords are only safe to cut where nothing lives. Gates sit *on* the
    // boundary, so the test is that each one still meets it at the arc rather
    // than beyond a chord — and with enough room left for its marker.
    for (const gate of AIRPORT.gates) {
      expect(boundaryRangeAtBearing(gate.bearingDeg)).toBeCloseTo(AIRSPACE_RADIUS_NM, 6);
      expect(AIRSPACE_HALF_HEIGHT_NM - Math.abs(gate.position.y)).toBeGreaterThan(2);
    }
  });
});

describe('handover to Tower', () => {
  it('holds an aircraft on frequency when the closure rate is unacceptable', () => {
    // Follower 3.2 NM behind but 60 kt faster: it will be inside 3 NM by the
    // time the lead touches down.
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

  it('holds the transfer at 10 NM and beyond until the 4 NM gap is there', () => {
    // Matched speeds, so the spacing at the threshold is what it is now: 3.5 NM
    // clears radar separation but not the sequencing gap owed out here (§9.3).
    const lead = makeAircraft({
      ...onFinalApproach(8),
      altitudeFt: 2547,
      headingDeg: 180,
      iasKts: 150,
      phase: 'gs',
    });
    const follower = makeAircraft({
      ...onFinalApproach(11.5),
      altitudeFt: 3662,
      headingDeg: 180,
      iasKts: 150,
      phase: 'gs',
    });
    follower.id = 2;

    const spacing = projectedSpacingNm(follower, lead);
    expect(spacing).toBeGreaterThan(SEP_HORIZ_NM);
    expect(spacing).toBeLessThan(IN_TRAIL_SEQUENCING_MIN_NM);

    const world = quietWorld(lead, follower);
    step(world, PHYSICS_DT);
    expect(follower.handedOff).toBe(false);
    expect(lead.handedOff).toBe(true);
  });

  it('transfers the same pair once it is inside 10 NM', () => {
    // Identical 3.5 NM gap, 3 NM closer in: the sequencing requirement is
    // behind them, so 3 NM radar separation is the test and it passes.
    const lead = makeAircraft({
      ...onFinalApproach(5),
      altitudeFt: 1592,
      headingDeg: 180,
      iasKts: 150,
      phase: 'gs',
    });
    const follower = makeAircraft({
      ...onFinalApproach(8.5),
      altitudeFt: 2706,
      headingDeg: 180,
      iasKts: 150,
      phase: 'gs',
    });
    follower.id = 2;

    const world = quietWorld(lead, follower);
    step(world, PHYSICS_DT);
    expect(follower.handedOff).toBe(true);
  });
});

describe('landing rate', () => {
  it('is withheld until the sample is long enough to mean anything', () => {
    const world = quietWorld();
    expect(landingRatePerHour(world)).toBeNull();
    run(world, LANDING_RATE_MIN_ELAPSED_S - 5);
    expect(landingRatePerHour(world)).toBeNull();
  });

  it('extrapolates the trailing window to an hourly rate', () => {
    const world = quietWorld();
    world.timeS = 300; // 5 minutes in, so the window is 300 s of elapsed time
    world.stats.landingTimesS = [60, 120, 180];

    // 3 landings in 5 minutes → 36/h.
    expect(landingRatePerHour(world)).toBeCloseTo(36, 6);
  });

  it('counts only the trailing window, so an earlier rush stops flattering it', () => {
    const world = quietWorld();
    world.timeS = 1800;
    const since = world.timeS - LANDING_RATE_WINDOW_S;
    // Six landings early in the session, two inside the window.
    world.stats.landingTimesS = [60, 120, 180, 240, 300, 360, since + 100, since + 300];

    // 2 across the window — well under the 16/h the whole session would suggest.
    expect(landingRatePerHour(world)).toBeCloseTo((2 / LANDING_RATE_WINDOW_S) * 3600, 6);
  });

  it('drops landings out of the window as the session runs on', () => {
    const world = quietWorld(
      makeAircraft({
        ...onFinalApproach(0.4),
        altitudeFt: 127,
        headingDeg: 180,
        iasKts: 140, // on speed, so the stability gate lets it land
        phase: 'gs',
      }),
    );
    run(world, LANDING_RATE_MIN_ELAPSED_S + 10);
    expect(world.stats.landings).toBe(1);
    expect(landingRatePerHour(world)).toBeGreaterThan(0);

    // A full window more with nothing landing: the rate decays to zero.
    run(world, LANDING_RATE_WINDOW_S);
    expect(world.stats.landings).toBe(1); // the total is untouched
    expect(landingRatePerHour(world)).toBe(0);
  });
});

describe('the message log follows the selection', () => {
  it('shows only the selected aircraft, and the whole frequency when nothing is', () => {
    // `makeAircraft` builds each one through its own traffic state, so the ids
    // have to be separated by hand here.
    const one = makeAircraft({ ...onFinalApproach(12), callsign: 'AAA111', id: 1 });
    const two = makeAircraft({ ...onFinalApproach(20), callsign: 'BBB222', id: 2 });
    const world = quietWorld(one, two);
    log(world, 'one', 'pilot', [one.id]);
    log(world, 'two', 'pilot', [two.id]);
    log(world, 'both', 'alert', [one.id, two.id]);
    log(world, 'neither', 'system');

    expect(messagesFor(world).map((m) => m.text)).toEqual(['one', 'two', 'both', 'neither']);

    world.selectedId = one.id;
    expect(messagesFor(world).map((m) => m.text)).toEqual(['one', 'both']);

    world.selectedId = two.id;
    expect(messagesFor(world).map((m) => m.text)).toEqual(['two', 'both']);
  });

  it('tags what an aircraft says with the aircraft that said it', () => {
    const ac = makeAircraft({ ...onFinalApproach(12), headingDeg: 360 });
    const world = quietWorld(ac);
    world.selectedId = ac.id;
    adjustHeading(world, ac, 1);
    run(world, PILOT_DELAY_MAX_S + 1);

    // The readback reached the filtered log rather than only the raw one.
    expect(messagesFor(world).length).toBe(world.messages.length);
    expect(world.messages.length).toBeGreaterThan(0);
  });
});
