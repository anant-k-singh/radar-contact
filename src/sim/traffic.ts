/**
 * Traffic generation (docs §4.4, §4.7). Poisson arrivals at the entry gates,
 * with a per-gate cooldown and a conflict veto so Center never hands over a
 * problem — and departures off the runway on a fixed schedule, queued at the
 * holding point and released by whether the runway is free rather than by
 * anything to do with the gates.
 */
import type { AircraftType } from '../scenario/aircraftTypes.js';
import type { Airline } from '../scenario/airlines.js';


import { entryFix, starForGate } from '../scenario/routes.js';
import type { ArrivalStream, EntryGate, Scenario, Sid, Star } from '../scenario/types.js';
import { newAircraft, type Aircraft } from './aircraft.js';
import {
  ALTITUDE_STEP_FT,
  DEPARTURE_FLOW_IDLE_RECHECK_S,
  MIN_SPAWN_INTERVAL_S,
  SPAWN_VETO_FT,
  SPAWN_VETO_NM,
} from './constants.js';
import { joinSid, maxDepartureRollS } from './departure.js';
import { groundSpeed } from './dynamics.js';
import { finalGeometry } from './ils.js';
import type { Rng } from './rng.js';
import { joinStar } from './star.js';
import {
  bearing,
  distance,
  type Deg,
  type Ft,
  type Kts,
  type Nm,
  type Sec,
} from './units.js';

/**
 * One aircraft as it was handed on to the field below (§15.0f).
 *
 * Taken **at the fix both fields name** — MOLGO, KETOR, POKON, IGBAN, EMRAK —
 * because that fix is the handover, and what it is worth recording is the state
 * the next controller actually inherits: the level and speed the aircraft was
 * given rather than the ones the chart asked for. A sloppy 16,200 ft delivery
 * survives into the approach session as 16,200 ft.
 *
 * `airline` and `type` are the scenario's own objects rather than ids because
 * the ledger never leaves memory — the approach session replaces the world in
 * place, and both fields draw from the same two tables. Serialising a recording
 * (§15.0d) is what would force them back to ids.
 */
export interface Handoff {
  /** Sim time of the handover, in the *center* session's clock. */
  atS: Sec;
  callsign: string;
  airline: Airline;
  type: AircraftType;
  /**
   * Gate on the receiving field. Null only for one that crossed into the
   * terminal area with no route even remembered, which is the one case there is
   * nothing to name it by.
   */
  gateName: string | null;
  /**
   * False for an aircraft that was vectored off and crossed the inner boundary
   * unsequenced. It still entered the airspace below, so it is still handed on —
   * without a route, at the position and heading it was actually left on.
   */
  onRoute: boolean;
  x: Nm;
  y: Nm;
  altitudeFt: Ft;
  headingDeg: Deg;
  iasKts: Kts;
}

/**
 * What an arrival is filed under when it was handed over with no route even
 * remembered, so there is no gate to name it by. Never a gate on any field, and
 * never drawn from — the traffic generator only ever uses real gate names.
 */
const UNSEQUENCED_ENTRY = 'VECTORS';

/**
 * When the first scripted arrival appears, matching the arrival streams' own
 * opening clock: a session that starts on an empty scope reads as not having
 * started, and one that starts with an aircraft already there reads as having
 * started without you.
 */
const SCRIPT_START_S = 5;

/** One arrival stream's own clock and its held draw (§4.4). */
export interface StreamState {
  nextSpawnAtS: Sec;
  /**
   * The gate this stream's next arrival is already drawn for, held until that
   * gate can take it.
   *
   * Sticky within the stream for the reason the draw was sticky globally: a gate
   * inside its cooldown must not hand its turn to whichever of its neighbours is
   * free, or the busiest gate — blocked most often, because it is drawn most
   * often — donates its share to the quietest. Holding it costs nothing now that
   * a stream can only block itself.
   */
  pendingGate: string | null;
}

export interface TrafficState {
  /**
   * One clock per arrival stream, keyed by `ArrivalStream.key` (§4.4).
   *
   * Per stream and not one for the sector, because a single clock feeding a
   * single weighted draw lets a blocked stream stall every other one: the draw
   * lands on a gate inside its cooldown, the handover waits, and nobody else is
   * offered anything meanwhile. VABBS showed it plainest — KETOR's six gates
   * went 35 minutes without an arrival while MOLGO's two took ten, because every
   * draw MOLGO won held the sector until MOLGO was free again.
   *
   * Each stream now meters itself and can only ever starve itself.
   */
  streams: Map<string, StreamState>;
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
  /**
   * Chart the last departure was released on, so the next one goes somewhere
   * else (§4.7). The *chart* and not the branch name: two exits off one SID
   * share its trunk, which is where the aircraft behind catches the one in
   * front.
   */
  lastDepartureChart: string | null;
  /** Sim time of the last landing, for the runway-vacated interval. */
  lastLandingS: Sec | null;
  /**
   * How far down `World.script` the session has got (§15.0f).
   *
   * A cursor rather than a shrinking queue so the schedule itself stays the
   * immutable record of what was handed over — the replay bar counts what is
   * left off it, and a scripted session is over when the cursor reaches the end
   * rather than when the list empties.
   */
  nextScriptIndex: number;
}

export function createTrafficState(): TrafficState {
  return {
    streams: new Map(),
    gateLastSpawnS: new Map(),
    nextId: 1,
    nextDepartureAtS: 0,
    departureQueue: 0,
    lastDepartureS: null,
    lastDepartureChart: null,
    lastLandingS: null,
    nextScriptIndex: 0,
  };
}

/**
 * This stream's share of the arrival flow.
 *
 * Shares are relative, so the flow the player asks for is divided among the
 * streams in the proportions the field declares and every ratio holds at any
 * rate — which is the point of scaling here rather than baking a rate into the
 * field. At VABBS 15/h is RCMG 10.7 and RCKT 4.3; at 30/h it is 21.4 and 8.6.
 */
export function streamFlowPerHour(
  scenario: Scenario,
  stream: ArrivalStream,
  flowPerHour: number,
): number {
  const total = scenario.arrivalStreams.reduce((sum, other) => sum + Math.max(0, other.share), 0);
  if (!(total > 0)) return flowPerHour / Math.max(1, scenario.arrivalStreams.length);
  return (flowPerHour * Math.max(0, stream.share)) / total;
}

/** The stream's clock, created on first use so a field needs no set-up call. */
export function streamStateFor(state: TrafficState, stream: ArrivalStream): StreamState {
  let existing = state.streams.get(stream.key);
  if (!existing) {
    existing = { nextSpawnAtS: 0, pendingGate: null };
    state.streams.set(stream.key, existing);
  }
  return existing;
}

/**
 * Exponential inter-arrival interval for one stream, floored so the queue cannot
 * clump absurdly.
 *
 * `fromS` is the time the last arrival was *due* rather than when it appeared, so
 * a handover a cooldown held back is delayed and not cancelled — but never more
 * than one interval's worth, or a stream that was blocked for minutes repays the
 * whole debt on consecutive ticks and arrives as a burst.
 */
export function scheduleNextSpawn(
  stream: StreamState,
  rng: Rng,
  fromS: Sec,
  timeS: Sec,
  flowPerHour: number,
): void {
  const mean = 3600 / Math.max(1, flowPerHour);
  const base = Math.max(fromS, timeS - MIN_SPAWN_INTERVAL_S);
  stream.nextSpawnAtS = base + Math.max(MIN_SPAWN_INTERVAL_S, rng.exponential(mean));
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

/**
 * Every cooldown key a handover at this gate sets, and therefore every key it has
 * to be clear of: the gate itself, plus any merge group its route belongs to.
 *
 * A group is one key shared by several gates, which is the whole mechanism — two
 * routes that become one stream are offered traffic at the rate a single route
 * would be, so they are already in trail by the time they reach the merge. LSGG's
 * nine gates are three groups of three; a field with no shared trunks has no
 * groups, and this reduces to the gate's own name.
 */
function cooldownKeys(scenario: Scenario, gate: EntryGate): string[] {
  const keys = [gate.name];
  const route = starForGate(scenario, gate.name);
  if (route) {
    for (const group of scenario.mergeGroups) {
      if (group.starNames.includes(route.name)) keys.push(`merge:${group.fixName}`);
    }
  }
  return keys;
}

function gateAvailable(
  scenario: Scenario,
  gate: EntryGate,
  state: TrafficState,
  timeS: Sec,
): boolean {
  return cooldownKeys(scenario, gate).every((key) => {
    const last = state.gateLastSpawnS.get(key);
    return last === undefined || timeS - last >= scenario.traffic.gateCooldownS;
  });
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
  return levelFt !== null && levelFt > scenario.airspace.ceilingFt;
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
  // The shortest route anyone could reasonably fly, for the track-mile ratio.
  //
  // At an approach field that is the published arrival and then straight in from
  // where it ends. A center sector's aircraft never goes near the threshold — it
  // is handed on at the end of the route, 50 NM out — so the route itself is the
  // whole of what it could reasonably fly, and adding the run to a runway it will
  // not see makes every ratio read under 1 however far it is vectored.
  const toEndNm =
    scenario.role === 'center'
      ? 0
      : distance(
          route
            ? route.waypoints[route.waypoints.length - 1]!.position
            : gate.position,
          scenario.runway.threshold,
        );
  const directDistanceNm = route ? route.lengthNm + toEndNm : toEndNm;

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
 * Put one aircraft from a finished center session's ledger onto this field
 * (§15.0f) — the sibling of `createArrival` that is handed its identity and its
 * state instead of drawing them from the rng.
 *
 * What it does **not** do is as important as what it does. There is no conflict
 * veto and no gate cooldown: two aircraft handed over twenty seconds apart at
 * one gate appear twenty seconds apart, two miles in trail at the same level,
 * and that is the feature rather than a case to smooth over. The cost of poor
 * sequencing is meant to be paid by the controller downstream, and this is the
 * position downstream.
 */
export function createScriptedArrival(
  scenario: Scenario,
  state: TrafficState,
  row: Handoff,
  timeS: Sec,
): Aircraft {
  const id = state.nextId;
  state.nextId += 1;
  const gate = scenario.gates.find((entry) => entry.name === row.gateName) ?? null;
  const route = gate ? starForGate(scenario, gate.name) : null;

  // Off its route, or with no gate left to name one: it arrives where it was
  // abandoned, on the heading it was left on, with nothing flying it.
  if (!row.onRoute || !gate || !route) {
    const position = { x: row.x, y: row.y };
    const ac = newAircraft({
      id,
      callsign: row.callsign,
      airline: row.airline,
      type: row.type,
      position,
      altitudeFt: row.altitudeFt,
      headingDeg: row.headingDeg,
      iasKts: row.iasKts,
      star: null,
      phase: 'inbound',
      entryGate: row.gateName ?? UNSEQUENCED_ENTRY,
      spawnedAtS: timeS,
      // It never flew the route, so the route's length is not the shortest thing
      // it could reasonably have flown — straight in from here is.
      directDistanceNm: distance(position, scenario.runway.threshold),
    });
    // Park the route it was headed for, so `R` can still give it back. Every
    // other aircraft off its route in this sim has one parked by `leaveStar`; a
    // scripted one arriving with nothing would be the first that could only ever
    // be hand-flown onto the localizer.
    if (route) ac.rejoin = { nav: joinStar(route), leg: null };
    return ac;
  }

  // Above the level this gate publishes, the run in to the entry fix is raised to
  // meet it — the holding-stack mechanism, which converges the aircraft onto the
  // chart by the entry fix instead of writing the chart straight onto it. Below
  // it, hold the level and let the descending profile come down: an arrival is
  // never climbed back up to a profile it is under.
  const high = row.altitudeFt > gate.entryAltitudeFt;
  const star = high ? joinStar(route, row.altitudeFt) : joinStar(route);
  if (row.altitudeFt < gate.entryAltitudeFt) star.rejoining = -1;

  return newAircraft({
    id,
    callsign: row.callsign,
    airline: row.airline,
    type: row.type,
    position: gate.position,
    altitudeFt: row.altitudeFt,
    headingDeg: bearing(gate.position, star.route.waypoints[star.index]!.position),
    iasKts: row.iasKts,
    star,
    phase: 'inbound',
    entryGate: gate.name,
    spawnedAtS: timeS,
    directDistanceNm:
      route.lengthNm +
      distance(route.waypoints[route.waypoints.length - 1]!.position, scenario.runway.threshold),
  });
}

/**
 * Turn a finished session's ledger into a schedule for the next one (§15.0f).
 *
 * Only the clock changes: the first handover lands at `SCRIPT_START_S` and every
 * other row keeps its interval from it exactly, so the sequence, the gaps and
 * the bunching are the ones the center controller made. Sorted, because the two
 * capture sites commit in the order aircraft leave rather than in time order —
 * the cursor only walks forward, and an out-of-order row would be released late.
 */
export function scriptFrom(handedOn: readonly Handoff[]): Handoff[] {
  const rows = [...handedOn].sort((a, b) => a.atS - b.atS);
  const first = rows[0]?.atS ?? 0;
  return rows.map((row) => ({ ...row, atS: row.atS - first + SCRIPT_START_S }));
}

/**
 * Release everything on the schedule that has come due (§15.0f).
 *
 * The rows are in the order they were handed over and the cursor only moves
 * forward, so the approach session sees the center session's sequence exactly —
 * including its mistakes. Returns what was released, for the caller to log and
 * count the way it does a generated arrival.
 */
export function releaseScripted(
  scenario: Scenario,
  script: readonly Handoff[],
  state: TrafficState,
  timeS: Sec,
): Aircraft[] {
  const released: Aircraft[] = [];
  while (state.nextScriptIndex < script.length) {
    const row = script[state.nextScriptIndex]!;
    if (row.atS > timeS) break;
    released.push(createScriptedArrival(scenario, state, row, timeS));
    state.nextScriptIndex += 1;
  }
  return released;
}

/**
 * Try to hand over one arrival on this stream. Returns null when the gate it is
 * for cannot take it yet, in which case the caller retries on the next tick.
 *
 * Which gate that is was drawn once from the stream's own gates and is then
 * waited for, rather than redrawn each tick among whatever is free. The
 * spawner's job is to offer the field its traffic in the proportions the field
 * declares; a gate that is congested stays congested and the aircraft waits,
 * because moving it to another arrival is the controller's decision and not the
 * generator's.
 *
 * Waiting is cheap now that it is scoped to one stream: the other streams keep
 * their own clocks and are unaffected, where a single global draw meant one busy
 * gate stalled every arrival in the sector.
 *
 * A stack at the ceiling is the one thing that releases the draw: there is no
 * level left to deliver anyone on there (§4.5), so that gate is out of the
 * question rather than merely busy, and holding the stream behind it would stop
 * the stream instead of the gate.
 */
export function trySpawn(
  scenario: Scenario,
  stream: ArrivalStream,
  rng: Rng,
  state: TrafficState,
  existing: readonly Aircraft[],
  timeS: Sec,
): Aircraft | null {
  const clock = streamStateFor(state, stream);
  const inStream = scenario.gates.filter((gate) => stream.gateNames.includes(gate.name));
  const open = inStream.filter((gate) => !stackFull(scenario, gate, existing));
  if (open.length === 0) {
    clock.pendingGate = null;
    return null;
  }

  // Weighted, because which direction traffic comes from is a fact about the
  // field (§4.4). The weights are the field's own and are read *within* the
  // stream, so splitting the draw in two changed no declared ratio. A field that
  // states no weights gets the even split it always had, from the same draw.
  let gate = open.find((candidate) => candidate.name === clock.pendingGate);
  if (!gate) {
    gate = rng.pickWeighted(open, (candidate) => candidate.weight);
    clock.pendingGate = gate.name;
  }

  if (!gateAvailable(scenario, gate, state, timeS) || vetoed(gate, existing)) return null;

  clock.pendingGate = null;
  // Every key this handover occupies, so a merge group goes quiet as a whole.
  for (const key of cooldownKeys(scenario, gate)) state.gateLastSpawnS.set(key, timeS);
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
  if (state.lastDepartureS !== null && timeS - state.lastDepartureS < scenario.runwayOps.minDepartureIntervalS) {
    return 'departure spacing';
  }
  if (state.lastLandingS !== null && timeS - state.lastLandingS < scenario.runwayOps.holdAfterLandingS) {
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
  const requiredS = maxDepartureRollS(scenario.fleet) + scenario.runwayOps.airborneMarginS;
  const shortFinal = existing.find((ac) => {
    if (ac.phase !== 'loc' && ac.phase !== 'gs') return false;
    const alongNm = finalGeometry(scenario.runway, ac).alongNm;
    if (alongNm <= 0) return false;
    if (alongNm <= scenario.runwayOps.holdFinalNm) return true;
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
    sid: joinSid(route, scenario.elevationFt, scenario.performance.departureClimbScale),
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
  // A field may publish no SIDs at all — an en-route sector owns no runway to
  // release one from, whatever its `departuresPerHour` happens to say. Checked
  // before the runway, since a field with nowhere to go is not a field whose
  // runway is momentarily busy.
  if (scenario.sids.length === 0) return null;
  if (runwayBlockedBy(scenario, state, existing, timeS) !== null) return null;
  // Weighted, not uniform: which way an airport's traffic leaves is a fact about
  // the route network, and at LSGG the busiest way out carries four times the
  // quietest. `pickWeighted` draws once and lands where `pick` would when every
  // weight is equal, so ZZZZ and VABB draw the same departures from the same seed.
  //
  // Never twice down the same chart in a row. Two departures on one trunk are
  // separated by climb rate alone, so an A332 followed by an E190 closes the
  // gap and neither can be turned or levelled out of it — a departure takes no
  // instructions (§4.7), which makes it the one conflict the player cannot
  // solve. Excluding the last chart before the draw keeps this to the single
  // `pickWeighted` call the seeded stream expects.
  const elsewhere = scenario.sids.filter((sid) => sid.chart !== state.lastDepartureChart);
  // A field with one chart has nowhere else to send it, and one departure down
  // it beats none.
  const route = rng.pickWeighted(
    elsewhere.length > 0 ? elsewhere : scenario.sids,
    (sid) => sid.weight,
  );
  state.lastDepartureS = timeS;
  state.lastDepartureChart = route.chart;
  return createDeparture(scenario, rng, state, route, existing, timeS);
}
