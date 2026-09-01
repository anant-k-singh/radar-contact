/**
 * What every field has to satisfy, asserted over every field.
 *
 * Split from the ZZZZ-specific tests on one line: if it would be true of any
 * airport, it belongs here; if it is a fact about the default field's particular
 * design, it belongs in `zzzz.chart.test.ts` or beside the behaviour it explains.
 *
 * The rotated fixture is what gives this file its point. Without a second field
 * these are all statements about ZZZZ wearing a loop, and every runway-relative
 * helper could be subtly wrong in a way that happens to work for a 180° course.
 */
import { describe, expect, it } from 'vitest';
import { compileScenario } from '../src/scenario/compile.js';
import { starForGate, starProfileAt } from '../src/scenario/routes.js';
import { SCENARIOS } from '../src/scenario/registry.js';
import type { Scenario } from '../src/scenario/types.js';
import { validateScenario, VALIDATION_GS_FT_PER_NM } from '../src/scenario/validate.js';
import { isDeparture } from '../src/sim/aircraft.js';
import { GS_FT_PER_NM, PHYSICS_DT, SEP_HORIZ_NM, SEP_VERT_FT } from '../src/sim/constants.js';
import { glideslopeAltitudeFt } from '../src/sim/ils.js';
import { createArrival, createDeparture, createTrafficState } from '../src/sim/traffic.js';
import { createWorld, step } from '../src/sim/world.js';
import { distance, magnitude, rightOf } from '../src/sim/units.js';
import { ROTATED, ROTATED_SPEC } from './fixtures/rotatedField.js';

const FIELDS: Scenario[] = [...SCENARIOS, ROTATED];

describe.each(FIELDS.map((scenario) => [scenario.id, scenario] as const))(
  'every field — %s',
  (_id, scenario) => {
    it('passes its own validation', () => {
      expect(validateScenario(scenario)).toEqual([]);
    });

    it('gives every gate a handover, from a STAR or from the gate itself', () => {
      expect(scenario.gates.length).toBeGreaterThan(0);
      for (const gate of scenario.gates) {
        const star = starForGate(scenario, gate.name);
        expect(gate.entryAltitudeFt).toBeGreaterThan(scenario.airspace.mvaFt);
        expect(gate.entryAltitudeFt).toBeLessThanOrEqual(scenario.airspace.ceilingFt);
        if (star) {
          // The route is the authority; the gate takes its values from it.
          expect(gate.entryAltitudeFt).toBe(star.waypoints[0]!.altitudeFt);
          expect(gate.entrySpeedKts).toBe(star.waypoints[0]!.speedKts);
          expect(star.waypoints[0]!.position).toEqual(gate.position);
        }
      }
    });

    it('builds a runway frame that is orthonormal and consistent', () => {
      const { runway } = scenario;
      const right = rightOf(runway.direction);
      expect(magnitude(runway.direction)).toBeCloseTo(1, 12);
      expect(magnitude(right)).toBeCloseTo(1, 12);
      expect(runway.direction.x * right.x + runway.direction.y * right.y).toBeCloseTo(0, 12);
      expect(distance(runway.threshold, runway.farEnd)).toBeCloseTo(runway.lengthNm, 12);
      // The threshold is behind the departure end, along the landing direction.
      const along =
        (runway.farEnd.x - runway.threshold.x) * runway.direction.x +
        (runway.farEnd.y - runway.threshold.y) * runway.direction.y;
      expect(along).toBeCloseTo(runway.lengthNm, 12);
    });

    it('ends every arrival route below the glideslope, on a platform it can hold', () => {
      for (const star of scenario.stars) {
        const last = star.waypoints[star.waypoints.length - 1]!;
        const alongNm = -(
          (last.position.x - scenario.runway.threshold.x) * scenario.runway.direction.x +
          (last.position.y - scenario.runway.threshold.y) * scenario.runway.direction.y
        );
        expect(alongNm).toBeGreaterThan(0);
        expect(last.altitudeFt!).toBeLessThan(glideslopeAltitudeFt(scenario.runway, alongNm));
      }
    });

    it('keeps its arrival routes apart from each other', () => {
      for (let i = 0; i < scenario.stars.length; i += 1) {
        for (let j = i + 1; j < scenario.stars.length; j += 1) {
          const a = scenario.stars[i]!;
          const b = scenario.stars[j]!;
          // Sampled along both tracks; two published routes must not share airspace.
          for (const pa of sampleTrack(a.waypoints)) {
            for (const pb of sampleTrack(b.waypoints)) {
              expect(
                distance(pa, pb),
                `${a.name} and ${b.name} pass too close`,
              ).toBeGreaterThan(SEP_HORIZ_NM);
            }
          }
        }
      }
    });

    it('flies every arrival route from its gate to its last fix', () => {
      for (const gate of scenario.gates) {
        const star = starForGate(scenario, gate.name);
        if (!star) continue;
        const world = createWorld(scenario, 5);
        world.traffic.nextSpawnAtS = Number.POSITIVE_INFINITY;
        world.traffic.nextDepartureAtS = Number.POSITIVE_INFINITY;
        world.departureFlowPerHour = 0;

        const ac = createArrival(scenario, world.rng, createTrafficState(), gate, [], 0);
        world.aircraft = [ac];

        const last = star.waypoints[star.waypoints.length - 1]!;
        let closestNm = Number.POSITIVE_INFINITY;
        for (let i = 0; i < 30 * 60 * (1 / PHYSICS_DT) && world.aircraft.length > 0; i += 1) {
          step(world, PHYSICS_DT);
          closestNm = Math.min(closestNm, distance({ x: ac.x, y: ac.y }, last.position));
          if (ac.star === null) break;
        }
        expect(closestNm, `${star.name} never reached ${last.name}`).toBeLessThan(1);
      }
    });

    it('keeps every departure clear of every arrival route, for every type', () => {
      for (const sid of scenario.sids) {
        for (const type of scenario.fleet) {
          const world = createWorld(scenario, 9);
          world.traffic.nextSpawnAtS = Number.POSITIVE_INFINITY;
          world.traffic.nextDepartureAtS = Number.POSITIVE_INFINITY;
          world.departureFlowPerHour = 0;

          const ac = createDeparture(scenario, world.departureRng, createTrafficState(), sid, [], 0);
          ac.type = type;
          world.aircraft = [ac];

          let reachedTop = false;
          for (let i = 0; i < 30 * 60 * (1 / PHYSICS_DT) && world.aircraft.length > 0; i += 1) {
            step(world, PHYSICS_DT);
            if (world.aircraft.length === 0) break;
            if (ac.altitudeFt >= sid.topFt - 100) reachedTop = true;
            for (const star of scenario.stars) {
              for (const point of sampleTrack(star.waypoints)) {
                if (distance({ x: ac.x, y: ac.y }, point) > SEP_HORIZ_NM) continue;
                const arrivalFt = starProfileAt(star, point.dtgNm).altitudeFt;
                // Either sense: a departure held beneath the arrival and one that
                // has already climbed above it are both separated. Close to the
                // field it is the first; 25 NM out, where the arrival is down at
                // 6000 and the departure has been climbing for minutes, the second.
                expect(
                  Math.abs(arrivalFt - ac.altitudeFt),
                  `${type.code} on ${sid.name} passing ${star.name}`,
                ).toBeGreaterThanOrEqual(SEP_VERT_FT - 1);
              }
            }
          }
          expect(reachedTop, `${type.code} on ${sid.name} never reached the top of climb`).toBe(true);
          expect(isDeparture(ac)).toBe(true);
        }
      }
    });
  },
);

describe('the validator', () => {
  it('agrees with the sim about the glideslope', () => {
    // It cannot import GS_FT_PER_NM — a scenario may not import the tunables —
    // so the two are checked against each other instead of drifting quietly.
    expect(VALIDATION_GS_FT_PER_NM).toBeCloseTo(GS_FT_PER_NM, 1);
  });

  it('catches a departure released under an arrival with no restriction', () => {
    // The rotated field's turning SID crosses a downwind and is held at 4000 to
    // get under it. Take the restriction away and the field must stop validating
    // — otherwise the rule is decoration.
    const broken = compileScenario({
      ...ROTATED_SPEC,
      sids: ROTATED_SPEC.sids.map((sid) => ({
        ...sid,
        fixes: sid.fixes.map((fix) => ({ ...fix, maxAltitudeFt: undefined })),
      })),
    });
    const problems = validateScenario(broken);
    expect(problems.some((p) => p.where.includes('×'))).toBe(true);
  });

  it('catches a gate outside the boundary', () => {
    // Placement puts a gate on the boundary, so this has to be forced — but the
    // check is the backstop for a field that computes its own positions.
    const scenario = compileScenario(ROTATED_SPEC);
    const moved: Scenario = {
      ...scenario,
      gates: scenario.gates.map((gate, i) =>
        i === 0 ? { ...gate, position: { x: gate.position.x * 2, y: gate.position.y * 2 } } : gate,
      ),
    };
    expect(validateScenario(moved).some((p) => p.message.includes('outside'))).toBe(true);
  });

  it('catches a runway whose number disagrees with its course', () => {
    const broken = compileScenario({
      ...ROTATED_SPEC,
      runway: { ...ROTATED_SPEC.runway, courseDeg: 270 },
    });
    expect(validateScenario(broken).some((p) => p.message.includes('implies'))).toBe(true);
  });

  it('catches a gate left with no STAR and no handover of its own', () => {
    expect(() =>
      compileScenario({
        ...ROTATED_SPEC,
        gates: ROTATED_SPEC.gates.map((gate) =>
          gate.name === 'NORTA'
            ? { name: gate.name, bearingDeg: gate.bearingDeg }
            : gate,
        ),
      }),
    ).toThrow(/entry altitude and speed/);
  });
});

/**
 * Points along a route's track every 0.5 NM, each carrying its distance to go —
 * which is what the published profile is keyed by, so a sample knows the altitude
 * an arrival would be at as it passed.
 */
function sampleTrack(
  waypoints: readonly { position: { x: number; y: number }; dtgNm?: number }[],
): { x: number; y: number; dtgNm: number }[] {
  const out: { x: number; y: number; dtgNm: number }[] = [];
  for (let i = 1; i < waypoints.length; i += 1) {
    const from = waypoints[i - 1]!;
    const to = waypoints[i]!;
    const legNm = distance(from.position, to.position);
    const steps = Math.max(1, Math.ceil(legNm / 0.5));
    for (let s = 0; s <= steps; s += 1) {
      const t = s / steps;
      out.push({
        x: from.position.x + (to.position.x - from.position.x) * t,
        y: from.position.y + (to.position.y - from.position.y) * t,
        dtgNm: (to.dtgNm ?? 0) + legNm * (1 - t),
      });
    }
  }
  return out;
}
