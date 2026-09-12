/**
 * The handover ledger: what a center session leaves behind for the field below,
 * and what an approach session built from it flies (§15.0f).
 *
 * Bound to VABBA rather than to `helpers.ts`'s approach field, because the whole
 * subject is the seam between the two — and to VABBA rather than VABBS because
 * it is the sector whose agreements sum to the whole of what Mumbai accepts, so
 * its ledger is a complete arrival stream rather than a slice of one.
 */
import { describe, expect, it } from 'vitest';
import { SCENARIOS } from '../src/scenario/registry.js';
import type { Scenario } from '../src/scenario/types.js';
import { PHYSICS_DT } from '../src/sim/constants.js';
import { toggleHold } from '../src/sim/commands.js';
import { createRng } from '../src/sim/rng.js';
import {
  createArrival,
  createScriptedArrival,
  createTrafficState,
  scriptFrom,
  type Handoff,
} from '../src/sim/traffic.js';
import { bearing, distance, magnitude } from '../src/sim/units.js';
import { createWorld, step, type World } from '../src/sim/world.js';
import { resumeArrival } from '../src/sim/commands.js';
import { createRecording, sample } from '../src/replay/recorder.js';
import { worldAtFrame } from '../src/replay/playback.js';
import { pilotActs, run, silenceArrivals } from './helpers.js';

const AREA: Scenario = SCENARIOS.find((s) => s.id === 'VABBA')!;
const VABB: Scenario = SCENARIOS.find((s) => s.id === 'VABB')!;

/** A single arrival on a named route at its gate, in a sector with no other traffic. */
function soloOn(routeName: string): { world: World; ac: ReturnType<typeof createArrival> } {
  const route = AREA.stars.find((s) => s.name === routeName)!;
  const gate = AREA.gates.find((g) => g.name === route.gate)!;
  const world = createWorld(AREA, 11);
  silenceArrivals(world);
  const ac = createArrival(AREA, createRng(3), createTrafficState(), gate, [], 0);
  world.aircraft = [ac];
  world.messages = [];
  return { world, ac };
}

/** Fly a whole sector session and hand back what it recorded. */
function flownSession(seed: number, minutes: number): World {
  const world = createWorld(AREA, seed);
  for (let i = 0; i < (minutes * 60) / PHYSICS_DT; i += 1) step(world, PHYSICS_DT);
  return world;
}

describe('taking the ledger', () => {
  it('records exactly one row per delivery when nothing is vectored', () => {
    // The assertion that proves both halves are wired to the same aircraft: the
    // state is taken at the shared fix and committed at the last one, so a
    // session nobody touches must agree on the count. It is also what fails if
    // the capture ever drifts back to the route sequencer's index, which fires
    // a whole leg early and would commit rows for aircraft still to arrive.
    const world = flownSession(4242, 90);
    expect(world.stats.deliveries).toBeGreaterThan(10);
    expect(world.handedOn.length).toBe(world.stats.deliveries);
    expect(world.handedOn.every((row) => row.onRoute)).toBe(true);
  });

  it('names a gate the receiving field has, at the level that field expects', () => {
    const world = flownSession(4242, 90);
    for (const row of world.handedOn) {
      const gate = VABB.gates.find((g) => g.name === row.gateName);
      expect(gate, `${row.callsign} → ${row.gateName}`).toBeDefined();
      // Untouched traffic makes its published crossing good at the fix, and the
      // fix is the crossing the field below spawns on. Within a foot: `isPastFix`
      // tests a line, so the capture lands on the tick that crosses it.
      expect(Math.abs(row.altitudeFt - gate!.entryAltitudeFt), row.callsign).toBeLessThan(1);
      expect(Math.abs(row.iasKts - gate!.entrySpeedKts), row.callsign).toBeLessThan(1);
    }
  });

  it('carries the level the aircraft was actually given, not the chart\'s', () => {
    const world = flownSession(99, 90);
    const rows = world.handedOn;
    expect(rows.length).toBeGreaterThan(0);
    // Nothing here is a copy of the chart: every row is read off an aircraft.
    // Prove the field is live by moving one and watching the row follow.
    const { world: solo, ac } = soloOn(AREA.stars[0]!.name);
    run(solo, 5);
    ac.star!.altitudeManual = true;
    ac.targetAltitudeFt = 24_000;
    ac.altitudeFt = 24_000;
    for (let i = 0; i < (120 * 60) / PHYSICS_DT && solo.handedOn.length === 0; i += 1) {
      step(solo, PHYSICS_DT);
      ac.altitudeFt = 24_000;
      ac.targetAltitudeFt = 24_000;
    }
    expect(solo.handedOn.length).toBe(1);
    expect(solo.handedOn[0]!.altitudeFt).toBeCloseTo(24_000, 0);
  });

  it('leaves an aircraft holding at the shared fix out of it', () => {
    // A hold can carry an aircraft across the line the capture tests, but it has
    // not been handed to anyone — it is still this sector's, and the sector below
    // must never be told about it.
    const route = AREA.stars.find((s) => s.chart === 'MOLGO2A')!;
    const { world, ac } = soloOn(route.name);
    const merge = route.waypoints[route.waypoints.length - 2]!;

    // Fly it up to the shared fix, then hold there.
    for (let i = 0; i < (120 * 60) / PHYSICS_DT; i += 1) {
      step(world, PHYSICS_DT);
      if (distance({ x: ac.x, y: ac.y }, merge.position) < 12) break;
    }
    toggleHold(world, ac);
    pilotActs(world, ac);
    expect(ac.star?.hold).not.toBeNull();

    // Two full patterns' worth. The outbound leg crosses the capture line.
    run(world, 900);
    expect(ac.star?.hold).not.toBeNull();
    expect(world.handedOn).toEqual([]);
    expect(ac.pendingHandoff).toBeNull();
  });

  it('hands on an aircraft vectored into the terminal area, off its route', () => {
    // The consequence of a bad handover is meant to be paid downstream, so one
    // abandoned across the inner boundary is still handed on — without a route,
    // at the heading and level it was left on. It is a loss here all the same.
    const route = AREA.stars.find((s) => s.chart === 'MOLGO2A')!;
    const { world, ac } = soloOn(route.name);

    // Taken off its route and pointed at the field, which is what being left on a
    // vector and forgotten amounts to.
    ac.star = null;
    for (let i = 0; i < (120 * 60) / PHYSICS_DT && world.aircraft.length > 0; i += 1) {
      const inboundDeg = bearing({ x: ac.x, y: ac.y }, AREA.arp);
      ac.headingDeg = inboundDeg;
      ac.targetHeadingDeg = inboundDeg;
      step(world, PHYSICS_DT);
    }

    expect(world.handedOn.length).toBe(1);
    const row = world.handedOn[0]!;
    expect(row.onRoute).toBe(false);
    expect(world.stats.deliveryFaults.get('unsequenced')).toBe(1);
    expect(world.stats.exits).toBe(1);
    // Recorded where it actually was, which is the inner boundary and not a gate.
    expect(magnitude({ x: row.x, y: row.y })).toBeCloseTo(50, 0);
  });

  it('forgets an aircraft that passed the fix and was then lost outwards', () => {
    // Passing the shared fix is not the handover; crossing the last one is. A row
    // parked on an aircraft that leaves through the *outer* boundary is never
    // committed, or the field below would be scheduled an arrival that never came.
    const route = AREA.stars.find((s) => s.chart === 'MOLGO2A')!;
    const { world, ac } = soloOn(route.name);
    const merge = route.waypoints[route.waypoints.length - 2]!;

    for (let i = 0; i < (120 * 60) / PHYSICS_DT; i += 1) {
      step(world, PHYSICS_DT);
      if (ac.pendingHandoff !== null) break;
    }
    expect(ac.pendingHandoff).not.toBeNull();
    expect(distance({ x: ac.x, y: ac.y }, merge.position)).toBeLessThan(8);

    // Turn it round and fly it straight back out through the outer arc — radially,
    // since MOLGO is south of the field and "north" would take it across the
    // *inner* boundary instead, which is the other case entirely.
    ac.star = null;
    for (let i = 0; i < (120 * 60) / PHYSICS_DT && world.aircraft.length > 0; i += 1) {
      const outboundDeg = bearing(AREA.arp, { x: ac.x, y: ac.y });
      ac.headingDeg = outboundDeg;
      ac.targetHeadingDeg = outboundDeg;
      step(world, PHYSICS_DT);
    }
    expect(world.aircraft).toEqual([]);
    expect(world.stats.deliveries).toBe(0);
    expect(world.handedOn).toEqual([]);
  });
});

describe('flying the ledger as Approach', () => {
  /** A sector session's ledger, and the approach world built from it. */
  function approachFrom(seed: number, minutes: number): { script: Handoff[]; world: World } {
    const script = scriptFrom(flownSession(seed, minutes).handedOn);
    return { script, world: createWorld(VABB, 7, undefined, 0, script) };
  }

  it('releases every row, at its own gate, in the order it was handed over', () => {
    const { script, world } = approachFrom(4242, 60);
    expect(script.length).toBeGreaterThan(10);

    const seen: string[] = [];
    for (let i = 0; i < ((script.at(-1)!.atS + 60) / PHYSICS_DT); i += 1) {
      const before = new Set(world.aircraft.map((ac) => ac.id));
      step(world, PHYSICS_DT);
      for (const ac of world.aircraft) if (!before.has(ac.id)) seen.push(ac.callsign);
    }
    expect(seen).toEqual(script.map((row) => row.callsign));
    expect(world.traffic.nextScriptIndex).toBe(script.length);
  });

  it('flies the receiving field\'s own charts from the gate in', () => {
    // The end-to-end proof that a scripted spawn is an ordinary arrival: it joins
    // the STAR the gate feeds, descends on that field's profile, and runs the
    // route out. Nothing here is a center route — those ended 50 NM out.
    const { script, world } = approachFrom(4242, 30);
    const entryFt = new Map(VABB.gates.map((g) => [g.name, g.entryAltitudeFt]));
    const joined = new Set<number>();
    const ranTheRouteOut = new Set<number>();
    const descended = new Set<number>();

    for (let i = 0; i < (script.at(-1)!.atS + 1800) / PHYSICS_DT; i += 1) {
      step(world, PHYSICS_DT);
      for (const ac of world.aircraft) {
        if (ac.star) {
          // Whatever route it is on is one of *this* field's. The center routes
          // it came off ended fifty miles out and are not in this list.
          expect(VABB.stars.some((s) => s.name === ac.star!.route.name), ac.callsign).toBe(true);
          joined.add(ac.id);
        } else if (joined.has(ac.id)) {
          // `stepStar` drops the route at its last fix, which is where the
          // published coding ends and the queue becomes the player's job.
          ranTheRouteOut.add(ac.id);
        }
        if (ac.altitudeFt < entryFt.get(ac.entryGate)! - 500) descended.add(ac.id);
      }
    }
    expect(joined.size).toBeGreaterThan(0);
    expect(ranTheRouteOut.size).toBeGreaterThan(0);
    expect(descended.size).toBeGreaterThan(0);
  });

  it('preserves the spacing the center controller made', () => {
    const { script, world } = approachFrom(4242, 60);
    const appeared = new Map<string, number>();
    for (let i = 0; i < ((script.at(-1)!.atS + 60) / PHYSICS_DT); i += 1) {
      const before = new Set(world.aircraft.map((ac) => ac.id));
      step(world, PHYSICS_DT);
      for (const ac of world.aircraft) {
        if (!before.has(ac.id) && !appeared.has(ac.callsign)) appeared.set(ac.callsign, world.timeS);
      }
    }
    // Within one physics tick of the schedule: the release is checked per step,
    // so a row comes due at most `PHYSICS_DT` before it is acted on.
    for (const row of script) {
      expect(Math.abs(appeared.get(row.callsign)! - row.atS), row.callsign)
        .toBeLessThanOrEqual(PHYSICS_DT * 2);
    }
  });

  it('runs the generator not at all, whatever the flow is set to', () => {
    const { script, world } = approachFrom(4242, 30);
    world.flowPerHour = 50;
    for (let i = 0; i < (script.at(-1)!.atS + 600) / PHYSICS_DT; i += 1) step(world, PHYSICS_DT);
    // Everything that ever existed came off the schedule, and nothing else did.
    expect(world.traffic.nextScriptIndex).toBe(script.length);
    expect(world.stats.arrivalTimesS.length).toBeLessThanOrEqual(script.length);
    const names = new Set(script.map((row) => row.callsign));
    for (const ac of world.aircraft) expect(names.has(ac.callsign), ac.callsign).toBe(true);
  });

  it('goes quiet when the schedule runs out, rather than generating more', () => {
    const { script, world } = approachFrom(4242, 30);
    for (let i = 0; i < (script.at(-1)!.atS + 30) / PHYSICS_DT; i += 1) step(world, PHYSICS_DT);
    const released = world.traffic.nextScriptIndex;
    expect(released).toBe(script.length);
    run(world, 3600);
    expect(world.traffic.nextScriptIndex).toBe(released);
  });

  it('arrives high when it was handed over high, rather than on the chart', () => {
    const gate = VABB.gates.find((g) => g.name === 'MOLGO')!;
    const row = {
      atS: 5,
      callsign: 'AIC101',
      airline: VABB.airlines[0]!,
      type: VABB.fleet[0]!,
      gateName: 'MOLGO',
      onRoute: true,
      x: gate.position.x,
      y: gate.position.y,
      altitudeFt: gate.entryAltitudeFt + 2000,
      headingDeg: gate.inboundHeadingDeg,
      iasKts: gate.entrySpeedKts,
    };
    const ac = createScriptedArrival(VABB, createTrafficState(), row, 0);
    expect(ac.altitudeFt).toBe(gate.entryAltitudeFt + 2000);
    expect(ac.star).not.toBeNull();

    // And it stays above the chart it would otherwise have been written onto:
    // the raised run in converges by the entry fix instead of teleporting.
    const world = createWorld(VABB, 5, 0, 0);
    silenceArrivals(world);
    world.aircraft = [ac];
    run(world, 30);
    expect(ac.altitudeFt).toBeGreaterThan(gate.entryAltitudeFt);
  });

  it('holds its level when it was handed over low, and never climbs back up', () => {
    const gate = VABB.gates.find((g) => g.name === 'MOLGO')!;
    const row = {
      atS: 5,
      callsign: 'AIC102',
      airline: VABB.airlines[0]!,
      type: VABB.fleet[0]!,
      gateName: 'MOLGO',
      onRoute: true,
      x: gate.position.x,
      y: gate.position.y,
      altitudeFt: gate.entryAltitudeFt - 2000,
      headingDeg: gate.inboundHeadingDeg,
      iasKts: gate.entrySpeedKts,
    };
    const ac = createScriptedArrival(VABB, createTrafficState(), row, 0);
    expect(ac.star!.rejoining).toBe(-1);

    const world = createWorld(VABB, 5, 0, 0);
    silenceArrivals(world);
    world.aircraft = [ac];
    const startedAtFt = ac.altitudeFt;
    run(world, 60);
    expect(ac.altitudeFt).toBeLessThanOrEqual(startedAtFt + 1);
  });

  it('replays as a scripted session, so the flow control stays off', () => {
    // `departureQueue`'s rule: displayed, and not derivable from a rebuilt frame.
    // Without it a replay of an approach session shows a live Arr control over a
    // flow figure that never generated anything.
    const { world } = approachFrom(4242, 20);
    const rec = createRecording(VABB);
    for (let i = 0; i < 60 / PHYSICS_DT; i += 1) {
      step(world, PHYSICS_DT);
      sample(rec, world);
    }
    const replayed = worldAtFrame(rec, rec.lastFrame, {
      selectedId: null,
      paused: true,
      timeScale: 1,
    });
    expect(replayed.script).not.toBeNull();

    // And an ordinary session still replays as one.
    const live = createWorld(VABB, 3);
    const liveRec = createRecording(VABB);
    for (let i = 0; i < 60 / PHYSICS_DT; i += 1) {
      step(live, PHYSICS_DT);
      sample(liveRec, live);
    }
    expect(
      worldAtFrame(liveRec, liveRec.lastFrame, { selectedId: null, paused: true, timeScale: 1 })
        .script,
    ).toBeNull();
  });

  it('gives an unsequenced arrival its route back on request', () => {
    // It arrives with no STAR — that is the inheritance — but `R` must still have
    // something to offer, or it could only ever be hand-flown onto the localizer.
    const gate = VABB.gates.find((g) => g.name === 'MOLGO')!;
    const row = {
      atS: 5,
      callsign: 'AIC103',
      airline: VABB.airlines[0]!,
      type: VABB.fleet[0]!,
      gateName: 'MOLGO',
      onRoute: false,
      x: gate.position.x * 0.8,
      y: gate.position.y * 0.8,
      altitudeFt: gate.entryAltitudeFt,
      headingDeg: gate.inboundHeadingDeg,
      iasKts: gate.entrySpeedKts,
    };
    const ac = createScriptedArrival(VABB, createTrafficState(), row, 0);
    expect(ac.star).toBeNull();
    expect(ac.rejoin).not.toBeNull();
    expect(ac.entryGate).toBe('MOLGO');

    const world = createWorld(VABB, 5, 0, 0);
    silenceArrivals(world);
    world.aircraft = [ac];
    world.messages = [];
    // "Unable — no arrival to resume" is the refusal that must not happen. Being
    // told the current heading does not reach a leg is an ordinary answer, and
    // the one any vectored arrival gets until it is turned towards one.
    resumeArrival(world, ac);
    expect(world.messages.some((m) => /no arrival to resume/i.test(m.text))).toBe(false);
  });
});
