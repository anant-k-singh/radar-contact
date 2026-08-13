import { AIRCRAFT_TYPES } from '../src/scenario/aircraftTypes.js';
import { AIRPORT } from '../src/scenario/airport.js';
import type { Aircraft } from '../src/sim/aircraft.js';
import { createRng } from '../src/sim/rng.js';
import { createArrival, createTrafficState } from '../src/sim/traffic.js';
import { createWorld, type World } from '../src/sim/world.js';

export const MEDIUM_TYPE = AIRCRAFT_TYPES.find((t) => t.code === 'A320')!;
export const HEAVY_TYPE = AIRCRAFT_TYPES.find((t) => t.code === 'A332')!;

/**
 * An aircraft at a known state, built through the real spawn path.
 * The type is pinned to a medium unless overridden, so performance-dependent
 * assertions do not depend on the RNG.
 */
export function makeAircraft(overrides: Partial<Aircraft> = {}): Aircraft {
  const rng = createRng(1);
  const state = createTrafficState();
  const ac = createArrival(rng, state, AIRPORT.gates[0]!, [], 0);
  ac.type = MEDIUM_TYPE;
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

/** A world with traffic generation switched off, holding exactly these aircraft. */
export function quietWorld(...aircraft: Aircraft[]): World {
  const world = createWorld(42);
  world.traffic.nextSpawnAtS = Number.POSITIVE_INFINITY;
  world.aircraft = aircraft;
  world.messages = [];
  return world;
}
