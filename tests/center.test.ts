/**
 * The center sector: what it is graded on, and the geometry that makes it one.
 *
 * `helpers.ts` binds the *approach* field, so this file binds its own — the
 * conformance suite in `scenario.test.ts` is where anything true of every field
 * belongs, and everything here is about the one role.
 */
import { describe, expect, it } from 'vitest';
import { boundaryMarginNm, isInsideAirspace } from '../src/scenario/airspace.js';
import { SCENARIOS } from '../src/scenario/registry.js';
import { starForGate } from '../src/scenario/routes.js';
import { validateScenario } from '../src/scenario/validate.js';
import type { DeliveryGate, Scenario } from '../src/scenario/types.js';
import {
  DELIVERY_TRAIL_FLOOR_S,
  LONGEST_DELIVERY_WINDOW_S,
  PHYSICS_DT,
  SPEED_FLOOR_CENTER_KTS,
  SPEED_MAX_HIGH_KTS,
  SPEED_STEP_KTS,
} from '../src/sim/constants.js';
import {
  adjustSpeed,
  speedCeilingKts,
  speedFloorKts,
  toggleHold,
} from '../src/sim/commands.js';
import {
  agreedGapS,
  assessDelivery,
  deliveryPlan,
  deliveryWindows,
  destinationOf,
  gateReadyInS,
  routeOf,
  type DeliveryState,
} from '../src/sim/delivery.js';
import { createRng } from '../src/sim/rng.js';
import { pilotActs, silenceArrivals } from './helpers.js';
import { joinStar } from '../src/sim/star.js';
import {
  createArrival,
  createTrafficState,
  scheduleNextSpawn,
  streamFlowPerHour,
  streamStateFor,
  trySpawn,
} from '../src/sim/traffic.js';
import { distance, headingVector, magnitude, type Deg, type Nm } from '../src/sim/units.js';
import { createWorld, deliveryRatePerHour, step, type World } from '../src/sim/world.js';

const CENTER: Scenario = SCENARIOS.find((s) => s.id === 'VABBS')!;
const RCKT: DeliveryGate = CENTER.delivery.find((g) => g.fixName === 'RCKT')!;
const RCMG: DeliveryGate = CENTER.delivery.find((g) => g.fixName === 'RCMG')!;
/**
 * A four-minute agreement. Synthetic on purpose: the arithmetic is about the rule
 * and not about what Mumbai currently accepts, so retuning a field's rates must
 * not rewrite it.
 */
const FOUR_MINUTE_RATE = 15;
/**
 * A rate whose caps are far too wide to bind on anything a test seeds — 120 an
 * hour is 14 in six minutes — which is the only condition in which the in-trail
 * floor is the binding constraint. No field states anything like it; it is here
 * because the three clocks have to be testable one at a time.
 */
const BUSY_RATE = 120;
/**
 * The full ring's agreement, 31 an hour — the one shipped rate whose two caps
 * differ (5 and 7), which is what lets a test reach one window without the
 * other. VABBS's 14 makes them both 3.
 */
const AREA_RATE = 31;

/** The spacing state, defaulting to this field's agreement and an empty sector. */
function sectorState(over: Partial<DeliveryState> = {}): DeliveryState {
  return {
    ratePerHour: CENTER.agreedRatePerHour,
    recentSectorS: [],
    lastGateS: new Map(),
    ...over,
  };
}

/** A point at a bearing and range from the field, in the local frame. */
function at(bearingDeg: Deg, rangeNm: Nm) {
  const v = headingVector(bearingDeg);
  return { x: v.x * rangeNm, y: v.y * rangeNm };
}

/** An arrival on a named route, placed at its gate, in a world with no traffic. */
function arrivalOn(routeName: string): { world: World; ac: ReturnType<typeof createArrival> } {
  const route = CENTER.stars.find((s) => s.name === routeName)!;
  const gate = CENTER.gates.find((g) => g.name === route.gate)!;
  const world = createWorld(CENTER, 11);
  silenceArrivals(world);
  world.traffic.nextDepartureAtS = Number.POSITIVE_INFINITY;
  world.departureFlowPerHour = 0;
  const ac = createArrival(CENTER, createRng(3), createTrafficState(), gate, [], 0);
  world.aircraft = [ac];
  world.messages = [];
  return { world, ac };
}

describe('the sector airspace', () => {
  it('is a wedge: outside inside the inner arc, outside past the radials', () => {
    const { airspace } = CENTER;
    const shape = airspace.shape;
    if (shape.kind !== 'sector') throw new Error('VABBS should be a sector');

    // Down the middle of the wedge, between the two arcs.
    const middleDeg = (shape.fromDeg + shape.toDeg) / 2;
    expect(isInsideAirspace(airspace, at(middleDeg, 100))).toBe(true);
    // Inside the inner arc is the next sector's airspace, not this one's.
    expect(isInsideAirspace(airspace, at(middleDeg, shape.innerNm - 5))).toBe(false);
    // Past the outer arc is the next one out.
    expect(isInsideAirspace(airspace, at(middleDeg, airspace.radiusNm + 5))).toBe(false);
    // The whole northern half is somebody else's problem.
    expect(isInsideAirspace(airspace, at(0, 100))).toBe(false);
    expect(isInsideAirspace(airspace, at(shape.fromDeg - 20, 100))).toBe(false);
    expect(isInsideAirspace(airspace, at(shape.toDeg + 20, 100))).toBe(false);
    // The airport itself is not in its own en-route sector.
    expect(isInsideAirspace(airspace, CENTER.arp)).toBe(false);
  });

  it('measures the margin to whichever edge is nearest', () => {
    const shape = CENTER.airspace.shape;
    if (shape.kind !== 'sector') throw new Error('VABBS should be a sector');
    const middleDeg = (shape.fromDeg + shape.toDeg) / 2;
    // Ten miles outside the inner arc, a long way from everything else.
    expect(boundaryMarginNm(CENTER.airspace, at(middleDeg, shape.innerNm + 10))).toBeCloseTo(10, 5);
    // Ten miles inside the outer one.
    expect(boundaryMarginNm(CENTER.airspace, at(middleDeg, CENTER.airspace.radiusNm - 10)))
      .toBeCloseTo(10, 5);
    // Right on a radial, the margin is zero however far out it is.
    expect(boundaryMarginNm(CENTER.airspace, at(shape.fromDeg, 100))).toBeCloseTo(0, 5);
  });

  it('centres the scope on the wedge rather than on the airport', () => {
    // The field is in a corner of a sector that does not surround it, so a view
    // centred on the ARP would spend most of the canvas on empty ground.
    const { view } = CENTER.airspace;
    expect(Math.hypot(view.centre.x, view.centre.y)).toBeGreaterThan(20);
    // Every gate has to be inside the box the scope fits itself to.
    for (const gate of CENTER.gates) {
      expect(Math.abs(gate.position.x - view.centre.x), gate.name).toBeLessThanOrEqual(
        view.halfWidthNm + 1,
      );
      expect(Math.abs(gate.position.y - view.centre.y), gate.name).toBeLessThanOrEqual(
        view.halfHeightNm + 1,
      );
    }
  });
});

describe('the ring airspace', () => {
  const RING: Scenario = SCENARIOS.find((s) => s.id === 'VABBA')!;

  it('is a ring: inside at every bearing, outside only through the two arcs', () => {
    const { airspace } = RING;
    const shape = airspace.shape;
    if (shape.kind !== 'annulus') throw new Error('VABBA should be an annulus');

    // The difference from a wedge, and the whole point of the shape: there is no
    // bearing this sector does not own.
    for (let bearingDeg = 0; bearingDeg < 360; bearingDeg += 15) {
      expect(isInsideAirspace(airspace, at(bearingDeg, 100)), `${bearingDeg}`).toBe(true);
      expect(isInsideAirspace(airspace, at(bearingDeg, shape.innerNm - 5)), `${bearingDeg}`)
        .toBe(false);
      expect(isInsideAirspace(airspace, at(bearingDeg, airspace.radiusNm + 5)), `${bearingDeg}`)
        .toBe(false);
    }
    // Due north in particular: a `sector` spanning 000 to 360 has a seam there,
    // because its span is `normalizeHeading(360)` and that is zero.
    expect(isInsideAirspace(airspace, at(0, 100))).toBe(true);
    expect(isInsideAirspace(airspace, at(359.99, 100))).toBe(true);
    // The airport is still not in its own en-route sector.
    expect(isInsideAirspace(airspace, RING.arp)).toBe(false);
  });

  it('measures the margin to whichever arc is nearer, at every bearing', () => {
    const shape = RING.airspace.shape;
    if (shape.kind !== 'annulus') throw new Error('VABBA should be an annulus');
    for (const bearingDeg of [0, 90, 180, 270, 17, 313]) {
      expect(boundaryMarginNm(RING.airspace, at(bearingDeg, shape.innerNm + 10)), `${bearingDeg}`)
        .toBeCloseTo(10, 5);
      expect(
        boundaryMarginNm(RING.airspace, at(bearingDeg, RING.airspace.radiusNm - 10)),
        `${bearingDeg}`,
      ).toBeCloseTo(10, 5);
    }
    // A ring has no radial to be near, so nothing on the boundary reads as
    // near-exit — the bug a 000-to-360 wedge would have introduced silently, by
    // calling every point off due north outside.
    expect(boundaryMarginNm(RING.airspace, at(0, 100))).toBeGreaterThan(5);
  });

  it('centres the scope on the airport, because a ring is centred on it', () => {
    // The opposite of the wedge above, and the reason `Airspace.view` is derived
    // from the shape rather than declared per role.
    const { view } = RING.airspace;
    expect(Math.hypot(view.centre.x, view.centre.y)).toBeCloseTo(0, 6);
    for (const gate of RING.gates) {
      expect(Math.abs(gate.position.x - view.centre.x), gate.name)
        .toBeLessThanOrEqual(view.halfWidthNm);
      expect(Math.abs(gate.position.y - view.centre.y), gate.name)
        .toBeLessThanOrEqual(view.halfHeightNm);
    }
    // With room left over for the gate labels, which are drawn outside the ring.
    expect(view.halfWidthNm).toBeGreaterThan(RING.airspace.radiusNm);
  });

  it('takes an aircraft that reaches the inner arc off its route, as a wedge does', () => {
    // `checkSectorExit` is keyed on the shape, and the rule belongs to both en-route
    // shapes: a ring that read as a chorded circle here would lose the removal and
    // the `unsequenced` fault together, and nothing else would have noticed.
    const world = createWorld(RING, 5);
    silenceArrivals(world);
    const route = RING.stars.find((s) => s.name === 'IGBAN2A/AKTIV')!;
    const gate = RING.gates.find((g) => g.name === 'AKTIV')!;
    const ac = createArrival(RING, createRng(3), createTrafficState(), gate, [], 0);
    // Off its route, well inside the inner arc, tracking at the field.
    ac.star = null;
    ac.x = 0;
    ac.y = 20;
    ac.headingDeg = 180;
    world.aircraft = [ac];
    step(world, PHYSICS_DT);

    expect(world.aircraft).toHaveLength(0);
    expect(world.stats.exits).toBe(1);
    expect(world.stats.deliveryFaults.get('unsequenced')).toBe(1);
    expect(route.waypoints.at(-1)!.name).toBe('RCIG');
  });
});

describe('multi-entry routes', () => {
  it('flattens one chart into one route per way in, each re-carrying the trunk', () => {
    const ketor = CENTER.stars.filter((star) => star.chart === 'KETOR2A');
    expect(ketor).toHaveLength(6);
    for (const route of ketor) {
      // Unique name, shared chart — the mirror of a branching SID.
      expect(route.name.startsWith('KETOR2A/')).toBe(true);
      expect(route.chart).toBe('KETOR2A');
      // The trunk is carried again by every entry, so the sim only ever sees a
      // flat chain of waypoints.
      expect(route.waypoints.slice(-2).map((w) => w.name)).toEqual(['KETOR', 'RCKT']);
      // Waypoint 0 is the entry's own gate, at the entry's own crossing.
      expect(route.waypoints[0]!.name).toBe(route.gate);
    }
    // Each entry has a gate of its own; no two share one.
    expect(new Set(ketor.map((r) => r.gate)).size).toBe(6);
  });

  it('puts every entry onto one trunk in the same merge group', () => {
    for (const chart of ['KETOR2A', 'MOLGO2A']) {
      const names = CENTER.stars.filter((s) => s.chart === chart).map((s) => s.name);
      const group = CENTER.mergeGroups.find((g) => g.starNames.includes(names[0]!));
      expect(group, chart).toBeDefined();
      // Derived from the geometry, never declared: they share an identical tail
      // at identical levels, so they are one stream and are metered as one.
      expect([...group!.starNames].sort()).toEqual([...names].sort());
    }
  });

  it('gives each entry the level its own run in can lose', () => {
    for (const route of CENTER.stars) {
      const entry = route.waypoints[0]!;
      const end = route.waypoints[route.waypoints.length - 1]!;
      const gradient = (entry.altitudeFt! - end.altitudeFt!) / route.lengthNm;
      // A continuous descent, not a dive: under 250 ft/NM is comfortably inside
      // what a jet can fly while also slowing down.
      expect(gradient, route.name).toBeLessThan(250);
      expect(gradient, route.name).toBeGreaterThan(0);
    }
  });
});

describe('the delivery contract', () => {
  it('validates clean, and every route ends at a delivery gate', () => {
    expect(validateScenario(CENTER)).toEqual([]);
    for (const route of CENTER.stars) {
      const end = route.waypoints[route.waypoints.length - 1]!.name;
      expect(CENTER.delivery.some((g) => g.fixName === end), route.name).toBe(true);
    }
  });

  it('is bound by the sum of its gates, as a count over each window', () => {
    // The agreement the sector is graded against is the whole of what it feeds
    // the field below, derived and never authored.
    expect(CENTER.agreedRatePerHour).toBe(RCKT.targetRatePerHour + RCMG.targetRatePerHour);
    expect(agreedGapS(CENTER.agreedRatePerHour)).toBeCloseTo(3600 / 14, 5);

    // `floor(rate x window / 3600) + slack`, and the slack is what makes the
    // short window the lenient rule rather than a second copy of the strict one.
    expect(deliveryWindows(31)).toEqual([
      { windowS: 360, cap: 5 },
      { windowS: 720, cap: 7 },
    ]);
    expect(deliveryWindows(14)).toEqual([
      { windowS: 360, cap: 3 },
      { windowS: 720, cap: 3 },
    ]);
    expect(deliveryWindows(CENTER.agreedRatePerHour)).toEqual(deliveryWindows(14));

    // Two properties that have to hold at every rate a field could state: no cap
    // of none, and the short window never the stricter of the two.
    for (const ratePerHour of [1, 4, 14, 15, 31, 60, FOUR_MINUTE_RATE, BUSY_RATE]) {
      const [short, long] = deliveryWindows(ratePerHour);
      expect(short!.cap, `${ratePerHour}/h`).toBeGreaterThanOrEqual(1);
      expect(short!.cap / short!.windowS, `${ratePerHour}/h`).toBeGreaterThan(
        long!.cap / long!.windowS,
      );
    }
  });

  it('passes a delivery on profile, on level, on speed and inside the windows', () => {
    const { ac } = arrivalOn('KETOR2A/KABSO');
    const end = ac.star!.route.waypoints[ac.star!.route.waypoints.length - 1]!;
    ac.star!.index = ac.star!.route.waypoints.length - 1;
    ac.altitudeFt = end.altitudeFt!;
    ac.iasKts = end.speedKts!;
    const verdict = assessDelivery(
      RCKT,
      ac,
      sectorState({ recentSectorS: [0], lastGateS: new Map([['RCKT', 0]]) }),
      LONGEST_DELIVERY_WINDOW_S,
    );
    expect(verdict.faults).toEqual([]);
    expect(verdict.early).toBeNull();
    expect(verdict.gate).toBe('RCKT');
  });

  it('faults the one delivery too many inside a window, and only that one', () => {
    const { ac } = arrivalOn('KETOR2A/KABSO');
    const end = ac.star!.route.waypoints[ac.star!.route.waypoints.length - 1]!;
    ac.altitudeFt = end.altitudeFt!;
    ac.iasKts = end.speedKts!;
    // On the ring's 31 an hour, where the two caps differ (5 and 7) and the
    // short one can be filled on its own. This field's 14 makes them both 3, so
    // there is no seeding that reaches one without the other.
    const [short] = deliveryWindows(AREA_RATE);
    const full = Array.from({ length: short!.cap }, (_, i) => i * 30);
    const at = (atS: number) =>
      assessDelivery(RCKT, ac, sectorState({ ratePerHour: AREA_RATE, recentSectorS: full }), atS)
        .faults;
    // One more while they are all still inside six minutes: too many.
    expect(at(200)).toContain('early');
    // The window releases exactly when the cap-th oldest falls out of it, and not
    // a second before — the countdown and the fault line are the same instant.
    expect(at(full[0]! + short!.windowS - 1)).toContain('early');
    expect(at(full[0]! + short!.windowS)).not.toContain('early');
    // And a sector that has delivered nothing takes anyone.
    expect(assessDelivery(RCKT, ac, sectorState(), 60).faults).toEqual([]);
  });

  it('faults a level, a speed and a vector, each with its own reason', () => {
    const { ac } = arrivalOn('KETOR2A/KABSO');
    const end = ac.star!.route.waypoints[ac.star!.route.waypoints.length - 1]!;
    const clean = () => {
      ac.altitudeFt = end.altitudeFt!;
      ac.iasKts = end.speedKts!;
    };

    clean();
    ac.altitudeFt = end.altitudeFt! + 1500;
    expect(assessDelivery(RCKT, ac, sectorState(), 60).faults).toEqual(['level']);

    clean();
    ac.iasKts = end.speedKts! + 40;
    expect(assessDelivery(RCKT, ac, sectorState(), 60).faults).toEqual(['speed']);

    // Tolerances, not equalities: an aircraft 100 ft and 5 kt off is delivered.
    clean();
    ac.altitudeFt = end.altitudeFt! + 100;
    ac.iasKts = end.speedKts! - 5;
    expect(assessDelivery(RCKT, ac, sectorState(), 60).faults).toEqual([]);

    // Off the route entirely — the fault this position exists to prevent.
    clean();
    ac.star = null;
    expect(assessDelivery(RCKT, ac, sectorState(), 60).faults).toEqual(['unsequenced']);
  });

  it('lets two gates deliver in the same second, and caps the rate instead', () => {
    const { ac } = arrivalOn('MOLGO2A/AGELA');
    const end = ac.star!.route.waypoints[ac.star!.route.waypoints.length - 1]!;
    ac.altitudeFt = end.altitudeFt!;
    ac.iasKts = end.speedKts!;
    // Not a return to independent gates — the sector's capacity is still one
    // number. But a KETOR delivery and a MOLGO one ten seconds apart are sixty
    // miles apart on two routes at two published levels, and meet only at the
    // merge, which is Approach's problem and Approach's job. Nothing about the
    // pair costs the field below anything at the moment it happens.
    expect(assessDelivery(RCMG, ac, sectorState({ recentSectorS: [0] }), 10).faults).toEqual([]);

    // What the sector still owns is the rate, so the one past the cap is early
    // wherever it goes.
    const [short] = deliveryWindows(CENTER.agreedRatePerHour);
    const full = Array.from({ length: short!.cap }, (_, i) => i * 10);
    expect(assessDelivery(RCMG, ac, sectorState({ recentSectorS: full }), 60).faults).toContain(
      'early',
    );
  });

  it('takes a handover at every gate in the same second, and faults the next', () => {
    const { ac } = arrivalOn('MOLGO2A/AGELA');
    const end = ac.star!.route.waypoints[ac.star!.route.waypoints.length - 1]!;
    ac.altitudeFt = end.altitudeFt!;
    ac.iasKts = end.speedKts!;
    // The burst the model exists to permit: a handful of aircraft at a handful of
    // different fixes and levels, which Approach absorbs without noticing. The
    // cap is what says how big a handful — five on the ring's 31 an hour, which
    // is one at each of its gates. Synthetic fix names, because the assertion is
    // about counting and this field has two.
    const [short] = deliveryWindows(AREA_RATE);
    const gates = Array.from({ length: short!.cap + 1 }, (_, i) => ({
      ...RCMG,
      fixName: `RC${i}`,
    }));
    const recentSectorS: number[] = [];
    for (const [i, gate] of gates.entries()) {
      const state = sectorState({ ratePerHour: AREA_RATE, recentSectorS: [...recentSectorS] });
      const verdict = assessDelivery(gate, ac, state, 0);
      if (i < short!.cap) {
        expect(verdict.faults, `handover ${i}`).toEqual([]);
        recentSectorS.push(0);
      } else {
        // The one past the cap, at a fix of its own and in the same second.
        expect(verdict.faults).toContain('early');
        expect(verdict.early!.rule).toEqual({ kind: 'window', windowS: short!.windowS, cap: short!.cap });
      }
    }
  });

  it('lets the long window bite on a stream the short one never sees', () => {
    const { ac } = arrivalOn('KETOR2A/KABSO');
    const end = ac.star!.route.waypoints[ac.star!.route.waypoints.length - 1]!;
    ac.altitudeFt = end.altitudeFt!;
    ac.iasKts = end.speedKts!;
    // The test that says why there are two rules. At VABBA's 31/h the short cap
    // is 5 in six minutes, which a steady four-every-six-minutes never reaches —
    // but four every six is eight every twelve, against a long cap of 7.
    const [short, long] = deliveryWindows(AREA_RATE);
    const perShort = short!.cap - 1;
    const recentSectorS: number[] = [];
    for (let i = 0; i < perShort * 2; i += 1) {
      recentSectorS.push(Math.floor(i / perShort) * short!.windowS + (i % perShort) * 20);
    }
    const state: DeliveryState = {
      ratePerHour: AREA_RATE,
      recentSectorS,
      lastGateS: new Map(),
    };
    const atS = recentSectorS[recentSectorS.length - 1]! + 30;
    // The short window has room: only `perShort` of them are inside it.
    expect(
      recentSectorS.filter((t) => t > atS - short!.windowS).length,
    ).toBeLessThan(short!.cap);
    const verdict = assessDelivery(RCKT, ac, state, atS);
    expect(verdict.faults).toContain('early');
    expect(verdict.early!.rule).toEqual({ kind: 'window', windowS: long!.windowS, cap: long!.cap });
  });

  it('delivers a line down one STAR, so long as the sector rate holds', () => {
    const { ac } = arrivalOn('KETOR2A/KABSO');
    const end = ac.star!.route.waypoints[ac.star!.route.waypoints.length - 1]!;
    ac.altitudeFt = end.altitudeFt!;
    ac.iasKts = end.speedKts!;
    // Five into RCKT with nothing at any other gate. Under a per-gate agreement
    // RCKT asked for fifteen minutes between them and four of these were faults,
    // while the sector handed Approach a third of what it had agreed to take.
    const [, long] = deliveryWindows(CENTER.agreedRatePerHour);
    const gapS = long!.windowS / long!.cap + 1;
    const recentSectorS: number[] = [];
    const lastGateS = new Map<string, number>();
    let atS = 0;
    for (let i = 0; i < 5; i += 1) {
      const state = sectorState({
        recentSectorS: [...recentSectorS],
        lastGateS: new Map(lastGateS),
      });
      expect(assessDelivery(RCKT, ac, state, atS).faults, `delivery ${i}`).toEqual([]);
      recentSectorS.push(atS);
      lastGateS.set('RCKT', atS);
      atS += gapS;
    }
    // At a spacing the in-trail floor also allows, since they all went to one fix.
    expect(gapS).toBeGreaterThan(DELIVERY_TRAIL_FLOOR_S);
  });

  it('faults a second delivery at one fix inside the in-trail floor, with the windows wide open', () => {
    const { ac } = arrivalOn('KETOR2A/KABSO');
    const end = ac.star!.route.waypoints[ac.star!.route.waypoints.length - 1]!;
    ac.altitudeFt = end.altitudeFt!;
    ac.iasKts = end.speedKts!;
    // One delivery in the series and a cap of fourteen: the windows bind nothing,
    // so the floor is unambiguously the only constraint left.
    const busy: DeliveryState = {
      ratePerHour: BUSY_RATE,
      recentSectorS: [0],
      lastGateS: new Map([['RCKT', 0]]),
    };
    const early = assessDelivery(RCKT, ac, busy, DELIVERY_TRAIL_FLOOR_S - 1);
    expect(early.faults).toContain('early');
    expect(early.early!.rule.kind).toBe('trail');
    expect(assessDelivery(RCKT, ac, busy, DELIVERY_TRAIL_FLOOR_S).faults).not.toContain('early');
    // The same instant at the other gate is clean: it is spacing in trail, not a
    // second rate.
    expect(assessDelivery(RCMG, ac, busy, DELIVERY_TRAIL_FLOOR_S - 1).faults).toEqual([]);
  });

  it('ignores a delivery that has fallen out of the longest window', () => {
    const { ac } = arrivalOn('KETOR2A/KABSO');
    const end = ac.star!.route.waypoints[ac.star!.route.waypoints.length - 1]!;
    ac.altitudeFt = end.altitudeFt!;
    ac.iasKts = end.speedKts!;
    // Trimming the series is a memory concern and never a correctness one: a
    // stale entry simply loses the `max`, which is what lets `deliveryBound` be
    // written without being told the time at all.
    const [short] = deliveryWindows(CENTER.agreedRatePerHour);
    const stale = Array.from({ length: short!.cap }, (_, i) => -10_000 + i * 30);
    expect(assessDelivery(RCKT, ac, sectorState({ recentSectorS: stale }), 0).faults).toEqual([]);
  });
});

describe('the gate countdown', () => {
  it('stays open until a window is full, then counts that window down', () => {
    // Nothing delivered anywhere yet: the sector will take anyone, and the clock
    // has nothing to count from.
    expect(gateReadyInS('RCKT', sectorState(), 0)).toBeNull();

    const [short] = deliveryWindows(AREA_RATE);
    // One delivery no longer closes anything — the agreement is a rate, and one
    // aircraft is not a rate.
    expect(gateReadyInS('RCKT', sectorState({ recentSectorS: [0] }), 10)).toBe(0);

    // A cap's worth of them does, and what it counts down to is the moment the
    // oldest of them falls out of the window.
    const full = Array.from({ length: short!.cap }, (_, i) => i * 20);
    const state = sectorState({ ratePerHour: AREA_RATE, recentSectorS: full });
    const opensAtS = full[0]! + short!.windowS;
    expect(gateReadyInS('RCKT', state, 100)).toBeCloseTo(opensAtS - 100, 5);
    expect(gateReadyInS('RCKT', state, opensAtS)).toBe(0);
    expect(gateReadyInS('RCKT', state, opensAtS + 600)).toBe(0);
  });

  it('counts every gate down against the sector windows, taken one or not', () => {
    // The windows are the sector's, so a gate that has taken nothing waits with
    // the rest: the capacity being handed on is one number, and it is not RCMG's
    // to spend just because RCKT spent the last of it.
    const [short] = deliveryWindows(AREA_RATE);
    const full = Array.from({ length: short!.cap }, (_, i) => i * 20);
    const state = sectorState({
      ratePerHour: AREA_RATE,
      recentSectorS: full,
      lastGateS: new Map([['RCKT', full.at(-1)!]]),
    });
    const atS = full.at(-1)! + DELIVERY_TRAIL_FLOOR_S + 1;
    expect(gateReadyInS('RCKT', state, atS)).toBeCloseTo(full[0]! + short!.windowS - atS, 5);
    expect(gateReadyInS('RCMG', state, atS)).toBeCloseTo(gateReadyInS('RCKT', state, atS)!, 5);
  });

  it('holds one gate longer only where that fix has just taken a delivery', () => {
    // The in-trail floor is the whole of what is still per gate, and it shows
    // only where the windows have room — which at a real field is most of the
    // time, since the caps are counted over minutes.
    const busy: DeliveryState = {
      ratePerHour: BUSY_RATE,
      recentSectorS: [0],
      lastGateS: new Map([['RCKT', 0]]),
    };
    expect(gateReadyInS('RCKT', busy, 100)).toBeCloseTo(DELIVERY_TRAIL_FLOOR_S - 100, 5);
    expect(gateReadyInS('RCMG', busy, 100)).toBe(0);
  });

  it('opens exactly when the delivery stops being early, on all three clocks', () => {
    // With no tolerance left anywhere, the countdown and the fault line are the
    // same instant rather than a few seconds apart — so `0:00` can be read as an
    // instruction. This is the equivalence the old rule could only hold in one
    // direction.
    const { ac } = arrivalOn('KETOR2A/KABSO');
    const end = ac.star!.route.waypoints[ac.star!.route.waypoints.length - 1]!;
    ac.altitudeFt = end.altitudeFt!;
    ac.iasKts = end.speedKts!;
    for (const ratePerHour of [CENTER.agreedRatePerHour, 31, BUSY_RATE]) {
      const [short, long] = deliveryWindows(ratePerHour);
      for (const recentSectorS of [
        [] as number[],
        [0],
        Array.from({ length: short!.cap }, (_, i) => i * 20),
        Array.from({ length: long!.cap }, (_, i) => i * 60),
      ]) {
        for (const lastGateS of [new Map<string, number>(), new Map([['RCKT', 0]])]) {
          const state: DeliveryState = { ratePerHour, recentSectorS, lastGateS };
          const readyInS = gateReadyInS('RCKT', state, 0);
          for (const atS of [
            0,
            60,
            DELIVERY_TRAIL_FLOOR_S - 1,
            DELIVERY_TRAIL_FLOOR_S,
            short!.windowS - 1,
            short!.windowS,
            long!.windowS,
            (readyInS ?? 0) - 1,
            readyInS ?? 0,
          ]) {
            const open = (gateReadyInS('RCKT', state, atS) ?? 0) === 0;
            const early = assessDelivery(RCKT, ac, state, atS).faults.includes('early');
            expect(open, `at ${atS} s on ${ratePerHour}/h with ${recentSectorS.length} recent`).toBe(
              !early,
            );
          }
        }
      }
    }
  });
});

describe('speed control in the cruise', () => {
  it('will not slow an aircraft below what it can fly at this level', () => {
    const { world, ac } = arrivalOn('KETOR2A/KABSO');
    // The approach floors are measured from a threshold this aircraft is 145 NM
    // from and will never reach, so they would answer a flat 180 kt at FL370.
    expect(speedFloorKts(CENTER.runway, ac, CENTER.role)).toBe(SPEED_FLOOR_CENTER_KTS);
    expect(speedFloorKts(CENTER.runway, ac, 'approach')).toBeLessThan(SPEED_FLOOR_CENTER_KTS);

    // Stepped down from the 280 it enters on, it stops at the floor and says so.
    ac.targetIasKts = SPEED_FLOOR_CENTER_KTS + SPEED_STEP_KTS;
    ac.star!.speedManual = true;
    adjustSpeed(world, ac, -1);
    pilotActs(world, ac);
    expect(ac.targetIasKts).toBe(SPEED_FLOOR_CENTER_KTS);

    world.messages = [];
    adjustSpeed(world, ac, -1);
    expect(ac.pending.some((p) => p.instruction.kind === 'speed')).toBe(false);
    expect(world.messages.at(-1)!.text).toContain(`${SPEED_FLOOR_CENTER_KTS} kt is the minimum`);
  });

  it('lets the cruise speeds it is handed be assigned back', () => {
    // Every route enters at 280, which the 250 kt terminal ceiling would have
    // made unassignable — the aircraft could be slowed and never sped up again.
    const { world, ac } = arrivalOn('MOLGO2A/AGELA');
    expect(speedCeilingKts(ac)).toBe(SPEED_MAX_HIGH_KTS);
    ac.targetIasKts = 280;
    ac.star!.speedManual = true;
    adjustSpeed(world, ac, 1);
    pilotActs(world, ac);
    expect(ac.targetIasKts).toBe(290);
  });
});

describe('the metering deficit', () => {
  it('accumulates down a queue rather than being read pairwise', () => {
    // Three aircraft two minutes apart, all to one fix, against a three-minute
    // in-trail floor: they owe one, two and three minutes, not one minute each.
    // The chain here is the fix's own — the windows are counted over minutes and
    // three aircraft do not fill one — which is what makes it the clean case for
    // the accumulation itself.
    const world = createWorld(CENTER, 5);
    silenceArrivals(world);
    world.traffic.nextDepartureAtS = Number.POSITIVE_INFINITY;
    const route = CENTER.stars.find((s) => s.name === 'KETOR2A/KABSO')!;
    const gate = CENTER.gates.find((g) => g.name === 'KABSO')!;
    const made: ReturnType<typeof createArrival>[] = [];
    // One traffic state across all three: it is what issues the ids, and three
    // aircraft sharing id 1 collapse into one entry in the plan.
    const state = createTrafficState();
    for (let i = 0; i < 3; i += 1) {
      const ac = createArrival(CENTER, createRng(i + 1), state, gate, made, 0);
      ac.star = joinStar(route);
      // Space them along the route so their estimates differ by roughly two
      // minutes: at 280 kt IAS that is about nine miles.
      ac.star.index = route.waypoints.length - 1;
      const end = route.waypoints[route.waypoints.length - 1]!;
      const back = 6 + i * 9;
      ac.x = end.position.x - back;
      ac.y = end.position.y;
      made.push(ac);
    }
    world.aircraft = made;

    const slots = deliveryPlan(CENTER.delivery, made, sectorState(), 0);
    expect(slots.size).toBe(3);
    const deficits = made.map((ac) => slots.get(ac.id)!.deficitS);
    // The first has nothing ahead of it, so nothing to lose.
    expect(deficits[0]!).toBeLessThanOrEqual(0);
    // Each one after owes strictly more than the one in front.
    expect(deficits[1]!).toBeGreaterThan(0);
    expect(deficits[2]!).toBeGreaterThan(deficits[1]!);
  });

  it('freezes a slot once the aircraft is close enough for the order to matter', () => {
    // KABSO's is the longest way in at 145 NM, so it is the one route that
    // actually starts outside the horizon — BISET's whole 120 is inside it.
    const { world, ac } = arrivalOn('KETOR2A/KABSO');
    const slots = deliveryPlan(CENTER.delivery, world.aircraft, sectorState(), 0);
    // Just handed over at the boundary, with the whole route still to run.
    expect(slots.get(ac.id)!.frozen).toBe(false);
    ac.star!.index = ac.star!.route.waypoints.length - 1;
    const end = ac.star!.route.waypoints[ac.star!.route.waypoints.length - 1]!;
    ac.x = end.position.x - 10;
    ac.y = end.position.y;
    expect(
      deliveryPlan(CENTER.delivery, world.aircraft, sectorState(), 0).get(ac.id)!.frozen,
    ).toBe(true);
  });

  it('slots the next arrival against what the sector has already handed on', () => {
    const { world, ac } = arrivalOn('KETOR2A/KABSO');
    const [short] = deliveryWindows(CENTER.agreedRatePerHour);
    // A window filled to its cap; move the oldest of them and the slot behind it
    // moves with it, because that is the one whose falling out of the window
    // releases the next delivery.
    const plan = (offsetS: number) => {
      const recentSectorS = Array.from({ length: short!.cap }, (_, i) => offsetS + i * 20);
      return deliveryPlan(CENTER.delivery, world.aircraft, sectorState({ recentSectorS }), 0).get(
        ac.id,
      )!;
    };
    // The estimate is the aircraft's and does not move; the slot it is measured
    // against does, by exactly as much as the window did.
    expect(plan(30).etaS).toBeCloseTo(plan(0).etaS, 5);
    expect(plan(30).deficitS - plan(0).deficitS).toBeCloseTo(30, 5);
  });

  it('plans a burst clean, and paces what comes after it', () => {
    // Two arrivals to different fixes, a minute apart on estimate, in a sector
    // that has handed on nothing. Both are free: they are on two routes at two
    // levels sixty miles apart, and the agreement is a rate rather than a queue
    // discipline. Fill the windows first and the second one is pushed — by the
    // sector's own count, not by the aircraft in front of it.
    const world = createWorld(CENTER, 7);
    silenceArrivals(world);
    world.traffic.nextDepartureAtS = Number.POSITIVE_INFINITY;
    const state = createTrafficState();
    const made: ReturnType<typeof createArrival>[] = [];
    for (const [routeName, back] of [
      ['KETOR2A/KABSO', 6],
      ['MOLGO2A/AGELA', 12],
    ] as const) {
      const route = CENTER.stars.find((s) => s.name === routeName)!;
      const gate = CENTER.gates.find((g) => g.name === route.gate)!;
      const ac = createArrival(CENTER, createRng(back), state, gate, made, 0);
      ac.star = joinStar(route);
      ac.star.index = route.waypoints.length - 1;
      const end = route.waypoints[route.waypoints.length - 1]!;
      ac.x = end.position.x - back;
      ac.y = end.position.y;
      made.push(ac);
    }
    world.aircraft = made;
    expect(destinationOf(made[0]!)).toBe('RCKT');
    expect(destinationOf(made[1]!)).toBe('RCMG');

    const clean = deliveryPlan(CENTER.delivery, made, sectorState(), 0);
    expect(clean.get(made[0]!.id)!.deficitS).toBeLessThanOrEqual(0);
    expect(clean.get(made[1]!.id)!.deficitS).toBeLessThanOrEqual(0);

    const [short] = deliveryWindows(CENTER.agreedRatePerHour);
    const full = Array.from({ length: short!.cap }, (_, i) => i * 20);
    const busy = deliveryPlan(CENTER.delivery, made, sectorState({ recentSectorS: full }), 0);
    expect(busy.get(made[0]!.id)!.deficitS).toBeGreaterThan(0);
    // And the one behind it is slotted strictly later, the chain having spent a
    // slot on the first — even though they are going to different fixes. Read as
    // slot times rather than deficits, since a deficit is signed against the
    // aircraft's own estimate and these two are a minute apart.
    const slotS = (id: number) => busy.get(id)!.deficitS + busy.get(id)!.etaS;
    expect(slotS(made[1]!.id)).toBeGreaterThan(slotS(made[0]!.id));
  });

  it('knows which stream an aircraft belongs to, on the route or off it', () => {
    const { ac } = arrivalOn('MOLGO2A/EPKOS');
    expect(destinationOf(ac)).toBe('RCMG');
    // Vectored off, the route is remembered rather than dropped, so the stream
    // it belongs to is still known — which is what `R` gives back.
    const route = routeOf(ac);
    ac.rejoin = { nav: ac.star!, leg: null };
    ac.star = null;
    expect(routeOf(ac)).toBe(route);
    expect(destinationOf(ac)).toBe('RCMG');
  });
});

describe('flying the sector', () => {
  it('delivers arrivals to both gates and counts what it got', () => {
    const world = createWorld(CENTER, 4242);
    for (let i = 0; i < (90 * 60) / PHYSICS_DT; i += 1) step(world, PHYSICS_DT);

    expect(world.stats.deliveries).toBeGreaterThan(10);
    // Both streams run: a sector that only ever feeds one gate is not metering.
    for (const gate of CENTER.delivery) {
      expect(world.stats.deliveryTimesS.get(gate.fixName)?.length ?? 0, gate.fixName)
        .toBeGreaterThan(0);
      expect(deliveryRatePerHour(world, gate.fixName), gate.fixName).not.toBeNull();
    }
    // Left alone, the autopilot delivers whatever the generator offered, so the
    // agreement is broken repeatedly — which is the problem the player is for.
    expect(world.stats.deliveryFaults.get('early') ?? 0).toBeGreaterThan(0);
    // But never off its procedure: nothing vectors an aircraft here but a player.
    expect(world.stats.deliveryFaults.get('unsequenced') ?? 0).toBe(0);
  });

  it('gives every entry a holding fix 50 NM before its merge fix', () => {
    // A transition runs from the boundary to the merge fix, and without one of
    // these there is nothing publishing a level in between — KABSO's leg alone
    // is 135 NM. The level is the profile's own interpolated value there rounded
    // up to a thousand, re-derived here rather than restated, so moving a gate or
    // a fix fails loudly instead of drifting the fix off its own profile.
    for (const star of CENTER.stars) {
      const merge = star.waypoints[star.waypoints.length - 2]!;
      const held = star.waypoints.filter(
        (w) => w.name.startsWith('RC') && w.name !== merge.name && w !== star.waypoints.at(-1),
      );
      // AGELA is the exception: BEDOL is a published fix on its long leg already,
      // which is what the other seven are imitating.
      if (star.name === 'MOLGO2A/AGELA') {
        expect(held).toHaveLength(0);
        continue;
      }
      expect(held, star.name).toHaveLength(1);

      const fix = held[0]!;
      const index = star.waypoints.indexOf(fix);
      const before = star.waypoints[index - 1]!;
      expect(distance(fix.position, merge.position), star.name).toBeCloseTo(50, 1);

      const legNm = distance(before.position, merge.position);
      const alongNm = distance(before.position, fix.position);
      const interpolated =
        before.altitudeFt! + ((merge.altitudeFt! - before.altitudeFt!) * alongNm) / legNm;
      expect(fix.altitudeFt, star.name).toBe(Math.ceil(interpolated / 1000) * 1000);
      // And it still descends through it: rounding up must not lift the fix above
      // the level the aircraft arrives on.
      expect(fix.altitudeFt!, star.name).toBeLessThanOrEqual(before.altitudeFt!);
      expect(fix.altitudeFt!, star.name).toBeGreaterThanOrEqual(merge.altitudeFt!);
    }
  });

  it('can hold an arrival that has only just been handed over', () => {
    // The point of the seven: `toggleHold` anchors the pattern on the next fix
    // publishing a level, so before they existed an aircraft at the boundary
    // owing two minutes had to fly most of the sector before it could be held —
    // by which time the hold is the wrong tool.
    for (const star of CENTER.stars) {
      const { world, ac } = arrivalOn(star.name);
      toggleHold(world, ac);
      pilotActs(world, ac);
      expect(ac.star!.hold, star.name).not.toBeNull();

      // And it holds well out, not at the merge fix the whole sector converges on.
      const at = ac.star!.route.waypoints.find((w) => w.name === ac.star!.hold!.fix)!;
      expect(distance(at.position, ac.star!.route.waypoints.at(-1)!.position), star.name)
        .toBeGreaterThan(30);
    }
  });

  it('never lets one stream starve another, however the draws fall', () => {
    // The failure this replaced, and the reason streams exist: a single weighted
    // draw over every gate stalled the sector whenever it picked a gate inside
    // its cooldown, so KETOR's six gates could go 35 minutes without an arrival
    // while MOLGO's two took ten. Measured, that was 12 sessions in 200; per
    // stream it is none, because a stream can only ever block itself.
    const MOLGO = new Set(['AGELA', 'EPKOS']);
    let starved = 0;
    const SESSIONS = 40;
    for (let seed = 0; seed < SESSIONS; seed += 1) {
      const world = createWorld(CENTER, seed * 7919 + 13);
      world.flowPerHour = CENTER.traffic.arrivalsPerHour;
      world.departureFlowPerHour = 0;
      const seen = new Set<number>();
      let ketor = 0;
      let molgo = 0;
      for (let i = 0; i < 35 * 60 * 20; i += 1) {
        step(world, 0.05);
        for (const ac of world.aircraft) {
          if (!ac.star || seen.has(ac.id)) continue;
          seen.add(ac.id);
          if (MOLGO.has(ac.entryGate!)) molgo += 1;
          else ketor += 1;
        }
      }
      if (ketor === 0 || molgo === 0) starved += 1;
    }
    expect(starved).toBe(0);
  });

  it('meters each stream on its own clock, at the share its agreement declares', () => {
    // One clock per stream, so a gate inside its cooldown delays its own stream
    // and nobody else's. A single clock over every gate let the busiest stream
    // stall the sector: KETOR's six gates went 35 minutes without an arrival
    // while MOLGO's two took ten, because every draw MOLGO won held the whole
    // sector until MOLGO was free again.
    const rng = createRng(7);
    const state = createTrafficState();
    const tally = new Map<string, number>();
    const gateTally = new Map<string, number>();
    const HOURS = 100;
    const flow = CENTER.traffic.arrivalsPerHour;

    // Each stream runs its own loop, which is exactly how `spawnArrivals` drives
    // them: they share only the cooldown map and the id counter.
    for (const stream of CENTER.arrivalStreams) {
      const clock = streamStateFor(state, stream);
      const streamFlow = streamFlowPerHour(CENTER, stream, flow);
      let t = 0;
      scheduleNextSpawn(clock, rng, 0, t, streamFlow);
      while (t < HOURS * 3600) {
        t = Math.max(t, clock.nextSpawnAtS);
        const dueS = clock.nextSpawnAtS;
        // No aircraft in the sector, so the proximity veto and the holding stack
        // are out of it and this is the weights against the cooldowns alone.
        let ac = trySpawn(CENTER, stream, rng, state, [], t);
        for (let waited = 0; ac === null && waited < 3600; waited += 1) {
          t += 1;
          ac = trySpawn(CENTER, stream, rng, state, [], t);
        }
        if (ac) {
          const fix = ac.star!.route.waypoints[ac.star!.route.waypoints.length - 1]!.name;
          tally.set(fix, (tally.get(fix) ?? 0) + 1);
          gateTally.set(ac.entryGate!, (gateTally.get(ac.entryGate!) ?? 0) + 1);
        }
        // From the time it was *due*: a held handover is late, not cancelled, or
        // the flow the player asked for quietly becomes a lower one.
        scheduleNextSpawn(clock, rng, dueS, t, streamFlow);
      }
    }

    const total = [...tally.values()].reduce((sum, n) => sum + n, 0);
    // The rate asked for is the rate offered, within the spawn floor's rounding.
    expect(total / HOURS).toBeGreaterThan(flow * 0.95);

    // Each stream is offered its agreement's share of the flow, which is the
    // whole point of metering per stream: a sector fed in proportions other than
    // the ones it has promised to hand on cannot satisfy both agreements.
    const shareTotal = CENTER.arrivalStreams.reduce((sum, st) => sum + st.share, 0);
    for (const stream of CENTER.arrivalStreams) {
      const fix = starForGate(CENTER, stream.gateNames[0]!)!.waypoints.at(-1)!.name;
      expect(Math.abs((tally.get(fix) ?? 0) / total - stream.share / shareTotal), fix)
        .toBeLessThan(0.02);
    }

    // And *within* a stream the gates keep the ratios the field declares —
    // splitting the draw in two must not have changed a single published weight.
    for (const stream of CENTER.arrivalStreams) {
      const inStream = stream.gateNames.reduce((sum, name) => sum + (gateTally.get(name) ?? 0), 0);
      const weightTotal = stream.gateNames.reduce(
        (sum, name) => sum + CENTER.gates.find((g) => g.name === name)!.weight,
        0,
      );
      for (const name of stream.gateNames) {
        const weight = CENTER.gates.find((g) => g.name === name)!.weight;
        expect(Math.abs((gateTally.get(name) ?? 0) / inStream - weight / weightTotal), name)
          .toBeLessThan(0.03);
      }
    }
  });

  it('reads each gate\'s achieved rate off three gaps, not four', () => {
    // A runway takes a movement every couple of minutes; RCKT is agreed at one
    // every fifteen. Four gaps there is most of an hour, so the number would be
    // answering for the start of the session — and on the thin stream it would
    // barely exist before the scope filled.
    const world = createWorld(CENTER, 5);
    const times = [0, 600, 1200, 1800, 2400];
    world.stats.deliveryTimesS.set('RCKT', [...times]);
    world.timeS = 2400;
    // Ten-minute gaps are six an hour however many of them are averaged; what
    // the window decides is how far back the answer reaches.
    expect(deliveryRatePerHour(world, 'RCKT')).toBeCloseTo(6, 5);

    // Three of those gaps then halve, and a three-gap window has forgotten the
    // ten-minute ones entirely where a four-gap one would still be carrying one.
    world.stats.deliveryTimesS.set('RCKT', [0, 600, 1200, 1500, 1800, 2100]);
    world.timeS = 2100;
    expect(deliveryRatePerHour(world, 'RCKT')).toBeCloseTo(12, 5);
  });

  it('hands an untouched arrival over at the crossing the approach field expects', () => {
    // The two fields overlap between 50 and 60 NM and must not disagree about
    // it: VABB spawns KETOR at 15,000/260, so VABBS has to deliver that.
    const approach = SCENARIOS.find((s) => s.id === 'VABB')!;
    for (const [gateName, routeChart] of [['KETOR', 'KETOR2A'], ['MOLGO', 'MOLGO2A']] as const) {
      const expected = approach.gates.find((g) => g.name === gateName)!;
      const delivered = CENTER.stars.find((s) => s.chart === routeChart)!;
      const atGate = delivered.waypoints.find((w) => w.name === gateName)!;
      expect(atGate.altitudeFt, gateName).toBe(expected.entryAltitudeFt);
      expect(atGate.speedKts, gateName).toBe(expected.entrySpeedKts);
    }
  });
});

/**
 * Everything above uses VABBS as the worked example, because the rules of the job
 * are easier to state against one field. These are the parts that are a
 * **contract** rather than an example, so they run over every center field there
 * is — and they are what a new sector has to satisfy to be one.
 */
describe.each(SCENARIOS.filter((s) => s.role === 'center').map((s) => [s.id, s] as const))(
  'every center field: %s',
  (_id, field) => {
    it('validates clean, and every route ends at a gate it declares', () => {
      expect(validateScenario(field)).toEqual([]);
      expect(field.delivery.length).toBeGreaterThan(0);
      const fixNames = new Set(field.delivery.map((gate) => gate.fixName));
      for (const star of field.stars) {
        expect(fixNames.has(star.waypoints[star.waypoints.length - 1]!.name), star.name).toBe(true);
      }
      // And every gate is actually fed, or it is an agreement nothing can meet.
      for (const gate of field.delivery) {
        expect(gate.starNames.length, gate.fixName).toBeGreaterThan(0);
        expect(gate.targetRatePerHour, gate.fixName).toBeGreaterThan(0);
      }
    });

    it('is graded against the sum of its gates, and states an interval the in-trail floor fits inside', () => {
      const agreed = field.delivery.reduce((sum, gate) => sum + gate.targetRatePerHour, 0);
      expect(field.agreedRatePerHour, field.id).toBe(agreed);
      // The in-trail floor caps what one fix can take — three minutes is twenty
      // an hour — so a gate asked for more than that could never meet its share
      // however well it was flown. The sector total is free to sit under the
      // floor and at VABBA does: 31 an hour is a 116 s interval, which is the
      // whole point, since it is five gates that deliver it. This is the
      // invariant `validate.ts` cannot hold, `src/scenario` not being allowed to
      // import `src/sim` (§11.4).
      for (const gate of field.delivery) {
        expect(agreedGapS(gate.targetRatePerHour), `${field.id} ${gate.fixName}`)
          .toBeGreaterThanOrEqual(DELIVERY_TRAIL_FLOOR_S);
      }
      // And the floor must leave room for the agreement itself: every gate at the
      // floor has to add up to more than the sector promised.
      expect(
        (field.delivery.length * 3600) / DELIVERY_TRAIL_FLOOR_S,
        field.id,
      ).toBeGreaterThan(field.agreedRatePerHour);

      // The strict window is the sector's real ceiling, and it has to sit above
      // the flow the field offers itself. Equal is not enough: at parity the
      // mean is exactly met, so a clump can never be paid back and the backlog is
      // a random walk with nothing pulling it home — a fail state rather than a
      // puzzle, which is what §3.2a says of feeding a sector past its agreement.
      const strictest = deliveryWindows(field.agreedRatePerHour).at(-1)!;
      expect((strictest.cap * 3600) / strictest.windowS, field.id).toBeGreaterThan(
        field.traffic.arrivalsPerHour,
      );
    });

    it('gives each entry a level its own run in can lose', () => {
      for (const route of field.stars) {
        const gradient =
          (route.waypoints[0]!.altitudeFt! - route.waypoints.at(-1)!.altitudeFt!) / route.lengthNm;
        expect(gradient, route.name).toBeGreaterThan(0);
        expect(gradient, route.name).toBeLessThan(250);
      }
    });

    it('puts every entry onto one trunk in one merge group', () => {
      for (const chart of new Set(field.stars.map((s) => s.chart))) {
        const names = field.stars.filter((s) => s.chart === chart).map((s) => s.name);
        const group = field.mergeGroups.find((g) => g.starNames.includes(names[0]!));
        if (names.length === 1) continue;
        expect(group, chart).toBeDefined();
        expect([...group!.starNames].sort(), chart).toEqual([...names].sort());
      }
      // Every gate lands in exactly one stream, so the streams account for the
      // whole flow — which is what lets a share be stated as a ratio.
      const claimed = field.arrivalStreams.flatMap((s) => [...s.gateNames]);
      expect([...claimed].sort()).toEqual(field.gates.map((g) => g.name).sort());
    });

    it('leaves somewhere to hold within 50 NM of every merge fix', () => {
      // A transition runs the whole way from the boundary to the merge, and
      // without a fix publishing a level in between there is nothing to hold on
      // — KABSO's leg alone is 124 NM. What has to be true is not that the fix
      // is invented but that it is *there*: BEDOL is a published one doing the
      // same job on AGELA's leg.
      for (const star of field.stars) {
        const merge = star.waypoints[star.waypoints.length - 2]!;
        const before = star.waypoints[star.waypoints.indexOf(merge) - 1];
        expect(before, star.name).toBeDefined();
        expect(before!.altitudeFt, star.name).toBeGreaterThan(0);
        expect(distance(before!.position, merge.position), star.name).toBeLessThanOrEqual(50.01);
      }
    });

    it('puts every delivery fix on the inner boundary, not near it', () => {
      // The handoff line *is* the airspace edge, so a delivery fix outside it is
      // a route that stops short of the boundary every other route reaches — a
      // visible gap on the scope, and an aircraft removed from airspace this
      // sector still owns. It happens whenever the inset is a fixed distance and
      // the TMA fixes are not all on one arc: Mumbai's are 60.0 to 63.2 NM out,
      // so ten miles down each leg left MOLGO's 3.2 NM adrift at both fields.
      const shape = field.airspace.shape;
      if (shape.kind === 'chordedCircle') throw new Error(`${field.id} has no inner arc`);
      for (const gate of field.delivery) {
        expect(magnitude(gate.position), `${field.id} ${gate.fixName}`)
          .toBeCloseTo(shape.innerNm, 6);
      }
    });

    it('hands every gate over at the crossing the approach field below expects', () => {
      // The two fields overlap on purpose and must not disagree about it: a
      // number the boundary is shared on is read off the other field, never
      // invented at this one. Matched by ICAO so a new sector cannot quietly
      // grade itself against nobody.
      const approach = SCENARIOS.find((s) => s.icao === field.icao && s.role === 'approach');
      expect(approach, field.icao).toBeDefined();
      for (const star of field.stars) {
        const merge = star.waypoints[star.waypoints.length - 2]!;
        const expected = approach!.gates.find((g) => g.name === merge.name);
        expect(expected, merge.name).toBeDefined();
        expect(merge.altitudeFt, merge.name).toBe(expected!.entryAltitudeFt);
        expect(merge.speedKts, merge.name).toBe(expected!.entrySpeedKts);
      }
    });

    it('names a real approach field where it claims to deliver to one', () => {
      // Optional, and the option is the rule: a sector is offered as an approach
      // session only where its agreements are the whole of what the field below
      // accepts (§15.0f), so VABBS — two gates of five — declares nothing rather
      // than scripting a session missing half its traffic.
      if (field.deliversTo === null) return;
      const target = SCENARIOS.find((s) => s.id === field.deliversTo);
      expect(target, field.deliversTo!).toBeDefined();
      expect(target!.role).toBe('approach');
      expect(target!.icao).toBe(field.icao);
      // And the agreements really do add up to what it accepts, which is what
      // earns the declaration.
      const agreed = field.delivery.reduce((sum, gate) => sum + gate.targetRatePerHour, 0);
      expect(agreed).toBeGreaterThanOrEqual(target!.traffic.arrivalsPerHour);
    });

    it('flies 90 minutes and delivers to every gate it declares', () => {
      const world = createWorld(field, 4242);
      for (let i = 0; i < (90 * 60) / PHYSICS_DT; i += 1) step(world, PHYSICS_DT);

      expect(world.stats.deliveries).toBeGreaterThan(10);
      // A stream that never gets offered anything is the failure per-stream
      // metering exists to prevent, and it is silent without this.
      for (const gate of field.delivery) {
        expect(
          world.stats.deliveryTimesS.get(gate.fixName)?.length ?? 0,
          `${field.id} ${gate.fixName}`,
        ).toBeGreaterThan(0);
      }
      // Nothing vectors an aircraft out here but a player, so the sector must
      // never lose one into the terminal area on its own.
      expect(world.stats.deliveryFaults.get('unsequenced') ?? 0).toBe(0);
      expect(world.stats.exits).toBe(0);
    });
  },
);
