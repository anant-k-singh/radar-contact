/**
 * The world: one mutable state object plus `step(world, dt)`.
 * No DOM, no rendering, no input — see docs §11.4.
 */
import { AIRPORT } from '../scenario/airport.js';
import type { Aircraft } from './aircraft.js';
import { isDeparture, sampleRadar } from './aircraft.js';
import { boundaryMarginNm } from './airspace.js';
import {
  DEPARTURE_FLOW_DEFAULT_PER_HOUR,
  DEPARTURE_HOLD_AFTER_LANDING_S,
  DEPARTURE_FREQUENCY,
  EXIT_WARN_MARGIN_NM,
  FLOW_DEFAULT_PER_HOUR,
  HISTORY_PERIOD_S,
  IN_TRAIL_MIN_NM,
  MOVEMENT_RATE_MIN_ELAPSED_S,
  MOVEMENT_RATE_WINDOW_S,
  MESSAGE_LOG_MAX,
  RADAR_PERIOD_S,
  TOWER_FREQUENCY,
  TRAIL_LENGTH,
} from './constants.js';
import { stepDeparture } from './departure.js';
import { groundSpeed, stepKinematics } from './dynamics.js';
import { finalGeometry, isEstablished, stepApproach } from './ils.js';
import { applyDueInstructions } from './pilot.js';
import { createRng, type Rng } from './rng.js';
import { analyzeSeparation, type SeparationReport } from './separation.js';
import { starOwnsVertical, stepStar } from './star.js';
import {
  createTrafficState,
  scheduleNextDeparture,
  scheduleNextSpawn,
  tryDeparture,
  trySpawn,
  type TrafficState,
} from './traffic.js';
import { distance, headingVector, type Nm, type Sec } from './units.js';

export type MessageKind = 'pilot' | 'system' | 'alert';

export interface Message {
  timeS: Sec;
  text: string;
  kind: MessageKind;
  /**
   * Aircraft the line is about, so selecting one filters the log down to its
   * own exchanges (§7.1). A separation call names two; the handful of lines
   * that are about no aircraft in particular carry none, and are always shown.
   */
  aircraftIds: number[];
}

export interface Stats {
  landings: number;
  /** Sim time of each landing inside the rate window; older ones are dropped. */
  landingTimesS: Sec[];
  /** Departures that got airborne and left the area on their SID (§4.7). */
  departures: number;
  /**
   * Sim time each departure began its take-off roll, inside the rate window.
   *
   * Timed at the *roll*, not at the airspace exit that `departures` counts —
   * the departure rate is a measure of what the runway is getting away, and an
   * exit happens eight minutes downstream of the runway decision that caused it
   * (§8.2). Older entries are dropped, exactly as the landing times are.
   */
  departureTimesS: Sec[];
  handoffs: number;
  violations: number;
  violationSeconds: number;
  goArounds: number;
  exits: number;
  rejections: Map<string, number>;
  /** Clearances that were accepted but did not intercept, by reason (§6.1a). */
  missedIntercepts: Map<string, number>;
  trackMileRatioSum: number;
  trackMileSamples: number;
}

export interface World {
  timeS: Sec;
  aircraft: Aircraft[];
  messages: Message[];
  stats: Stats;
  flowPerHour: number;
  /** Departures released per hour, 0–20 (§4.7). Zero switches them off. */
  departureFlowPerHour: number;
  rng: Rng;
  /**
   * Pilot reaction times come from their own stream, so how much the player
   * talks cannot shift the traffic sequence a seed produces.
   */
  pilotRng: Rng;
  /**
   * Departures get a third stream for the same reason: the arrival sequence a
   * seed generates is the thing a player reproduces with `?seed=`, and it must
   * not shift because the departure flow was turned up.
   */
  departureRng: Rng;
  traffic: TrafficState;
  separation: SeparationReport;
  selectedId: number | null;
  paused: boolean;
  timeScale: number;
  nextRadarAtS: Sec;
  nextHistoryAtS: Sec;
  /** Violation pair key → sim time the violation began. */
  activeViolations: Map<string, Sec>;
}

export function createWorld(
  seed: number,
  flowPerHour = FLOW_DEFAULT_PER_HOUR,
  departureFlowPerHour = DEPARTURE_FLOW_DEFAULT_PER_HOUR,
): World {
  const traffic = createTrafficState();
  traffic.nextSpawnAtS = 5; // don't stare at an empty scope
  // The first departure waits longer than the first arrival: a session that
  // opens on an aircraft already rolling reads as having started without you.
  traffic.nextDepartureAtS = 45;
  return {
    timeS: 0,
    aircraft: [],
    messages: [],
    stats: {
      landings: 0,
      landingTimesS: [],
      departures: 0,
      departureTimesS: [],
      handoffs: 0,
      violations: 0,
      violationSeconds: 0,
      goArounds: 0,
      exits: 0,
      rejections: new Map(),
      missedIntercepts: new Map(),
      trackMileRatioSum: 0,
      trackMileSamples: 0,
    },
    flowPerHour,
    departureFlowPerHour,
    rng: createRng(seed),
    pilotRng: createRng(seed ^ 0x5f356495),
    departureRng: createRng(seed ^ 0x2545f491),
    traffic,
    separation: {
      pairs: [],
      alerts: new Map(),
      inTrail: new Map(),
      inTrailLeader: new Map(),
      inTrailMinimum: new Map(),
    },
    selectedId: null,
    paused: false,
    timeScale: 1,
    nextRadarAtS: 0,
    nextHistoryAtS: 0,
    activeViolations: new Map(),
  };
}

export function log(
  world: World,
  text: string,
  kind: MessageKind = 'system',
  aircraftIds: number[] = [],
): void {
  world.messages.push({ timeS: world.timeS, text, kind, aircraftIds });
  if (world.messages.length > MESSAGE_LOG_MAX) {
    world.messages.splice(0, world.messages.length - MESSAGE_LOG_MAX);
  }
}

/**
 * The log the controller should be reading. Once an aircraft is selected the
 * log answers "what did I tell *this* one, and what did it say" — at 20-plus
 * aircraft the unfiltered log scrolls past faster than a readback can be found
 * in it (§7.1). With nothing selected it is the whole frequency again. A
 * separation call names two aircraft and so appears under either of them.
 */
export function messagesFor(world: World): Message[] {
  const id = world.selectedId;
  if (id === null) return world.messages;
  return world.messages.filter((message) => message.aircraftIds.includes(id));
}

export function findAircraft(world: World, id: number | null): Aircraft | undefined {
  if (id === null) return undefined;
  return world.aircraft.find((ac) => ac.id === id);
}

export function selectedAircraft(world: World): Aircraft | undefined {
  return findAircraft(world, world.selectedId);
}

/** Only the window is ever read, so a movement list never grows past it. */
function trimToRateWindow(timesS: Sec[], nowS: Sec): void {
  const since = nowS - MOVEMENT_RATE_WINDOW_S;
  const stale = timesS.findIndex((timeS) => timeS >= since);
  if (stale > 0) timesS.splice(0, stale);
}

function remove(world: World, ac: Aircraft): void {
  const index = world.aircraft.indexOf(ac);
  if (index >= 0) world.aircraft.splice(index, 1);
  if (world.selectedId === ac.id) world.selectedId = null;
}

/**
 * Movements per hour over the trailing window (§8.2), or null while the session
 * is too young for the sample to mean anything. Extrapolated from however much
 * of the window has actually elapsed, so it settles rather than ramping up.
 */
function ratePerHour(world: World, timesS: readonly Sec[]): number | null {
  const elapsedS = Math.min(MOVEMENT_RATE_WINDOW_S, world.timeS);
  if (elapsedS < MOVEMENT_RATE_MIN_ELAPSED_S) return null;
  const since = world.timeS - MOVEMENT_RATE_WINDOW_S;
  const count = timesS.filter((timeS) => timeS >= since).length;
  return (count / elapsedS) * 3600;
}

export function landingRatePerHour(world: World): number | null {
  return ratePerHour(world, world.stats.landingTimesS);
}

/**
 * Departures per hour off the runway. Read next to the landing rate, it is the
 * other half of what the one runway actually achieved — and next to the
 * departure flow setting, it is how much of what was asked for got away, which
 * a busy final quietly eats into (§4.7).
 */
export function departureRatePerHour(world: World): number | null {
  return ratePerHour(world, world.stats.departureTimesS);
}

/**
 * How many departures are holding short waiting for the runway (§8.2).
 *
 * Read alongside `DEP RATE`: the rate says what the runway got away, and this
 * says what it owes. A queue that only grows is a final that never gives the
 * runway back.
 */
export function departureQueueLength(world: World): number {
  return world.traffic.departureQueue;
}

/**
 * True while the runway cannot be landed on: something is rolling on it, or a
 * landing is still vacating it (§9.4).
 *
 * The landing that owns it has already been removed from the scope — it stops
 * being an air-traffic problem the moment it touches down — so the runway
 * remembers it as a time instead. That is what makes the occupancy real for
 * arrivals rather than only for departures.
 */
export function runwayOccupied(world: World): boolean {
  const { lastLandingS } = world.traffic;
  if (lastLandingS !== null && world.timeS - lastLandingS < DEPARTURE_HOLD_AFTER_LANDING_S) {
    return true;
  }
  return world.aircraft.some((ac) => ac.phase === 'roll');
}

/** Projected in-trail spacing when the aircraft ahead reaches the threshold (§9.3). */
export function projectedSpacingNm(follower: Aircraft, leader: Aircraft): Nm {
  const followerAlong = finalGeometry(follower).alongNm;
  const leaderAlong = finalGeometry(leader).alongNm;
  const leaderSpeed = groundSpeed(leader) / 3600;
  if (leaderSpeed <= 0) return followerAlong - leaderAlong;
  const secondsToThreshold = leaderAlong / leaderSpeed;
  return followerAlong - (groundSpeed(follower) / 3600) * secondsToThreshold;
}

function tryHandoff(world: World, ac: Aircraft): void {
  if (ac.handedOff || ac.phase !== 'gs') return;
  const geo = finalGeometry(ac);
  if (!isEstablished(ac, geo)) return;

  const leader = world.separation.inTrailLeader.get(ac.id);
  // Keep it on frequency until the closure rate is acceptable,
  // against whichever in-trail minimum applies at its current range (§9.3).
  const minimumNm = world.separation.inTrailMinimum.get(ac.id) ?? IN_TRAIL_MIN_NM;
  if (leader && projectedSpacingNm(ac, leader) < minimumNm) return;

  ac.handedOff = true;
  world.stats.handoffs += 1;
  log(world, `${ac.callsign}, contact Tower on ${TOWER_FREQUENCY}.`, 'system', [ac.id]);
}

function checkAirspaceExit(world: World, ac: Aircraft): boolean {
  const range = distance({ x: ac.x, y: ac.y }, AIRPORT.arp);
  const track = headingVector(ac.headingDeg);
  const outbound = range > 0 && (ac.x * track.x + ac.y * track.y) / range > 0;

  if (!outbound) {
    ac.exitWarned = false;
    return false;
  }

  // Against the boundary's actual shape, not just the radius: the airspace is
  // cut off north and south (§3.1), so an aircraft can run out of room while
  // still well inside 50 NM.
  const marginNm = boundaryMarginNm({ x: ac.x, y: ac.y });
  if (marginNm < 0) {
    // A departure leaving is the whole point of it, not a mistake: it counts in
    // its own tally and says so in the ordinary voice rather than the alert one.
    if (isDeparture(ac)) {
      world.stats.departures += 1;
      log(
        world,
        `${ac.callsign} clear of the area on the ${ac.sid!.route.name} departure.`,
        'system',
        [ac.id],
      );
    } else {
      world.stats.exits += 1;
      log(world, `${ac.callsign} leaving your airspace, returned to Center.`, 'alert', [ac.id]);
    }
    remove(world, ac);
    return true;
  }
  // The warning is for an arrival about to be lost. A departure is *supposed* to
  // run out of airspace, so there is nothing to warn about.
  if (marginNm < EXIT_WARN_MARGIN_NM && !ac.exitWarned && !isDeparture(ac)) {
    ac.exitWarned = true;
    log(world, `${ac.callsign} is approaching the airspace boundary.`, 'alert', [ac.id]);
  }
  return false;
}

/**
 * One tick of a departure: its own flight model, then ordinary kinematics —
 * except during the take-off roll, which integrates itself because an aircraft
 * on the ground neither turns, climbs, nor gains TAS with altitude (§4.7).
 *
 * Returns true when the aircraft has left the airspace and been removed.
 */
function stepDepartureFlight(world: World, ac: Aircraft, dt: Sec): boolean {
  for (const event of stepDeparture(ac, dt)) {
    switch (event.kind) {
      case 'airborne':
        log(
          world,
          `${ac.callsign} airborne runway ${AIRPORT.runway.id}, ${event.sid} departure, ` +
            `contact Departure on ${DEPARTURE_FREQUENCY}.`,
          'system',
          [ac.id],
        );
        break;
      case 'sidComplete':
        log(world, `${ac.callsign} at ${event.fix}, end of the departure.`, 'pilot', [ac.id]);
        break;
    }
  }

  if (ac.phase !== 'roll') stepKinematics(ac, dt);
  return checkAirspaceExit(world, ac);
}

function accountViolations(world: World, dt: Sec): void {
  const seen = new Set<string>();
  for (const pair of world.separation.pairs) {
    if (pair.level !== 'violation') continue;
    seen.add(pair.key);
    if (!world.activeViolations.has(pair.key)) {
      world.activeViolations.set(pair.key, world.timeS);
      world.stats.violations += 1;
      log(
        world,
        `SEPARATION: ${pair.a.callsign} / ${pair.b.callsign} — ` +
          `${pair.horizNm.toFixed(1)} NM, ${Math.round(pair.vertFt)} ft.`,
        'alert',
        [pair.a.id, pair.b.id],
      );
    }
    world.stats.violationSeconds += dt;
  }
  for (const key of [...world.activeViolations.keys()]) {
    if (!seen.has(key)) world.activeViolations.delete(key);
  }
}

function sampleRadarReturns(world: World): void {
  for (const ac of world.aircraft) {
    ac.radar = sampleRadar(ac, groundSpeed(ac));
    ac.alert = world.separation.alerts.get(ac.id) ?? 'none';
  }
}

function sampleHistory(world: World): void {
  for (const ac of world.aircraft) {
    ac.trail.push({ x: ac.x, y: ac.y });
    if (ac.trail.length > TRAIL_LENGTH) ac.trail.splice(0, ac.trail.length - TRAIL_LENGTH);
  }
}

export function step(world: World, dt: Sec): void {
  world.timeS += dt;

  // ── Arrivals ─────────────────────────────────────────────────────────────
  if (world.timeS >= world.traffic.nextSpawnAtS) {
    const arrival = trySpawn(world.rng, world.traffic, world.aircraft, world.timeS);
    if (arrival) {
      world.aircraft.push(arrival);
      scheduleNextSpawn(world.traffic, world.rng, world.timeS, world.flowPerHour);
      const routing = arrival.star
        ? `on the ${arrival.star.route.name} arrival`
        : `inbound ${arrival.entryGate}`;
      log(
        world,
        `${arrival.callsign} (${arrival.type.code}) with you at ${Math.round(arrival.altitudeFt)} ft, ` +
          `${Math.round(arrival.iasKts)} knots, ${routing}.`,
        'pilot',
        [arrival.id],
      );
    }
  }

  // ── Departures ───────────────────────────────────────────────────────────
  // Two separate things, and keeping them apart is the point (§4.7). The flow
  // decides how often a departure turns up at the holding point; the *runway*
  // decides when one rolls. What sits between the two is a queue, and its
  // length is the player's arrival spacing measured from the other side.
  if (world.timeS >= world.traffic.nextDepartureAtS) {
    if (world.departureFlowPerHour > 0) world.traffic.departureQueue += 1;
    scheduleNextDeparture(world.traffic, world.timeS, world.departureFlowPerHour);
  }

  // The head of the queue takes the runway the moment it is free, which is any
  // tick at all rather than only the ones the flow lands on — a departure held
  // for landing traffic goes as soon as that traffic is out of the way, not at
  // the next scheduled release. A queue built while the flow was on still
  // drains after it is turned off: those aircraft are already at the threshold.
  if (world.traffic.departureQueue > 0) {
    const departure = tryDeparture(world.departureRng, world.traffic, world.aircraft, world.timeS);
    if (departure) {
      world.traffic.departureQueue -= 1;
      world.aircraft.push(departure);
      world.stats.departureTimesS.push(world.timeS);
      trimToRateWindow(world.stats.departureTimesS, world.timeS);
      const route = departure.sid!.route;
      // The turn is worth saying while the aircraft is still on the ground:
      // it is the one moment the player can see a departure coming before it
      // is anywhere, and which way it goes is what they plan around.
      const out = route.turn === 'straight' ? 'straight out' : `${route.turn} turn out`;
      const waiting =
        world.traffic.departureQueue > 0 ? ` ${world.traffic.departureQueue} more holding.` : '';
      log(
        world,
        `${departure.callsign} (${departure.type.code}) rolling runway ${AIRPORT.runway.id}, ` +
          `${route.name} departure — ${out}.${waiting}`,
        'system',
        [departure.id],
      );
    }
  }

  // Is there anything on the runway? A departure still rolling, or a landing
  // inside its runway occupancy time — the same 60 s that holds the next
  // departure, applied to the arrivals as well (§9.4). Read once for the tick,
  // before anything moves, so every aircraft sees the same runway.
  const occupied = runwayOccupied(world);

  // ── Separation ───────────────────────────────────────────────────────────
  // Analysed before flying, so in-trail spacing and the handoff closure check
  // see this tick's picture rather than the previous one's — which on the very
  // first tick of a session would be empty.
  world.separation = analyzeSeparation(world.aircraft);
  accountViolations(world, dt);

  // ── Fly ──────────────────────────────────────────────────────────────────
  for (const ac of [...world.aircraft]) {
    // A departure is on Departure's frequency and takes no instructions from us,
    // so it never touches the arrival path at all — no STAR, no approach, no
    // handoff to Tower (§4.7).
    if (isDeparture(ac)) {
      stepDepartureFlight(world, ac, dt);
      continue;
    }

    // Instructions the crew has now had time to act on, then the route they
    // fly in the absence of one.
    for (const readback of applyDueInstructions(ac, world.timeS)) {
      log(world, readback.text, readback.kind, [ac.id]);
    }
    for (const event of stepStar(ac, dt, world.timeS)) {
      switch (event.kind) {
        case 'starComplete':
          log(
            world,
            `${ac.callsign} at ${event.fix}, end of the arrival — maintaining heading, ` +
              `request further.`,
            'pilot',
            [ac.id],
          );
          break;
        case 'holdEntered':
          log(world, `${ac.callsign} entering the hold at ${event.fix}.`, 'pilot', [ac.id]);
          break;
        case 'holdExited':
          log(world, `${ac.callsign} leaving ${event.fix}, back on the arrival.`, 'pilot', [
            ac.id,
          ]);
          break;
      }
    }

    const geo = finalGeometry(ac);
    const inTrailNm = world.separation.inTrail.get(ac.id) ?? null;
    const events = stepApproach(ac, geo, { inTrailNm, runwayOccupied: occupied }, dt);

    let removed = false;
    for (const event of events) {
      switch (event.kind) {
        case 'locCaptured':
          log(world, `${ac.callsign} established on the localizer.`, 'pilot', [ac.id]);
          for (const warning of event.warnings) {
            log(world, `Poor practice: ${ac.callsign} — ${warning}.`, 'system', [ac.id]);
          }
          break;
        case 'interceptMissed':
          world.stats.missedIntercepts.set(
            event.code,
            (world.stats.missedIntercepts.get(event.code) ?? 0) + 1,
          );
          log(
            world,
            `${ac.callsign} unable to intercept — ${event.reason}. Through the localizer, ` +
              `request vectors.`,
            'alert',
            [ac.id],
          );
          break;
        case 'gsCaptured':
          log(world, `${ac.callsign} glideslope alive, descending on the ILS.`, 'pilot', [
            ac.id,
          ]);
          break;
        case 'landed':
          world.stats.landings += 1;
          world.stats.landingTimesS.push(world.timeS);
          trimToRateWindow(world.stats.landingTimesS, world.timeS);
          // The runway is now occupied by an aircraft rolling out, which is what
          // holds the next departure (§4.7).
          world.traffic.lastLandingS = world.timeS;
          if (ac.directDistanceNm > 0) {
            world.stats.trackMileRatioSum += ac.trackMilesFlown / ac.directDistanceNm;
            world.stats.trackMileSamples += 1;
          }
          log(world, `${ac.callsign} landed runway ${AIRPORT.runway.id}.`, 'system', [ac.id]);
          remove(world, ac);
          removed = true;
          break;
        case 'goAround':
          world.stats.goArounds += 1;
          log(world, `${ac.callsign} going around — ${event.reason}.`, 'alert', [ac.id]);
          break;
      }
    }
    if (removed) continue;

    // The glideslope and the STAR's published profile each own the vertical
    // while they are being flown; kinematics still pay for it out of the
    // energy budget, so a descending aircraft slows more grudgingly. Read after
    // the route step, since a hold beginning or ending changes who owns it on
    // the very tick it happens.
    stepKinematics(ac, dt, ac.phase !== 'gs' && !starOwnsVertical(ac));

    if (checkAirspaceExit(world, ac)) continue;
    tryHandoff(world, ac);
  }

  // ── 1 Hz radar return, 5 s history dot ───────────────────────────────────
  if (world.timeS >= world.nextRadarAtS) {
    sampleRadarReturns(world);
    world.nextRadarAtS = world.timeS + RADAR_PERIOD_S;
  }
  if (world.timeS >= world.nextHistoryAtS) {
    sampleHistory(world);
    world.nextHistoryAtS = world.timeS + HISTORY_PERIOD_S;
  }
}
