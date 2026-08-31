/**
 * Traffic generation (docs §4.4, §4.7). Poisson arrivals at the entry gates,
 * with a per-gate cooldown and a conflict veto so Center never hands over a
 * problem — and departures off the runway on a fixed schedule, queued at the
 * holding point and released by whether the runway is free rather than by
 * anything to do with the gates.
 */
import type { Airline } from '../scenario/airlines.js';


import { entryFix, starForGate } from '../scenario/routes.js';
import type { EntryGate, Scenario, Sid, Star } from '../scenario/types.js';
import { newAircraft, type Aircraft } from './aircraft.js';
import {
  ALTITUDE_STEP_FT,
  CEILING_FT,
  DEPARTURE_AIRBORNE_MARGIN_S,
  DEPARTURE_FLOW_IDLE_RECHECK_S,
  DEPARTURE_HOLD_AFTER_LANDING_S,
  DEPARTURE_HOLD_FINAL_NM,
  DEPARTURE_MIN_INTERVAL_S,
  GATE_COOLDOWN_S,
  MIN_SPAWN_INTERVAL_S,
  SPAWN_VETO_FT,
  SPAWN_VETO_NM,
} from './constants.js';
import { joinSid, maxDepartureRollS } from './departure.js';
import { groundSpeed } from './dynamics.js';
import { finalGeometry } from './ils.js';
import type { Rng } from './rng.js';
import { joinStar } from './star.js';
import { bearing, distance, type Ft, type Sec } from './units.js';

export interface TrafficState {
  nextSpawnAtS: Sec;
  gateLastSpawnS: Map<string, Sec>;
  nextId: number;
  /** When the next departure joins the hold-short queue. */
  nextDepartureAtS: Sec;
  /**
   * Departures holding short, waiting for the runway (§4.7).
   *
   * A count rather than a list of aircraft: nothing observes a departure before
   * it rolls — it is not on the scope, not on a frequency and has no callsign
   * anyone can read — so the type, callsign and SID are drawn at the release
   * instead, and the queue is exactly as much state as it needs to be.
   */
  departureQueue: number;
  /** Sim time the last departure began its roll, for the wake-turbulence interval. */
  lastDepartureS: Sec | null;
  /** Sim time of the last landing, for the runway-vacated interval. */
  lastLandingS: Sec | null;
}

export function createTrafficState(): TrafficState {
  return {
    nextSpawnAtS: 0,
    gateLastSpawnS: new Map(),
    nextId: 1,
    nextDepartureAtS: 0,
    departureQueue: 0,
    lastDepartureS: null,
    lastLandingS: null,
  };
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

function callsign(
  airlines: readonly Airline[],
  rng: Rng,
  existing: readonly Aircraft[],
): { airline: Airline; text: string } {
  const used = new Set(existing.map((ac) => ac.callsign));
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const airline = rng.pick(airlines);
    const digits = 1 + rng.int(4); // 1..4 digits
    const max = 10 ** digits;
    const number = Math.max(1, rng.int(max));
    const text = `${airline.icao}${number}`;
    if (!used.has(text)) return { airline, text };
  }
  // Fallback that cannot collide.
  const airline = rng.pick(airlines);
  return { airline, text: `${airline.icao}${existing.length + 900}` };
}

/**
 * The level to deliver the next arrival on this route at, given whatever is
 * already holding at its entry fix (§4.5).
 *
 * The four entry fixes are the ones a sequence backs up onto, and a hold there
 * is flown level, so a second aircraft arriving on the published crossing would
 * fly straight into the first. Center therefore delivers it **1000 ft above the
 * highest aircraft in the stack**, on the assignable grid — which is exactly
 * what a real stack is: an ordered column, filled from the bottom.
 *
 * Returns null when nothing is holding there, in which case the aircraft flies
 * the published chart and nothing about this exists.
 */
export function holdingStackLevelFt(route: Star, existing: readonly Aircraft[]): Ft | null {
  const fixName = entryFix(route).name;
  let topFt = Number.NEGATIVE_INFINITY;
  for (const ac of existing) {
    const hold = ac.star?.hold;
    // The target rather than the live altitude: an aircraft still descending
    // into the pattern already owns the level it is descending to.
    if (hold?.fix === fixName) topFt = Math.max(topFt, ac.targetAltitudeFt);
  }
  if (topFt === Number.NEGATIVE_INFINITY) return null;
  return Math.ceil(topFt / ALTITUDE_STEP_FT) * ALTITUDE_STEP_FT + ALTITUDE_STEP_FT;
}

function gateAvailable(gate: EntryGate, state: TrafficState, timeS: Sec): boolean {
  const last = state.gateLastSpawnS.get(gate.name);
  return last === undefined || timeS - last >= GATE_COOLDOWN_S;
}

/**
 * True when the holding stack at this gate's entry fix reaches the ceiling, so
 * there is no level left to deliver anyone on (§4.5).
 *
 * Center simply stops handing traffic over on that route until the stack
 * drains. Delivering above `CEILING_FT` would put an arrival higher than the
 * player is allowed to assign, and delivering *at* the top of the stack would
 * create the conflict the stacking exists to prevent — so neither is offered,
 * and the gate goes quiet instead.
 */
function stackFull(scenario: Scenario, gate: EntryGate, existing: readonly Aircraft[]): boolean {
  const route = starForGate(scenario, gate.name);
  if (!route) return false;
  const levelFt = holdingStackLevelFt(route, existing);
  return levelFt !== null && levelFt > CEILING_FT;
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
  scenario: Scenario,
  rng: Rng,
  state: TrafficState,
  gate: EntryGate,
  existing: readonly Aircraft[],
  timeS: Sec,
): Aircraft {
  const type = rng.pick(scenario.fleet);
  const { airline, text } = callsign(scenario.airlines, rng, existing);
  const id = state.nextId;
  state.nextId += 1;
  // Center delivers the arrival established on the first leg of the STAR —
  // above whatever is already holding at its entry fix, if anything is (§4.5).
  const route = starForGate(scenario, gate.name);
  const stackLevelFt = route ? holdingStackLevelFt(route, existing) : null;
  const altitudeFt = Math.max(gate.entryAltitudeFt, stackLevelFt ?? 0);
  const star = route ? joinStar(route, stackLevelFt) : null;
  const headingDeg = star
    ? bearing(gate.position, star.route.waypoints[star.index]!.position)
    : gate.inboundHeadingDeg;
  // The shortest route anyone could reasonably fly, for the track-mile ratio:
  // the published arrival, then straight in from where it ends.
  const directDistanceNm = route
    ? route.lengthNm +
      distance(route.waypoints[route.waypoints.length - 1]!.position, scenario.runway.threshold)
    : distance(gate.position, scenario.runway.threshold);

  return newAircraft({
    id,
    callsign: text,
    airline,
    type,
    position: gate.position,
    altitudeFt,
    headingDeg,
    iasKts: gate.entrySpeedKts,
    star,
    phase: 'inbound',
    entryGate: gate.name,
    spawnedAtS: timeS,
    directDistanceNm,
  });
}

/**
 * Try to hand over one arrival. Returns null when every gate is on cooldown or
 * blocked, in which case the caller retries on the next tick.
 */
export function trySpawn(
  scenario: Scenario,
  rng: Rng,
  state: TrafficState,
  existing: readonly Aircraft[],
  timeS: Sec,
): Aircraft | null {
  const candidates = scenario.gates.filter(
    (gate) =>
      gateAvailable(gate, state, timeS) &&
      !vetoed(gate, existing) &&
      !stackFull(scenario, gate, existing),
  );
  if (candidates.length === 0) return null;

  const gate = rng.pick(candidates);
  state.gateLastSpawnS.set(gate.name, timeS);
  return createArrival(scenario, rng, state, gate, existing, timeS);
}

// ── Departures (§4.7) ───────────────────────────────────────────────────────

/**
 * When the next departure joins the queue — the flow interval exactly, not a
 * Poisson draw.
 *
 * The arrivals are random because Center's delivery is the problem the player
 * is given; the departures are an airline schedule, and 20 an hour means one
 * every three minutes. It also makes the queue mean something: it grows because
 * the runway is not releasing, never because the generator happened to clump.
 */
export function scheduleNextDeparture(state: TrafficState, timeS: Sec, flowPerHour: number): void {
  if (flowPerHour <= 0) {
    // Nothing is scheduled while the flow is off, but the spawner still has to
    // be woken periodically or turning the flow back up would do nothing.
    state.nextDepartureAtS = timeS + DEPARTURE_FLOW_IDLE_RECHECK_S;
    return;
  }
  state.nextDepartureAtS = timeS + 3600 / flowPerHour;
}

/**
 * Why the departure at the head of the queue cannot roll right now, or null
 * when the runway is free.
 *
 * One runway, shared with the arrivals (§4.7): an aircraft on short final owns
 * it, and a landing one owns it until it has vacated. This is the coupling that
 * makes the departure flow a request rather than a promise — run a tight
 * arrival sequence and the departures back up behind it, which is what the
 * queue length in the stats gutter is showing.
 */
export function runwayBlockedBy(
  scenario: Scenario,
  state: TrafficState,
  existing: readonly Aircraft[],
  timeS: Sec,
): string | null {
  if (state.lastDepartureS !== null && timeS - state.lastDepartureS < DEPARTURE_MIN_INTERVAL_S) {
    return 'departure spacing';
  }
  if (state.lastLandingS !== null && timeS - state.lastLandingS < DEPARTURE_HOLD_AFTER_LANDING_S) {
    return 'landing traffic rolling out';
  }
  // Anything already on the runway — the previous departure has not lifted off.
  if (existing.some((ac) => ac.phase === 'roll')) return 'runway occupied';

  // The arrival test, in time rather than in distance. What matters is whether
  // the departure will be airborne with room to spare before the arrival
  // crosses the threshold, and that depends on how fast the arrival is actually
  // flying — one still carrying speed blocks from further out than one already
  // slowed to its approach speed. The take-off roll is the fleet's longest,
  // since the type is not drawn until the release itself.
  const requiredS = maxDepartureRollS(scenario.fleet) + DEPARTURE_AIRBORNE_MARGIN_S;
  const shortFinal = existing.find((ac) => {
    if (ac.phase !== 'loc' && ac.phase !== 'gs') return false;
    const alongNm = finalGeometry(scenario.runway, ac).alongNm;
    if (alongNm <= 0) return false;
    if (alongNm <= DEPARTURE_HOLD_FINAL_NM) return true;
    const speedNmS = groundSpeed(ac) / 3600;
    return speedNmS > 0 && alongNm / speedNmS < requiredS;
  });
  return shortFinal ? `arrival on short final` : null;
}

/**
 * Build a departure at the holding point, ready to roll. It starts stationary on
 * the threshold at field elevation — the one aircraft in the simulation that is
 * not flying — and everything about it comes from the type and the route rather
 * than from a gate.
 */
export function createDeparture(
  scenario: Scenario,
  rng: Rng,
  state: TrafficState,
  route: Sid,
  existing: readonly Aircraft[],
  timeS: Sec,
): Aircraft {
  const type = rng.pick(scenario.fleet);
  const { airline, text } = callsign(scenario.airlines, rng, existing);
  const id = state.nextId;
  state.nextId += 1;

  const runway = scenario.runway;

  return newAircraft({
    id,
    callsign: text,
    airline,
    type,
    position: runway.threshold,
    altitudeFt: scenario.elevationFt,
    headingDeg: runway.courseDeg,
    // Stationary on the threshold — the one aircraft in the simulation that is
    // not flying — and already spooled up to the speed it will rotate at.
    iasKts: 0,
    targetIasKts: type.v2Kts,
    sid: joinSid(route, scenario.elevationFt),
    phase: 'roll',
    // The runway is where it entered the airspace, in the sense the entry gate
    // is for an arrival: the one place its track can be said to start.
    entryGate: `RWY${runway.id}`,
    spawnedAtS: timeS,
  });
}

/**
 * Release the departure at the head of the queue if the runway is free. Returns
 * null when it is not, and the caller leaves it in the queue: a departure held
 * for traffic still goes, just later.
 *
 * The random stream is only drawn on once the release is certain, so a hundred
 * blocked ticks do not shift the type or the SID the departure ends up with.
 */
export function tryDeparture(
  scenario: Scenario,
  rng: Rng,
  state: TrafficState,
  existing: readonly Aircraft[],
  timeS: Sec,
): Aircraft | null {
  if (runwayBlockedBy(scenario, state, existing, timeS) !== null) return null;
  const route = rng.pick(scenario.sids);
  state.lastDepartureS = timeS;
  return createDeparture(scenario, rng, state, route, existing, timeS);
}
