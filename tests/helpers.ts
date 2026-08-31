import { DEFAULT_SCENARIO } from '../src/scenario/registry.js';
import type { Aircraft } from '../src/sim/aircraft.js';
import { PHYSICS_DT, PILOT_DELAY_MAX_S } from '../src/sim/constants.js';
import { finalGeometry, glideslopeAltitudeFt, type FinalGeometry } from '../src/sim/ils.js';
import { applyDueInstructions } from '../src/sim/pilot.js';
import { createRng } from '../src/sim/rng.js';
import { createArrival, createTrafficState } from '../src/sim/traffic.js';
import { normalizeHeading, rightOf, type Deg, type Ft, type Nm, type Point } from '../src/sim/units.js';
import { createWorld, log, step, type World } from '../src/sim/world.js';

/**
 * The field the *specific* assertions in these tests are about.
 *
 * Anything true of every field belongs in the conformance suite, which runs over
 * the whole registry. Anything true of this one — that its two northern gates get
 * the lower crossing, that its north routes end 4 NM apart — belongs here.
 */
export const SCENARIO = DEFAULT_SCENARIO;
export const AIRPORT = SCENARIO;
export const RUNWAY = SCENARIO.runway;

export const MEDIUM_TYPE = SCENARIO.fleet.find((t) => t.code === 'A320')!;
export const HEAVY_TYPE = SCENARIO.fleet.find((t) => t.code === 'A332')!;

/**
 * An aircraft at a known state, built through the real spawn path.
 * The type is pinned to a medium unless overridden, so performance-dependent
 * assertions do not depend on the RNG. It is off its STAR unless the test puts
 * it back on one: most tests position the aircraft by hand, and a route would
 * fly it straight back off the setup they built.
 */
export function makeAircraft(overrides: Partial<Aircraft> = {}): Aircraft {
  const rng = createRng(1);
  const state = createTrafficState();
  const ac = createArrival(SCENARIO, rng, state, SCENARIO.gates[0]!, [], 0);
  ac.type = MEDIUM_TYPE;
  ac.star = null;
  Object.assign(ac, overrides);
  // Keep the targets consistent with any overridden live values unless the
  // caller set them explicitly.
  if (overrides.altitudeFt !== undefined && overrides.targetAltitudeFt === undefined) {
    ac.targetAltitudeFt = ac.altitudeFt;
  }
  if (overrides.iasKts !== undefined && overrides.targetIasKts === undefined) {
    ac.targetIasKts = ac.iasKts;
  }
  if (overrides.headingDeg !== undefined && overrides.targetHeadingDeg === undefined) {
    ac.targetHeadingDeg = ac.headingDeg;
  }
  return ac;
}

/**
 * A point on the final approach course: `alongNm` before the threshold, `xtkNm`
 * to the *right* of the centreline facing the landing direction.
 *
 * Runway-relative on purpose, and in `FinalGeometry`'s own sign convention — so a
 * test can place an aircraft and assert `geo.xtkNm` without a mental flip, and so
 * none of this depends on which way this particular runway points.
 */
export function onFinal(alongNm: Nm, xtkNm: Nm = 0): Point {
  const right = rightOf(RUNWAY.direction);
  return {
    x: RUNWAY.threshold.x - RUNWAY.direction.x * alongNm + right.x * xtkNm,
    y: RUNWAY.threshold.y - RUNWAY.direction.y * alongNm + right.y * xtkNm,
  };
}

/** A heading `deg` off the final approach course; positive is right of it. */
export function offCourse(deg: Deg): Deg {
  return normalizeHeading(RUNWAY.courseDeg + deg);
}

/** The glideslope altitude `alongNm` out, plus an offset — on, above or below it. */
export function onGlideslope(alongNm: Nm, offsetFt: Ft = 0): Ft {
  return glideslopeAltitudeFt(RUNWAY, alongNm) + offsetFt;
}

/** This field's final approach geometry for an aircraft. */
export function geo(ac: Aircraft): FinalGeometry {
  return finalGeometry(RUNWAY, ac);
}

/**
 * A world with traffic generation switched off, holding exactly these aircraft.
 * Both streams are off: several tests detect a landing by the scope going empty,
 * which a departure rolling in the background would quietly break.
 */
export function quietWorld(...aircraft: Aircraft[]): World {
  const world = createWorld(SCENARIO, 42);
  world.traffic.nextSpawnAtS = Number.POSITIVE_INFINITY;
  world.traffic.nextDepartureAtS = Number.POSITIVE_INFINITY;
  world.departureFlowPerHour = 0;
  world.aircraft = aircraft;
  world.messages = [];
  return world;
}

/** Run the world forward by `seconds` of sim time. */
export function run(world: World, seconds: number): void {
  const steps = Math.round(seconds / PHYSICS_DT);
  for (let i = 0; i < steps; i += 1) step(world, PHYSICS_DT);
}

/**
 * Skip the crew's reaction time: let every outstanding instruction take effect
 * now, without flying the aircraft anywhere in between (§7.2).
 */
export function pilotActs(world: World, ...aircraft: Aircraft[]): void {
  const targets = aircraft.length > 0 ? aircraft : world.aircraft;
  // Past the longest reaction time outstanding, not just the nominal maximum:
  // a clearance stacked behind another instruction is deliberately later still.
  world.timeS = Math.max(
    world.timeS + PILOT_DELAY_MAX_S,
    ...targets.flatMap((ac) => ac.pending.map((item) => item.atS)),
  );
  for (const ac of targets) {
    for (const readback of applyDueInstructions(world.scenario.runway, ac, world.timeS)) {
      log(world, readback.text, readback.kind);
    }
  }
}
