import { describe, expect, it } from 'vitest';
import { AIRPORT } from '../src/scenario/airport.js';
import type { Aircraft } from '../src/sim/aircraft.js';
import { adjustAltitude, adjustHeading, adjustSpeed, clearForIls, toggleHold } from '../src/sim/commands.js';
import { HOLD_LEG_S, HOLD_SPEED_KTS, PHYSICS_DT } from '../src/sim/constants.js';
import { createRng } from '../src/sim/rng.js';
import { activeFix } from '../src/sim/star.js';
import { createArrival, createTrafficState } from '../src/sim/traffic.js';
import { distance } from '../src/sim/units.js';
import { type World } from '../src/sim/world.js';
import { makeAircraft, pilotActs, quietWorld, run } from './helpers.js';

/** A fresh arrival at `gateName`, on its STAR, in an otherwise empty world. */
function arrival(gateName = 'VANDA'): { ac: Aircraft; world: World } {
  const gate = AIRPORT.gates.find((candidate) => candidate.name === gateName)!;
  const ac = createArrival(createRng(5), createTrafficState(), gate, [], 0);
  return { ac, world: quietWorld(ac) };
}

/** Press H and let the crew act on it. */
function pressHold(world: World, ac: Aircraft): void {
  toggleHold(world, ac);
  pilotActs(world, ac);
}

/** Fly until the aircraft is established in the pattern, or fail. */
function flyToEstablished(world: World, ac: Aircraft, limitS = 900): void {
  for (let elapsed = 0; elapsed < limitS; elapsed += 10) {
    run(world, 10);
    if (ac.star?.hold?.established) return;
  }
  throw new Error('never established in the hold');
}

describe('entering a holding pattern', () => {
  it('is refused for an aircraft that is not on a STAR', () => {
    const ac = makeAircraft(); // makeAircraft() clears the STAR
    const world = quietWorld(ac);

    toggleHold(world, ac);

    expect(ac.pending).toHaveLength(0);
    expect(world.messages.at(-1)!.text).toContain('not on an arrival');
  });

  it('holds at the fix the aircraft is already tracking to', () => {
    const { ac, world } = arrival();
    const fix = activeFix(ac.star!).name;

    pressHold(world, ac);

    expect(ac.star!.hold!.fix).toBe(fix);
  });

  it('does not change the lateral track before the fix is reached', () => {
    const { ac, world } = arrival();
    const headingBefore = ac.targetHeadingDeg;

    pressHold(world, ac);
    run(world, 10);

    // Still tracking the fix, just slower — the pattern begins at the fix.
    expect(ac.star!.hold!.established).toBe(false);
    expect(Math.abs(ac.targetHeadingDeg - headingBefore)).toBeLessThan(1);
  });

  it('slows to 230 kt on the way to the fix', () => {
    const { ac, world } = arrival();
    expect(ac.iasKts).toBeGreaterThan(HOLD_SPEED_KTS);

    pressHold(world, ac);
    run(world, 120);

    expect(ac.iasKts).toBeCloseTo(HOLD_SPEED_KTS, 0);
  });

  it('holds at the last fix of the route rather than ending the arrival', () => {
    const { ac, world } = arrival();
    // Fly on until the aircraft is tracking the final fix of the STAR.
    for (let i = 0; i < 300 && ac.star && ac.star.index < ac.star.route.waypoints.length - 1; i += 1) {
      run(world, 10);
    }
    expect(ac.star!.index).toBe(ac.star!.route.waypoints.length - 1);

    pressHold(world, ac);
    flyToEstablished(world, ac);
    run(world, 600);

    // The STAR never completes while the aircraft is in the pattern.
    expect(ac.star).not.toBeNull();
    expect(ac.star!.hold).not.toBeNull();
  });

  it('freezes the altitude at the holding fix published altitude', () => {
    const { ac, world } = arrival();
    const published = activeFix(ac.star!).altitudeFt!;

    pressHold(world, ac);
    flyToEstablished(world, ac);
    const atEntry = ac.altitudeFt;
    run(world, 120);

    expect(atEntry).toBeCloseTo(published, -2);
    // Level in the pattern rather than continuing down the profile.
    expect(ac.altitudeFt).toBeCloseTo(published, -2);
  });
});

describe('flying the racetrack', () => {
  it('turns right through the pattern and comes back to the fix', () => {
    const { ac, world } = arrival();
    pressHold(world, ac);
    flyToEstablished(world, ac);

    const fixPosition = activeFix(ac.star!).position;
    const firstOutbound = ac.star!.hold!.outboundHeadingDeg;

    // Sample the turn direction over the first part of the outbound turn.
    const before = ac.headingDeg;
    run(world, 10);
    const turned = (ac.headingDeg - before + 540) % 360 - 180;
    expect(turned).toBeGreaterThan(0); // right turn

    // Within one full pattern it is back over the fix.
    let closest = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 30; i += 1) {
      run(world, 10);
      closest = Math.min(closest, distance({ x: ac.x, y: ac.y }, fixPosition));
    }
    expect(closest).toBeLessThan(1);
    // Each loop flies the same outbound heading as the last: the pattern holds
    // its shape rather than precessing round the fix.
    const drift = Math.abs(((ac.star!.hold!.outboundHeadingDeg - firstOutbound + 540) % 360) - 180);
    expect(drift).toBeLessThan(10);
  });

  it('never turns left, on any route', () => {
    // Both reversals in the pattern are exactly 180°, where "turn the short
    // way" has no answer and the sign falls out of floating-point noise. A
    // standard hold is right-hand, so the direction has to be stated (§4.6).
    for (const gateName of ['VANDA', 'KOVAL', 'RIMOL', 'TEMBA']) {
      const { ac, world } = arrival(gateName);
      pressHold(world, ac);
      flyToEstablished(world, ac);

      let leftTicks = 0;
      for (let i = 0; i < 4000; i += 1) {
        const before = ac.headingDeg;
        run(world, 0.25);
        const turned = ((ac.headingDeg - before + 540) % 360) - 180;
        if (turned < -0.01 && ac.star?.hold?.turningRight) leftTicks += 1;
      }
      expect(leftTicks, `${gateName} turned left in the hold`).toBe(0);
    }
  });

  it('keeps looping indefinitely', () => {
    const { ac, world } = arrival();
    pressHold(world, ac);
    flyToEstablished(world, ac);
    run(world, 1200);

    expect(ac.star!.hold).not.toBeNull();
    expect(ac.star).not.toBeNull();
  });

  it('flies a one-minute outbound leg', () => {
    const { ac, world } = arrival();
    pressHold(world, ac);
    flyToEstablished(world, ac);

    // Advance to the start of an outbound leg timer, then check it runs a minute.
    let guard = 0;
    while ((ac.star!.hold!.leg !== 'outbound' || ac.star!.hold!.legEndsAtS === 0) && guard < 4000) {
      run(world, 1);
      guard += 1;
    }
    const startedAtS = world.timeS;
    const endsAtS = ac.star!.hold!.legEndsAtS;
    while (ac.star!.hold!.leg === 'outbound' && world.timeS < endsAtS + 5) run(world, 1);

    expect(world.timeS - startedAtS).toBeGreaterThanOrEqual(HOLD_LEG_S - 2);
    expect(world.timeS - startedAtS).toBeLessThanOrEqual(HOLD_LEG_S + 2);
  });

  it('stays inside a few miles of the holding fix', () => {
    const { ac, world } = arrival();
    pressHold(world, ac);
    flyToEstablished(world, ac);
    const fixPosition = activeFix(ac.star!).position;

    let furthest = 0;
    for (let i = 0; i < 60; i += 1) {
      run(world, 10);
      furthest = Math.max(furthest, distance({ x: ac.x, y: ac.y }, fixPosition));
    }
    // A 230 kt racetrack with a 1 min leg is ~6 NM long; well short of runaway.
    expect(furthest).toBeLessThan(12);
  });
});

describe('leaving the holding pattern', () => {
  it('cancels outright when H is pressed before the fix is reached', () => {
    const { ac, world } = arrival();
    pressHold(world, ac);
    run(world, 5);
    expect(ac.star!.hold!.established).toBe(false);

    pressHold(world, ac);

    expect(ac.star!.hold).toBeNull();
    expect(ac.star).not.toBeNull(); // still on the arrival
  });

  it('completes the loop and rejoins the STAR when established', () => {
    const { ac, world } = arrival();
    pressHold(world, ac);
    flyToEstablished(world, ac);

    pressHold(world, ac);
    expect(ac.star!.hold).not.toBeNull(); // still finishing the loop
    expect(ac.star!.hold!.exitRequested).toBe(true);

    // It leaves at the next crossing of the fix, then carries on down the route.
    for (let i = 0; i < 60 && ac.star?.hold; i += 1) run(world, 10);
    expect(ac.star!.hold).toBeNull();

    const dtgBefore = ac.star!.route.waypoints[ac.star!.index]!.dtgNm;
    run(world, 120);
    expect(ac.star).not.toBeNull();
    // Sequencing has moved on down the route rather than staying at the fix.
    expect(ac.star!.route.waypoints[ac.star!.index]!.dtgNm).toBeLessThanOrEqual(dtgBefore);
  });

  it('resumes the published descent profile after the hold', () => {
    const { ac, world } = arrival();
    pressHold(world, ac);
    flyToEstablished(world, ac);
    pressHold(world, ac);
    for (let i = 0; i < 60 && ac.star?.hold; i += 1) run(world, 10);

    const altitudeAtExit = ac.altitudeFt;
    run(world, 180);

    expect(ac.altitudeFt).toBeLessThan(altitudeAtExit);
  });
});

describe('instructions while holding', () => {
  it('keeps the pattern when the altitude is changed', () => {
    const { ac, world } = arrival();
    pressHold(world, ac);
    flyToEstablished(world, ac);
    const startAltitude = ac.altitudeFt;

    adjustAltitude(world, ac, -1);
    pilotActs(world, ac);
    run(world, 120);

    expect(ac.star!.hold).not.toBeNull();
    expect(ac.altitudeFt).toBeLessThan(startAltitude);
  });

  it('keeps the pattern when the speed is changed', () => {
    const { ac, world } = arrival();
    pressHold(world, ac);
    flyToEstablished(world, ac);

    adjustSpeed(world, ac, -1);
    pilotActs(world, ac);
    run(world, 60);

    expect(ac.star!.hold).not.toBeNull();
    expect(ac.iasKts).toBeLessThan(HOLD_SPEED_KTS);
  });

  it('resumes the published profile after being stacked in the hold', () => {
    const { ac, world } = arrival('TEMBA');
    pressHold(world, ac);
    flyToEstablished(world, ac);

    // Stack it 3000 ft above the published holding level, then take it out.
    for (let i = 0; i < 3; i += 1) {
      adjustAltitude(world, ac, 1);
      pilotActs(world, ac);
      run(world, 20);
    }
    run(world, 600);
    expect(ac.star!.altitudeManual).toBe(true);

    pressHold(world, ac);
    for (let i = 0; i < 120 && ac.star?.hold; i += 1) run(world, 10);

    // A holding level is part of the pattern, not a standing assignment: the
    // published profile has to get the vertical back, or the aircraft flies the
    // rest of the arrival level at whatever it was stacked at.
    expect(ac.star!.altitudeManual).toBe(false);

    const atExit = ac.altitudeFt;
    run(world, 300);
    expect(ac.altitudeFt).toBeLessThan(atExit - 1000);
  });

  it('keeps an altitude assigned before the hold, which was never the profile to give back', () => {
    const { ac, world } = arrival('TEMBA');
    adjustAltitude(world, ac, -1);
    pilotActs(world, ac);
    run(world, 30);
    expect(ac.star!.altitudeManual).toBe(true);

    pressHold(world, ac);
    flyToEstablished(world, ac);
    pressHold(world, ac);
    for (let i = 0; i < 120 && ac.star?.hold; i += 1) run(world, 10);

    expect(ac.star!.altitudeManual).toBe(true);
  });

  it('descends onto the profile rather than snapping onto it', () => {
    const { ac, world } = arrival('TEMBA');
    pressHold(world, ac);
    flyToEstablished(world, ac);
    for (let i = 0; i < 3; i += 1) {
      adjustAltitude(world, ac, 1);
      pilotActs(world, ac);
      run(world, 20);
    }
    run(world, 600);
    pressHold(world, ac);

    // Nothing snaps (§4.3) — including the rejoin, which starts 3000 ft above
    // the profile and so cannot simply be written onto it.
    let previous = ac.altitudeFt;
    let worstJumpFt = 0;
    for (let i = 0; i < 24_000 && ac.star; i += 1) {
      run(world, PHYSICS_DT);
      worstJumpFt = Math.max(worstJumpFt, Math.abs(ac.altitudeFt - previous));
      previous = ac.altitudeFt;
    }
    // 2500 fpm, the steepest the energy budget allows, is ~2 ft per tick.
    expect(worstJumpFt).toBeLessThan(10);
  });

  it('leaves the pattern and the STAR when a heading is assigned', () => {
    const { ac, world } = arrival();
    pressHold(world, ac);
    flyToEstablished(world, ac);

    adjustHeading(world, ac, 1);
    pilotActs(world, ac);

    expect(ac.star).toBeNull();
  });

  it('refuses an ILS clearance until the aircraft leaves the hold', () => {
    const { ac, world } = arrival();
    pressHold(world, ac);
    flyToEstablished(world, ac);

    clearForIls(world, ac);

    expect(ac.phase).toBe('inbound');
    expect(world.messages.at(-1)!.text).toContain('in the hold');
  });
});
