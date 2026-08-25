import { describe, expect, it } from 'vitest';
import { AIRPORT } from '../src/scenario/airport.js';
import type { Aircraft } from '../src/sim/aircraft.js';
import { adjustAltitude, adjustHeading, adjustSpeed, clearForIls, toggleHold } from '../src/sim/commands.js';
import { altitudeAheadFt, starProfileAt } from '../src/scenario/stars.js';
import {
  CEILING_FT,
  GATE_COOLDOWN_S,
  HOLD_LEG_S,
  HOLD_SPEED_KTS,
  PHYSICS_DT,
} from '../src/sim/constants.js';
import { createRng } from '../src/sim/rng.js';
import { activeFix } from '../src/sim/star.js';
import { createArrival, createTrafficState, trySpawn } from '../src/sim/traffic.js';
import { distance } from '../src/sim/units.js';
import { type World } from '../src/sim/world.js';
import { worldAtFrame } from '../src/replay/playback.js';
import { createRecording, sample } from '../src/replay/recorder.js';
import { stateTag } from '../src/render/trafficLayer.js';
import { step } from '../src/sim/world.js';
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

// ── The stack at an entry fix (§4.5) ────────────────────────────────────────

describe('delivering into a holding stack', () => {
  /** An aircraft parked in the pattern at `gate`'s entry fix, at `levelFt`. */
  function holdingAt(gateName: string, levelFt: number): Aircraft {
    const gate = AIRPORT.gates.find((candidate) => candidate.name === gateName)!;
    const ac = createArrival(createRng(5), createTrafficState(), gate, [], 0);
    const world = quietWorld(ac);
    pressHold(world, ac);
    flyToEstablished(world, ac);
    // Put it on the level the test wants, the way the controller would.
    ac.star!.altitudeManual = true;
    ac.targetAltitudeFt = levelFt;
    ac.altitudeFt = levelFt;
    return ac;
  }

  const deliver = (gateName: string, existing: readonly Aircraft[]): Aircraft => {
    const gate = AIRPORT.gates.find((candidate) => candidate.name === gateName)!;
    return createArrival(createRng(9), createTrafficState(), gate, existing, 0);
  };

  it('delivers on the published chart when nothing is holding', () => {
    const gate = AIRPORT.gates.find((candidate) => candidate.name === 'KOVAL')!;
    const fresh = deliver('KOVAL', []);
    expect(fresh.altitudeFt).toBe(gate.entryAltitudeFt);
    expect(fresh.star!.altitudes).toBe(fresh.star!.route.altitudes);
  });

  it('delivers 1000 ft above the highest aircraft in the stack', () => {
    const stack = [holdingAt('KOVAL', 8000), holdingAt('KOVAL', 9000), holdingAt('KOVAL', 10_000)];
    const entryFix = stack[0]!.star!.route.waypoints[1]!;
    expect(entryFix.name).toBe('NIVEL');

    const next = deliver('KOVAL', stack);
    expect(next.altitudeFt).toBe(11_000);
    // And it holds that level all the way to the fix rather than descending to
    // the published crossing on the way in.
    expect(altitudeAheadFt(next.star!.route, entryFix.dtgNm, next.star!.altitudes)).toBe(11_000);
  });

  it('leaves the chart alone past the entry fix', () => {
    const stack = [holdingAt('KOVAL', 10_000)];
    const next = deliver('KOVAL', stack);
    const route = next.star!.route;
    // BELGA and BOXAR are unchanged: the extra height is given back on the next
    // leg rather than carried down the whole arrival.
    for (const wpt of route.waypoints.slice(2)) {
      expect(starProfileAt(route, wpt.dtgNm, next.star!.altitudes).altitudeFt).toBe(
        wpt.altitudeFt,
      );
    }
  });

  it('counts only the stack at its own entry fix', () => {
    const stack = [holdingAt('KOVAL', 10_000)];
    // A different STAR, a different fix — VANDA's traffic is unaffected.
    const other = deliver('VANDA', stack);
    const gate = AIRPORT.gates.find((candidate) => candidate.name === 'VANDA')!;
    expect(other.altitudeFt).toBe(gate.entryAltitudeFt);
    expect(other.star!.altitudes).toBe(other.star!.route.altitudes);
  });

  it('stops delivering on that route once the stack reaches the ceiling', () => {
    const state = createTrafficState();
    const full = [holdingAt('KOVAL', CEILING_FT)];
    // Every gate is off cooldown, so KOVAL is only missing if the stack vetoed
    // it — checked by spawning many times and never seeing it.
    const rng = createRng(3);
    const gates = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const ac = trySpawn(rng, state, full, i * GATE_COOLDOWN_S);
      if (ac) gates.add(ac.entryGate);
    }
    expect(gates.has('KOVAL')).toBe(false);
    expect(gates.size).toBe(AIRPORT.gates.length - 1);
  });
});

// ── The data block while leaving (§4.6) ─────────────────────────────────────

describe('the HOLD tag', () => {
  const STRIKE = '̶';

  it('is struck through once the exit is instructed, and not before', () => {
    const { ac, world } = arrival('KOVAL');
    expect(stateTag(ac)).not.toContain('HOLD');

    pressHold(world, ac);
    flyToEstablished(world, ac);
    expect(stateTag(ac)).toBe('HOLD');

    pressHold(world, ac); // second press: leave at the next crossing
    expect(ac.star!.hold!.exitRequested).toBe(true);
    expect(stateTag(ac)).toBe([...'HOLD'].map((c) => c + STRIKE).join(''));
    // Same word, same letters — only the overlay is added.
    expect(stateTag(ac).replaceAll(STRIKE, '')).toBe('HOLD');
  });

  it('survives the round trip through a recording', () => {
    // The flag is displayed state that nothing in a rebuilt frame could infer,
    // so it has to be in the packed flags or a replay shows a plain HOLD.
    const { ac, world } = arrival('KOVAL');
    pressHold(world, ac);
    flyToEstablished(world, ac);
    pressHold(world, ac);

    const rec = createRecording();
    step(world, PHYSICS_DT);
    sample(rec, world);
    const rebuilt = worldAtFrame(rec, rec.lastFrame, {
      selectedId: null,
      paused: true,
      timeScale: 1,
    });

    const copy = rebuilt.aircraft.find((other) => other.id === ac.id)!;
    expect(copy.star?.hold?.exitRequested).toBe(true);
    expect(stateTag(copy)).toBe(stateTag(ac));
  });
});

// ── `H` is one toggle, not two instructions ─────────────────────────────────

describe('pressing H a third time', () => {
  it('takes back the exit and keeps the aircraft in the pattern', () => {
    const { ac, world } = arrival('KOVAL');
    pressHold(world, ac);
    flyToEstablished(world, ac);

    pressHold(world, ac);
    expect(ac.star!.hold!.exitRequested).toBe(true);

    // Never mind: still in the pattern, so this cancels the exit rather than
    // re-entering a hold it never left.
    pressHold(world, ac);
    expect(ac.star!.hold).not.toBeNull();
    expect(ac.star!.hold!.exitRequested).toBe(false);
    expect(world.messages.at(-1)!.text).toContain('continuing to hold');
    // And the tag goes back to a plain HOLD.
    expect(stateTag(ac)).toBe('HOLD');

    // It really does keep holding: a full lap later it is still there.
    run(world, HOLD_LEG_S * 4);
    expect(ac.star!.hold).not.toBeNull();
  });

  it('still leaves on the press after that', () => {
    const { ac, world } = arrival('KOVAL');
    pressHold(world, ac);
    flyToEstablished(world, ac);
    pressHold(world, ac); // leave
    pressHold(world, ac); // never mind
    pressHold(world, ac); // leave, for real this time
    expect(ac.star!.hold!.exitRequested).toBe(true);

    for (let elapsed = 0; elapsed < 900 && ac.star?.hold; elapsed += 10) run(world, 10);
    expect(ac.star!.hold).toBeNull();
  });

  it('enters again once the aircraft has actually left', () => {
    const { ac, world } = arrival('KOVAL');
    pressHold(world, ac);
    flyToEstablished(world, ac);
    pressHold(world, ac);
    for (let elapsed = 0; elapsed < 900 && ac.star?.hold; elapsed += 10) run(world, 10);
    expect(ac.star!.hold).toBeNull();

    pressHold(world, ac);
    expect(ac.star!.hold).not.toBeNull();
    expect(ac.star!.hold!.exitRequested).toBe(false);
  });
});
