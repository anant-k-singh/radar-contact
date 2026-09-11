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
  acceptableGapS,
  agreedGapS,
  assessDelivery,
  deliveryPlan,
  destinationOf,
  gateReadyInS,
  nextBankS,
  requiredGapS,
  routeOf,
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
import { distance, headingVector, type Deg, type Nm } from '../src/sim/units.js';
import { createWorld, deliveryRatePerHour, step, type World } from '../src/sim/world.js';

const CENTER: Scenario = SCENARIOS.find((s) => s.id === 'VABBS')!;
const RCKT: DeliveryGate = CENTER.delivery.find((g) => g.fixName === 'RCKT')!;
const RCMG: DeliveryGate = CENTER.delivery.find((g) => g.fixName === 'RCMG')!;
/**
 * A four-minute agreement, which is the ledger's worked example — 240 s, floored
 * at 216 and capped at ±48. Synthetic on purpose: the arithmetic is about the
 * rule and not about what Mumbai currently accepts, so retuning a field's rates
 * must not rewrite it.
 */
const FOUR_MINUTE: DeliveryGate = { ...RCMG, targetRatePerHour: 15 };

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
    // Fifteen an hour is four minutes; four an hour is fifteen.
    expect(requiredGapS(FOUR_MINUTE)).toBeCloseTo(240, 5);
    expect(requiredGapS(RCKT)).toBeCloseTo(3600 / RCKT.targetRatePerHour, 5);
    expect(requiredGapS(RCMG)).toBeCloseTo(3600 / RCMG.targetRatePerHour, 5);
  });

  it('passes a delivery on profile, on level, on speed and in interval', () => {
    const { ac } = arrivalOn('KETOR2A/KABSO');
    const end = ac.star!.route.waypoints[ac.star!.route.waypoints.length - 1]!;
    ac.star!.index = ac.star!.route.waypoints.length - 1;
    ac.altitudeFt = end.altitudeFt!;
    ac.iasKts = end.speedKts!;
    const verdict = assessDelivery(RCKT, ac, 0, 0, requiredGapS(RCKT) + 1);
    expect(verdict.faults).toEqual([]);
    expect(verdict.gate).toBe('RCKT');
  });

  it('faults a delivery inside the agreed interval, and only inside it', () => {
    const { ac } = arrivalOn('KETOR2A/KABSO');
    const end = ac.star!.route.waypoints[ac.star!.route.waypoints.length - 1]!;
    ac.altitudeFt = end.altitudeFt!;
    ac.iasKts = end.speedKts!;
    // Half the agreed gap behind the one in front: too close.
    expect(assessDelivery(RCKT, ac, 0, 0, requiredGapS(RCKT) / 2).faults).toContain('early');
    // A whisker over it: clean.
    expect(assessDelivery(RCKT, ac, 0, 0, requiredGapS(RCKT) + 1).faults).not.toContain('early');
    // The first delivery at a gate has nothing to be too close to.
    expect(assessDelivery(RCKT, ac, null, 0, 60).faults).toEqual([]);
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
    expect(assessDelivery(RCKT, ac, null, 0, 60).faults).toEqual(['level']);

    clean();
    ac.iasKts = end.speedKts! + 40;
    expect(assessDelivery(RCKT, ac, null, 0, 60).faults).toEqual(['speed']);

    // Tolerances, not equalities: an aircraft 100 ft and 5 kt off is delivered.
    clean();
    ac.altitudeFt = end.altitudeFt! + 100;
    ac.iasKts = end.speedKts! - 5;
    expect(assessDelivery(RCKT, ac, null, 0, 60).faults).toEqual([]);

    // Off the route entirely — the fault this position exists to prevent.
    clean();
    ac.star = null;
    expect(assessDelivery(RCKT, ac, null, 0, 60).faults).toEqual(['unsequenced']);
  });

  it('keeps the two gates independent', () => {
    const { ac } = arrivalOn('MOLGO2A/AGELA');
    const end = ac.star!.route.waypoints[ac.star!.route.waypoints.length - 1]!;
    ac.altitudeFt = end.altitudeFt!;
    ac.iasKts = end.speedKts!;
    // Ten seconds after a KETOR delivery is irrelevant to a MOLGO one: the
    // agreement is per gate, and the previous time handed in is that gate's.
    expect(assessDelivery(RCMG, ac, null, 0, 10).faults).toEqual([]);
  });
});

describe('the gate countdown', () => {
  it('counts the agreed interval down from the last delivery, and floors at zero', () => {
    const gap = requiredGapS(RCKT);
    // Nothing delivered yet: the stream is empty and will take anyone.
    expect(gateReadyInS(RCKT, new Map(), new Map(), 0)).toBeNull();

    const last = new Map([['RCKT', 100]]);
    // The instant one is delivered, the whole interval is owed.
    expect(gateReadyInS(RCKT, last, new Map(), 100)).toBeCloseTo(gap, 5);
    expect(gateReadyInS(RCKT, last, new Map(), 100 + gap / 2)).toBeCloseTo(gap / 2, 5);
    // Open exactly on the interval, and never negative afterwards.
    expect(gateReadyInS(RCKT, last, new Map(), 100 + gap)).toBe(0);
    expect(gateReadyInS(RCKT, last, new Map(), 100 + gap * 3)).toBe(0);
  });

  it('counts each gate down against its own agreement', () => {
    // One map of delivery times, two different intervals — KETOR's stream is the
    // thinner of the two, so some way past a delivery at each the busy gate has
    // opened and the quiet one has not.
    const last = new Map([
      ['RCKT', 0],
      ['RCMG', 0],
    ]);
    const between = (agreedGapS(RCMG) + agreedGapS(RCKT)) / 2;
    expect(gateReadyInS(RCKT, last, new Map(), between)).toBeCloseTo(
      agreedGapS(RCKT) - between,
      5,
    );
    expect(gateReadyInS(RCMG, last, new Map(), between)).toBe(0);
  });

  it('never invites a delivery it would then penalise, at any balance', () => {
    // The clock states what the gate wants and the tolerance is what it will
    // take, so the two are not the same instant — but the open gate has to be
    // inside the tolerance in both directions, or the scope is telling the
    // player to do something it faults.
    const { ac } = arrivalOn('KETOR2A/KABSO');
    const end = ac.star!.route.waypoints[ac.star!.route.waypoints.length - 1]!;
    ac.altitudeFt = end.altitudeFt!;
    ac.iasKts = end.speedKts!;
    const last = new Map([['RCKT', 0]]);
    const agreed = agreedGapS(RCKT);
    for (const bankS of [-agreed * 0.2, -30, 0, 30, agreed * 0.2]) {
      const banks = new Map([['RCKT', bankS]]);
      for (const atS of [60, 200, requiredGapS(RCKT, bankS) - 1, requiredGapS(RCKT, bankS) + 1]) {
        const open = gateReadyInS(RCKT, last, banks, atS) === 0;
        const early = assessDelivery(RCKT, ac, 0, bankS, atS).faults.includes('early');
        expect(open && early, `at ${atS} s on a bank of ${bankS}`).toBe(false);
      }
      // And the amber tail is exactly the tolerance: a second under the fault
      // line is a fault, a second over it is not, whatever the clock says.
      const floor = acceptableGapS(RCKT, bankS);
      expect(assessDelivery(RCKT, ac, 0, bankS, floor - 1).faults).toContain('early');
      expect(assessDelivery(RCKT, ac, 0, bankS, floor + 1).faults).not.toContain('early');
    }
  });
});

/**
 * Worked on a four-minute agreement, so the requirement floors at 216 s and the
 * balance caps at ±48.
 */
describe('the spacing ledger', () => {
  it('shortens the next requirement by what a long gap banked, and lengthens it by a short one', () => {
    // A gap flown twenty seconds long leaves twenty in hand, and the gate asks
    // for 3:40 next.
    const credit = nextBankS(FOUR_MINUTE, 0, 260);
    expect(credit).toBeCloseTo(20, 5);
    expect(requiredGapS(FOUR_MINUTE, credit)).toBeCloseTo(220, 5);

    // Ten seconds short is borrowed, and paid back on the next one — 4:10.
    const debt = nextBankS(FOUR_MINUTE, 0, 230);
    expect(debt).toBeCloseTo(-10, 5);
    expect(requiredGapS(FOUR_MINUTE, debt)).toBeCloseTo(250, 5);
  });

  it('weighs every gap against the agreement, never against the requirement standing', () => {
    // From twenty in hand, the gate is asking for 220. Each of these is what the
    // *third* delivery does to that balance, and they are alternatives rather
    // than a sequence.
    //
    // Another long one banks twenty more. The ask floors at 216 while the
    // balance keeps all forty, which is what stops credit compounding into a
    // licence to empty the stream.
    expect(nextBankS(FOUR_MINUTE, 20, 260)).toBeCloseTo(40, 5);
    expect(requiredGapS(FOUR_MINUTE, 40)).toBeCloseTo(216, 5);

    // One flown at the agreement moves nothing, even though the gate had asked
    // for less: the ledger is kept against the agreement, so credit is spent
    // once and not by default.
    expect(nextBankS(FOUR_MINUTE, 20, 240)).toBeCloseTo(20, 5);
    expect(requiredGapS(FOUR_MINUTE, 20)).toBeCloseTo(220, 5);

    // And one flown at 218 spends the twenty and borrows two more.
    expect(nextBankS(FOUR_MINUTE, 20, 218)).toBeCloseTo(-2, 5);
    expect(requiredGapS(FOUR_MINUTE, -2)).toBeCloseTo(242, 5);
  });

  it('caps the balance either way, so neither a quiet hour nor a bad one compounds', () => {
    const cap = agreedGapS(FOUR_MINUTE) * 0.2;
    // Ten minutes with nothing delivered is worth forty-eight seconds and no
    // more.
    expect(nextBankS(FOUR_MINUTE, 0, 600)).toBeCloseTo(cap, 5);
    expect(nextBankS(FOUR_MINUTE, cap, 600)).toBeCloseTo(cap, 5);

    // Four deliveries at the floor do not dig past the same depth the other way.
    let bank = 0;
    for (let i = 0; i < 4; i += 1) bank = nextBankS(FOUR_MINUTE, bank, 216);
    expect(bank).toBeCloseTo(-cap, 5);
  });

  it('takes a gap inside the tolerance, and grades the next one against the debt', () => {
    const { ac } = arrivalOn('MOLGO2A/AGELA');
    const end = ac.star!.route.waypoints[ac.star!.route.waypoints.length - 1]!;
    ac.altitudeFt = end.altitudeFt!;
    ac.iasKts = end.speedKts!;

    // 3:50 into a four-minute stream: ten seconds under the agreement, which is
    // inside the tolerance and therefore not a fault — it is borrowed.
    const first = assessDelivery(FOUR_MINUTE, ac, 0, 0, 230);
    expect(first.faults).not.toContain('early');
    expect(first.bankAfterS).toBeCloseTo(-10, 5);
    expect(first.requiredGapS).toBeCloseTo(240, 5);

    // A second under the floor is the fault, from a clean ledger.
    expect(assessDelivery(FOUR_MINUTE, ac, 0, 0, 215).faults).toContain('early');
    expect(assessDelivery(FOUR_MINUTE, ac, 0, 0, 216).faults).not.toContain('early');

    // In debt the whole band moves up with the requirement: the same 230 that
    // was taken from a clean ledger is a fault from a full one, which is what
    // stops a sector running permanently at the tolerance.
    expect(assessDelivery(FOUR_MINUTE, ac, 0, -48, 230).faults).toContain('early');
    expect(acceptableGapS(FOUR_MINUTE, -48)).toBeCloseTo(264, 5);

    // The first delivery at a gate opens the ledger rather than moving it.
    expect(assessDelivery(FOUR_MINUTE, ac, null, 12, 60).bankAfterS).toBe(12);
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
    // Three aircraft two minutes apart in a ten-minute stream owe eight, sixteen
    // and twenty-four minutes, not eight minutes each.
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

    const slots = deliveryPlan(CENTER.delivery, made, new Map(), new Map(), 0);
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
    const slots = deliveryPlan(CENTER.delivery, world.aircraft, new Map(), new Map(), 0);
    // Just handed over at the boundary, with the whole route still to run.
    expect(slots.get(ac.id)!.frozen).toBe(false);
    ac.star!.index = ac.star!.route.waypoints.length - 1;
    const end = ac.star!.route.waypoints[ac.star!.route.waypoints.length - 1]!;
    ac.x = end.position.x - 10;
    ac.y = end.position.y;
    expect(deliveryPlan(CENTER.delivery, world.aircraft, new Map(), new Map(), 0).get(ac.id)!.frozen).toBe(true);
  });

  it('slots the next arrival against the ledger its gate is carrying', () => {
    const { world, ac } = arrivalOn('KETOR2A/KABSO');
    const last = new Map([['RCKT', 0]]);
    const plan = (bankS: number) =>
      deliveryPlan(CENTER.delivery, world.aircraft, last, new Map([['RCKT', bankS]]), 0).get(
        ac.id,
      )!;
    // The estimate is the aircraft's and does not move; the slot it is measured
    // against does, by exactly the balance — thirty seconds in hand is thirty
    // seconds less to lose.
    expect(plan(30).etaS).toBeCloseTo(plan(0).etaS, 5);
    expect(plan(0).deficitS - plan(30).deficitS).toBeCloseTo(30, 5);
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
