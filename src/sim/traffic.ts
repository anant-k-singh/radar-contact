/**
 * Traffic generation (docs §4.4). Poisson arrivals at the entry gates, with a
 * per-gate cooldown and a conflict veto so Center never hands over a problem.
 */
import { AIRCRAFT_TYPES } from '../scenario/aircraftTypes.js';
import { AIRLINES } from '../scenario/airlines.js';
import { AIRPORT, type EntryGate } from '../scenario/airport.js';
import { starForGate } from '../scenario/stars.js';
import type { Aircraft } from './aircraft.js';
import {
  ENTRY_SPEED_KTS,
  GATE_COOLDOWN_S,
  MIN_SPAWN_INTERVAL_S,
  SPAWN_VETO_FT,
  SPAWN_VETO_NM,
} from './constants.js';
import type { Rng } from './rng.js';
import { joinStar } from './star.js';
import { bearing, distance, type Sec } from './units.js';

export interface TrafficState {
  nextSpawnAtS: Sec;
  gateLastSpawnS: Map<string, Sec>;
  nextId: number;
}

export function createTrafficState(): TrafficState {
  return { nextSpawnAtS: 0, gateLastSpawnS: new Map(), nextId: 1 };
}

/** Exponential inter-arrival interval, floored so the queue cannot clump absurdly. */
export function scheduleNextSpawn(
  state: TrafficState,
  rng: Rng,
  timeS: Sec,
  flowPerHour: number,
): void {
  const mean = 3600 / Math.max(1, flowPerHour);
  state.nextSpawnAtS = timeS + Math.max(MIN_SPAWN_INTERVAL_S, rng.exponential(mean));
}

function callsign(rng: Rng, existing: readonly Aircraft[]): { airline: (typeof AIRLINES)[number]; text: string } {
  const used = new Set(existing.map((ac) => ac.callsign));
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const airline = rng.pick(AIRLINES);
    const digits = 1 + rng.int(4); // 1..4 digits
    const max = 10 ** digits;
    const number = Math.max(1, rng.int(max));
    const text = `${airline.icao}${number}`;
    if (!used.has(text)) return { airline, text };
  }
  // Fallback that cannot collide.
  const airline = rng.pick(AIRLINES);
  return { airline, text: `${airline.icao}${existing.length + 900}` };
}

function gateAvailable(gate: EntryGate, state: TrafficState, timeS: Sec): boolean {
  const last = state.gateLastSpawnS.get(gate.name);
  return last === undefined || timeS - last >= GATE_COOLDOWN_S;
}

/** Would this spawn appear too close to traffic already in the airspace? */
function vetoed(gate: EntryGate, existing: readonly Aircraft[]): boolean {
  return existing.some(
    (ac) =>
      distance({ x: ac.x, y: ac.y }, gate.position) < SPAWN_VETO_NM &&
      Math.abs(ac.altitudeFt - gate.entryAltitudeFt) < SPAWN_VETO_FT,
  );
}

export function createArrival(
  rng: Rng,
  state: TrafficState,
  gate: EntryGate,
  existing: readonly Aircraft[],
  timeS: Sec,
): Aircraft {
  const type = rng.pick(AIRCRAFT_TYPES);
  const { airline, text } = callsign(rng, existing);
  const id = state.nextId;
  state.nextId += 1;
  const altitudeFt = gate.entryAltitudeFt;

  // Center delivers the arrival established on the first leg of the STAR.
  const route = starForGate(gate.name);
  const star = route ? joinStar(route) : null;
  const headingDeg = star
    ? bearing(gate.position, star.route.waypoints[star.index]!.position)
    : gate.inboundHeadingDeg;
  // The shortest route anyone could reasonably fly, for the track-mile ratio:
  // the published arrival, then straight in from where it ends.
  const directDistanceNm = route
    ? route.lengthNm +
      distance(route.waypoints[route.waypoints.length - 1]!.position, AIRPORT.runway.threshold)
    : distance(gate.position, AIRPORT.runway.threshold);

  return {
    id,
    callsign: text,
    airline,
    type,
    x: gate.position.x,
    y: gate.position.y,
    altitudeFt,
    headingDeg,
    iasKts: ENTRY_SPEED_KTS,
    vsFpm: 0,
    targetHeadingDeg: headingDeg,
    targetAltitudeFt: altitudeFt,
    targetIasKts: ENTRY_SPEED_KTS,
    pending: [],
    star,
    phase: 'inbound',
    handedOff: false,
    speedAssignedAfterClearance: false,
    entryGate: gate.name,
    spawnedAtS: timeS,
    trackMilesFlown: 0,
    directDistanceNm,
    goArounds: 0,
    exitWarned: false,
    headingHintUntilS: 0,
    // Starts empty: a freshly handed-over target has no history behind it.
    trail: [],
    radar: {
      altitudeFt,
      iasKts: ENTRY_SPEED_KTS,
      headingDeg,
      groundSpeedKts: ENTRY_SPEED_KTS * 1.16,
      vsFpm: 0,
    },
    alert: 'none',
  };
}

/**
 * Try to hand over one arrival. Returns null when every gate is on cooldown or
 * blocked, in which case the caller retries on the next tick.
 */
export function trySpawn(
  rng: Rng,
  state: TrafficState,
  existing: readonly Aircraft[],
  timeS: Sec,
): Aircraft | null {
  const candidates = AIRPORT.gates.filter(
    (gate) => gateAvailable(gate, state, timeS) && !vetoed(gate, existing),
  );
  if (candidates.length === 0) return null;

  const gate = rng.pick(candidates);
  state.gateLastSpawnS.set(gate.name, timeS);
  return createArrival(rng, state, gate, existing, timeS);
}
