import { AIRCRAFT_TYPES } from '../src/scenario/aircraftTypes.js';
import { AIRPORT } from '../src/scenario/airport.js';
import type { Aircraft } from '../src/sim/aircraft.js';
import { PHYSICS_DT, PILOT_DELAY_MAX_S } from '../src/sim/constants.js';
import { applyDueInstructions } from '../src/sim/pilot.js';
import { createRng } from '../src/sim/rng.js';
import { createArrival, createTrafficState } from '../src/sim/traffic.js';
import { createWorld, log, step, type World } from '../src/sim/world.js';

export const MEDIUM_TYPE = AIRCRAFT_TYPES.find((t) => t.code === 'A320')!;
export const HEAVY_TYPE = AIRCRAFT_TYPES.find((t) => t.code === 'A332')!;

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
  const ac = createArrival(rng, state, AIRPORT.gates[0]!, [], 0);
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

/** A point on the extended centerline, `alongNm` from the threshold, offset east. */
export function onFinalApproach(alongNm: number, eastOffsetNm = 0): { x: number; y: number } {
  return {
    x: AIRPORT.runway.threshold.x + eastOffsetNm,
    y: AIRPORT.runway.threshold.y + alongNm,
  };
}

/**
 * A world with traffic generation switched off, holding exactly these aircraft.
 * Both streams are off: several tests detect a landing by the scope going empty,
 * which a departure rolling in the background would quietly break.
 */
export function quietWorld(...aircraft: Aircraft[]): World {
  const world = createWorld(42);
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
    for (const readback of applyDueInstructions(ac, world.timeS)) {
      log(world, readback.text, readback.kind);
    }
  }
}
