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
import { validateScenario } from '../src/scenario/validate.js';
import type { DeliveryGate, Scenario } from '../src/scenario/types.js';
import { PHYSICS_DT } from '../src/sim/constants.js';
import {
  assessDelivery,
  deliveryPlan,
  destinationOf,
  requiredGapS,
  routeOf,
} from '../src/sim/delivery.js';
import { createRng } from '../src/sim/rng.js';
import { joinStar } from '../src/sim/star.js';
import { createArrival, createTrafficState } from '../src/sim/traffic.js';
import { headingVector, type Deg, type Nm } from '../src/sim/units.js';
import { createWorld, deliveryRatePerHour, step, type World } from '../src/sim/world.js';

const CENTER: Scenario = SCENARIOS.find((s) => s.id === 'VABBS')!;
const RCKT: DeliveryGate = CENTER.delivery.find((g) => g.fixName === 'RCKT')!;

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
  world.traffic.nextSpawnAtS = Number.POSITIVE_INFINITY;
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

  it('reads a rate as the interval it implies', () => {
    // Eight an hour is seven and a half minutes; fifteen is four.
    expect(requiredGapS(RCKT)).toBeCloseTo(450, 5);
    expect(requiredGapS(CENTER.delivery.find((g) => g.fixName === 'RCMG')!)).toBeCloseTo(240, 5);
  });

  it('passes a delivery on profile, on level, on speed and in interval', () => {
    const { ac } = arrivalOn('KETOR2A/KABSO');
    const end = ac.star!.route.waypoints[ac.star!.route.waypoints.length - 1]!;
    ac.star!.index = ac.star!.route.waypoints.length - 1;
    ac.altitudeFt = end.altitudeFt!;
    ac.iasKts = end.speedKts!;
    const verdict = assessDelivery(RCKT, ac, 0, requiredGapS(RCKT) + 1);
    expect(verdict.faults).toEqual([]);
    expect(verdict.gate).toBe('RCKT');
  });

  it('faults a delivery inside the agreed interval, and only inside it', () => {
    const { ac } = arrivalOn('KETOR2A/KABSO');
    const end = ac.star!.route.waypoints[ac.star!.route.waypoints.length - 1]!;
    ac.altitudeFt = end.altitudeFt!;
    ac.iasKts = end.speedKts!;
    // Half the agreed gap behind the one in front: too close.
    expect(assessDelivery(RCKT, ac, 0, requiredGapS(RCKT) / 2).faults).toContain('early');
    // A whisker over it: clean.
    expect(assessDelivery(RCKT, ac, 0, requiredGapS(RCKT) + 1).faults).not.toContain('early');
    // The first delivery at a gate has nothing to be too close to.
    expect(assessDelivery(RCKT, ac, null, 60).faults).toEqual([]);
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
    expect(assessDelivery(RCKT, ac, null, 60).faults).toEqual(['level']);

    clean();
    ac.iasKts = end.speedKts! + 40;
    expect(assessDelivery(RCKT, ac, null, 60).faults).toEqual(['speed']);

    // Tolerances, not equalities: an aircraft 100 ft and 5 kt off is delivered.
    clean();
    ac.altitudeFt = end.altitudeFt! + 100;
    ac.iasKts = end.speedKts! - 5;
    expect(assessDelivery(RCKT, ac, null, 60).faults).toEqual([]);

    // Off the route entirely — the fault this position exists to prevent.
    clean();
    ac.star = null;
    expect(assessDelivery(RCKT, ac, null, 60).faults).toEqual(['unsequenced']);
  });

  it('keeps the two gates independent', () => {
    const rcmg = CENTER.delivery.find((g) => g.fixName === 'RCMG')!;
    const { ac } = arrivalOn('MOLGO2A/AGELA');
    const end = ac.star!.route.waypoints[ac.star!.route.waypoints.length - 1]!;
    ac.altitudeFt = end.altitudeFt!;
    ac.iasKts = end.speedKts!;
    // Ten seconds after a KETOR delivery is irrelevant to a MOLGO one: the
    // agreement is per gate, and the previous time handed in is that gate's.
    expect(assessDelivery(rcmg, ac, null, 10).faults).toEqual([]);
  });
});

describe('the metering deficit', () => {
  it('accumulates down a queue rather than being read pairwise', () => {
    // Three aircraft two minutes apart in a ten-minute stream owe eight, sixteen
    // and twenty-four minutes, not eight minutes each.
    const world = createWorld(CENTER, 5);
    world.traffic.nextSpawnAtS = Number.POSITIVE_INFINITY;
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

    const slots = deliveryPlan(CENTER.delivery, made, new Map(), 0);
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
    const slots = deliveryPlan(CENTER.delivery, world.aircraft, new Map(), 0);
    // Just handed over at the boundary, with the whole route still to run.
    expect(slots.get(ac.id)!.frozen).toBe(false);
    ac.star!.index = ac.star!.route.waypoints.length - 1;
    const end = ac.star!.route.waypoints[ac.star!.route.waypoints.length - 1]!;
    ac.x = end.position.x - 10;
    ac.y = end.position.y;
    expect(deliveryPlan(CENTER.delivery, world.aircraft, new Map(), 0).get(ac.id)!.frozen).toBe(true);
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
