/**
 * The world: one mutable state object plus `step(world, dt)`.
 * No DOM, no rendering, no input — see docs §11.4.
 */
import type { Runway, Scenario } from '../scenario/types.js';
import type { Aircraft } from './aircraft.js';
import { isDeparture, sampleRadar } from './aircraft.js';
import { boundaryMarginNm } from '../scenario/airspace.js';
import {
  DELIVERY_CAPTURE_NM,
  EXIT_WARN_MARGIN_NM,
  HISTORY_PERIOD_S,
  IN_TRAIL_MIN_NM,
  MOVEMENT_RATE_INTERVALS,
  MOVEMENT_RATE_MIN_INTERVALS,
  MOVEMENT_RATE_STALE_S,
  MESSAGE_LOG_MAX,
  RADAR_PERIOD_S,
  TRAIL_LENGTH,
} from './constants.js';
import {
  assessDelivery,
  deliveryPlan,
  destinationOf,
  type Delivery,
  type DeliveryFault,
  type DeliverySlot,
} from './delivery.js';
import { stepDeparture, type DepartureEvent } from './departure.js';
import { groundSpeed, stepKinematics } from './dynamics.js';
import { finalGeometry, isEstablished, stepApproach, type ApproachEvent } from './ils.js';
import { applyDueInstructions } from './pilot.js';
import { createRng, type Rng } from './rng.js';
import { analyzeSeparation, type SeparationReport } from './separation.js';
import { starOwnsVertical, stepStar, type StarEvent } from './star.js';
import {
  createTrafficState,
  scheduleNextDeparture,
  scheduleNextSpawn,
  tryDeparture,
  trySpawn,
  type TrafficState,
} from './traffic.js';
import { bearing, distance, headingDiff, type Nm, type Sec } from './units.js';

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
  /** Sim time of each recent landing; only the gaps between the last few are read. */
  landingTimesS: Sec[];
  /** Departures that got airborne and left the area on their SID (§4.7). */
  departures: number;
  /**
   * Sim time each departure began its take-off roll.
   *
   * Timed at the *roll*, not at the airspace exit that `departures` counts —
   * the departure rate is a measure of what the runway is getting away, and an
   * exit happens eight minutes downstream of the runway decision that caused it
   * (§8.2). Trimmed to the last few, exactly as the landing times are.
   */
  departureTimesS: Sec[];
  /**
   * Sim time each arrival was handed over at its gate.
   *
   * Stamped at the hand-over, which is the only moment an arrival enters — it
   * is put on the scope already established on its STAR, so there is no later
   * entry event to time it at (§8.2). The mirror of `departureTimesS` being
   * stamped at the roll: each measures its flow where it crosses the boundary
   * of the player's problem. Trimmed to the last few, as those are.
   */
  arrivalTimesS: Sec[];
  handoffs: number;
  violations: number;
  violationSeconds: number;
  goArounds: number;
  exits: number;
  /**
   * Arrivals handed to the next sector down at a delivery gate (§8.3). Zero at
   * an approach field, which lands them instead.
   */
  deliveries: number;
  /**
   * Sim time of each delivery, per gate.
   *
   * Per gate and not pooled, because the agreement is per gate: a sector feeding
   * two streams that delivers twenty an hour into one and none into the other
   * has satisfied neither. Trimmed to the last few, as the other rate series are.
   */
  deliveryTimesS: Map<string, Sec[]>;
  /** Deliveries that were made but not cleanly, by reason (§8.3). */
  deliveryFaults: Map<string, number>;
  rejections: Map<string, number>;
  /** Clearances that were accepted but did not intercept, by reason (§6.1a). */
  missedIntercepts: Map<string, number>;
  trackMileRatioSum: number;
  trackMileSamples: number;
}

export interface World {
  /**
   * The field this session is flying: its airport, airspace and charts (§3).
   *
   * Fixed at `createWorld` and never reassigned — the offscreen map layer, the
   * recording and every in-flight route object are all bound to it, so switching
   * field is a new session rather than an assignment.
   */
  readonly scenario: Scenario;
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
  /**
   * Where every inbound sits in its stream, recomputed each tick (§8.3).
   *
   * Beside `separation` and for the same reason: it is derived from the aircraft
   * rather than owned, every renderer wants it, and recomputing it per frame in
   * three layers would be three chances to disagree. Empty at an approach field.
   */
  deliverySlots: Map<number, DeliverySlot>;
  selectedId: number | null;
  paused: boolean;
  timeScale: number;
  nextRadarAtS: Sec;
  nextHistoryAtS: Sec;
  /** Violation pair key → sim time the violation began. */
  activeViolations: Map<string, Sec>;
}

export function createWorld(
  scenario: Scenario,
  seed: number,
  flowPerHour = scenario.traffic.arrivalsPerHour,
  departureFlowPerHour = scenario.traffic.departuresPerHour,
): World {
  const traffic = createTrafficState();
  traffic.nextSpawnAtS = 5; // don't stare at an empty scope
  // The first departure waits longer than the first arrival: a session that
  // opens on an aircraft already rolling reads as having started without you.
  traffic.nextDepartureAtS = 45;
  return {
    scenario,
    timeS: 0,
    aircraft: [],
    messages: [],
    stats: {
      landings: 0,
      landingTimesS: [],
      departures: 0,
      departureTimesS: [],
      arrivalTimesS: [],
      handoffs: 0,
      violations: 0,
      violationSeconds: 0,
      goArounds: 0,
      exits: 0,
      deliveries: 0,
      deliveryTimesS: new Map(),
      deliveryFaults: new Map(),
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
      terrain: [],
      alerts: new Map(),
      inTrail: new Map(),
      inTrailLeader: new Map(),
      inTrailMinimum: new Map(),
    },
    deliverySlots: new Map(),
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

/**
 * Records a movement. Only the last `MOVEMENT_RATE_INTERVALS` gaps are ever
 * read, so the list is kept to the timestamps that bound them and never grows.
 */
function recordMovement(timesS: Sec[], nowS: Sec): void {
  timesS.push(nowS);
  const keep = MOVEMENT_RATE_INTERVALS + 1;
  if (timesS.length > keep) timesS.splice(0, timesS.length - keep);
}

function remove(world: World, ac: Aircraft): void {
  const index = world.aircraft.indexOf(ac);
  if (index >= 0) world.aircraft.splice(index, 1);
  if (world.selectedId === ac.id) world.selectedId = null;
}

/**
 * Movements per hour from the gaps between the last few movements (§8.2), or
 * null while too few have happened for a gap to mean anything.
 *
 * `3600 * n / (T_latest - T_{latest-n})` — the reciprocal of the mean interval,
 * which is what a controller reads off a strip: it steps to a new value the
 * moment a movement lands rather than drifting as a window slides.
 *
 * A short quiet spell is left alone and the rate holds, because a gap on final
 * is usually one the player made on purpose. Once the runway has been quiet for
 * `MOVEMENT_RATE_STALE_S` the elapsed time joins the average as an *open*
 * interval, so the number decays from then on rather than standing indefinitely.
 * Because it is computed here and never recorded, the next movement replaces it
 * with the real interval it turned out to be — a landing arriving straight after
 * discards the decay rather than compounding it.
 */
function ratePerHour(timesS: readonly Sec[], nowS: Sec): number | null {
  const last = timesS[timesS.length - 1];
  if (last === undefined) return null;
  const openS = nowS - last;
  const open = openS > MOVEMENT_RATE_STALE_S;
  // The window is the same width either way: an open interval pushes the oldest
  // recorded gap out rather than widening the average.
  const closed = Math.min(MOVEMENT_RATE_INTERVALS - (open ? 1 : 0), timesS.length - 1);
  const intervals = closed + (open ? 1 : 0);
  // Counted against the *recorded* gaps: an open interval decays a rate that
  // already meant something, and must never be what first conjures one out of a
  // single movement pair and a long silence.
  if (closed < MOVEMENT_RATE_MIN_INTERVALS) return null;
  const spanS = last - timesS[timesS.length - 1 - closed]! + (open ? openS : 0);
  if (spanS <= 0) return null;
  return (3600 * intervals) / spanS;
}

export function landingRatePerHour(world: World): number | null {
  return ratePerHour(world.stats.landingTimesS, world.timeS);
}

/**
 * Departures per hour off the runway. Read next to the landing rate, it is the
 * other half of what the one runway actually achieved — and next to the
 * departure flow setting, it is how much of what was asked for got away, which
 * a busy final quietly eats into (§4.7).
 */
export function departureRatePerHour(world: World): number | null {
  return ratePerHour(world.stats.departureTimesS, world.timeS);
}

/**
 * How many departures are holding short waiting for the runway (§8.2).
 *
 * Read alongside `DEP RATE`: the rate says what the runway got away, and this
 * says what it owes. A queue that only grows is a final that never gives the
 * runway back.
 */
/**
 * Arrivals per hour handed over on a STAR (§8.2).
 *
 * Read against the landing rate, it is whether the stack is growing: Center is
 * delivering faster than the runway is taking them the whole time this number
 * stands above `RATE`.
 */
export function arrivalRatePerHour(world: World): number | null {
  return ratePerHour(world.stats.arrivalTimesS, world.timeS);
}

/** The most recent delivery at each gate, which is what the next slot follows. */
export function lastDeliveryTimes(world: World): Map<string, Sec> {
  const last = new Map<string, Sec>();
  for (const [gate, times] of world.stats.deliveryTimesS) {
    const at = times[times.length - 1];
    if (at !== undefined) last.set(gate, at);
  }
  return last;
}

/**
 * Deliveries per hour into one gate, against the rate that gate asked for.
 *
 * The same open-interval decay the landing rate uses, and for the same reason: a
 * stream that has gone quiet is a stream falling behind its agreement, and the
 * number has to say so rather than standing at whatever it last achieved.
 */
export function deliveryRatePerHour(world: World, fixName: string): number | null {
  return ratePerHour(world.stats.deliveryTimesS.get(fixName) ?? [], world.timeS);
}

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
  if (lastLandingS !== null && world.timeS - lastLandingS < world.scenario.runwayOps.holdAfterLandingS) {
    return true;
  }
  return world.aircraft.some((ac) => ac.phase === 'roll');
}

/** Projected in-trail spacing when the aircraft ahead reaches the threshold (§9.3). */
export function projectedSpacingNm(runway: Runway, follower: Aircraft, leader: Aircraft): Nm {
  const followerAlong = finalGeometry(runway, follower).alongNm;
  const leaderAlong = finalGeometry(runway, leader).alongNm;
  const leaderSpeed = groundSpeed(leader) / 3600;
  if (leaderSpeed <= 0) return followerAlong - leaderAlong;
  const secondsToThreshold = leaderAlong / leaderSpeed;
  return followerAlong - (groundSpeed(follower) / 3600) * secondsToThreshold;
}

function tryHandoff(world: World, ac: Aircraft): void {
  if (ac.handedOff || ac.phase !== 'gs') return;
  const geo = finalGeometry(world.scenario.runway, ac);
  if (!isEstablished(ac, geo)) return;

  const leader = world.separation.inTrailLeader.get(ac.id);
  // Keep it on frequency until the closure rate is acceptable,
  // against whichever in-trail minimum applies at its current range (§9.3).
  const minimumNm = world.separation.inTrailMinimum.get(ac.id) ?? IN_TRAIL_MIN_NM;
  if (leader && projectedSpacingNm(world.scenario.runway, ac, leader) < minimumNm) return;

  ac.handedOff = true;
  world.stats.handoffs += 1;
  log(world, `${ac.callsign}, contact Tower on ${world.scenario.facility.towerFrequency}.`, 'system', [ac.id]);
}

/**
 * Hand an arrival to the next sector down, and grade what it got (§8.3).
 *
 * The mirror of `tryHandoff`, read from the other end of a session: that one
 * gives an aircraft to Tower once it is established on the localizer, this one
 * gives it to Approach once it has reached the fix the two sectors share.
 *
 * Unlike `tryHandoff` it never *withholds* the transfer. Approach control can
 * keep an aircraft on frequency until the closure rate is acceptable because the
 * runway is still ahead of it; a center sector's boundary is a line the aircraft
 * has already crossed by the time it is at the fix, and holding on to it would
 * be flying in someone else's airspace. So a bad delivery is made and counted,
 * which is the honest model — the cost of poor sequencing is paid by the
 * controller downstream, and being told about it afterwards is exactly what the
 * real feedback loop is.
 *
 * Returns true when the aircraft has been removed.
 */
function tryDelivery(world: World, ac: Aircraft): boolean {
  if (world.scenario.role !== 'center') return false;
  const destination = destinationOf(ac);
  const gate = world.scenario.delivery.find((entry) => entry.fixName === destination);
  if (!gate) return false;
  // The route is flown to its last fix, so reaching it is the delivery. An
  // aircraft vectored off and never given back arrives at the boundary instead —
  // `checkSectorExit` catches that one, and counts it as the loss it is.
  const route = ac.star?.route ?? null;
  if (route === null || ac.star!.index < route.waypoints.length - 1) return false;
  if (distance({ x: ac.x, y: ac.y }, gate.position) > DELIVERY_CAPTURE_NM) return false;

  const times = world.stats.deliveryTimesS.get(gate.fixName) ?? [];
  const previousS = times[times.length - 1] ?? null;
  const verdict = assessDelivery(gate, ac, previousS, world.timeS);

  times.push(world.timeS);
  if (times.length > MOVEMENT_RATE_INTERVALS + 1) times.shift();
  world.stats.deliveryTimesS.set(gate.fixName, times);
  world.stats.deliveries += 1;
  for (const fault of verdict.faults) {
    world.stats.deliveryFaults.set(fault, (world.stats.deliveryFaults.get(fault) ?? 0) + 1);
  }

  const frequency = world.scenario.facility.approachFrequency;
  if (verdict.faults.length === 0) {
    log(
      world,
      `${ac.callsign} at ${gate.fixName}, contact Approach on ${frequency}.`,
      'system',
      [ac.id],
    );
  } else {
    log(
      world,
      `${ac.callsign} handed to Approach at ${gate.fixName} — ${verdict.faults
        .map((fault) => deliveryFaultText(fault, verdict))
        .join(', ')}.`,
      'alert',
      [ac.id],
    );
  }
  remove(world, ac);
  return true;
}

function deliveryFaultText(fault: DeliveryFault, verdict: Delivery): string {
  switch (fault) {
    case 'early':
      return `${Math.round(verdict.gapS ?? 0)} s behind the last one, against ${Math.round(
        verdict.requiredGapS,
      )} s agreed`;
    case 'level':
      return 'not at the agreed level';
    case 'speed':
      return 'not at the agreed speed';
    case 'unsequenced':
      return 'still on a vector, not established on the arrival';
  }
}

/**
 * An arrival that reached the inner boundary without ever being delivered — it
 * was vectored off its route and left there, so it crosses into the next
 * sector's airspace unsequenced and unannounced.
 *
 * Separate from `checkAirspaceExit` because it is the opposite direction:
 * everything that check knows about is *outbound*, and this one happens while
 * the aircraft is tracking straight at the field.
 *
 * Returns true when the aircraft has been removed.
 */
function checkSectorExit(world: World, ac: Aircraft): boolean {
  const shape = world.scenario.airspace.shape;
  if (shape.kind !== 'sector') return false;
  if (distance({ x: ac.x, y: ac.y }, world.scenario.arp) >= shape.innerNm) return false;
  world.stats.exits += 1;
  world.stats.deliveryFaults.set(
    'unsequenced',
    (world.stats.deliveryFaults.get('unsequenced') ?? 0) + 1,
  );
  log(
    world,
    `${ac.callsign} entered the terminal area off the arrival — Approach is taking it unsequenced.`,
    'alert',
    [ac.id],
  );
  remove(world, ac);
  return true;
}

function checkAirspaceExit(world: World, ac: Aircraft): boolean {
  const position = { x: ac.x, y: ac.y };
  // Outbound means tracking away from the airport, so the test is against the
  // bearing *from the ARP* — not against the raw position vector, which is the
  // same thing only while the ARP sits on the origin.
  const range = distance(position, world.scenario.arp);
  const outbound = range > 0 && headingDiff(bearing(world.scenario.arp, position), ac.headingDeg) < 90;

  if (!outbound) {
    ac.exitWarned = false;
    return false;
  }

  // Against the boundary's actual shape, not just the radius: the airspace is
  // cut off north and south (§3.1), so an aircraft can run out of room while
  // still well inside 50 NM.
  const marginNm = boundaryMarginNm(world.scenario.airspace, position);
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
function logDepartureEvents(world: World, ac: Aircraft, events: readonly DepartureEvent[]): void {
  for (const event of events) {
    switch (event.kind) {
      case 'airborne':
        log(
          world,
          `${ac.callsign} airborne runway ${world.scenario.runway.id}, ${event.sid} departure, ` +
            `contact Departure on ${world.scenario.facility.departureFrequency}.`,
          'system',
          [ac.id],
        );
        break;
      case 'sidComplete':
        log(world, `${ac.callsign} at ${event.fix}, end of the departure.`, 'pilot', [ac.id]);
        break;
    }
  }
}

function stepDepartureFlight(world: World, ac: Aircraft, dt: Sec): boolean {
  logDepartureEvents(world, ac, stepDeparture(ac, dt));
  if (ac.phase !== 'roll') stepKinematics(ac, dt);
  return checkAirspaceExit(world, ac);
}

function logStarEvents(world: World, ac: Aircraft, events: readonly StarEvent[]): void {
  for (const event of events) {
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
        log(world, `${ac.callsign} leaving ${event.fix}, back on the arrival.`, 'pilot', [ac.id]);
        break;
      case 'rejoinEstablished':
        log(world, `${ac.callsign} established on the ${event.route} at ${event.fix}.`, 'pilot', [
          ac.id,
        ]);
        break;
      case 'rejoinMissed':
        log(world, `${ac.callsign} unable to rejoin — ${event.reason}.`, 'alert', [ac.id]);
        break;
    }
  }
}

/**
 * Log the approach events and record what they score. Returns true when the
 * aircraft has landed and been removed, so the caller stops flying it.
 *
 * Not a lookup table: `landed` removes the aircraft and three of the five cases
 * move a different statistic, so the switch is where the differences belong.
 */
function handleApproachEvents(
  world: World,
  ac: Aircraft,
  events: readonly ApproachEvent[],
): boolean {
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
        log(world, `${ac.callsign} glideslope alive, descending on the ILS.`, 'pilot', [ac.id]);
        break;
      case 'landed':
        world.stats.landings += 1;
        recordMovement(world.stats.landingTimesS, world.timeS);
        // The runway is now occupied by an aircraft rolling out, which is what
        // holds the next departure (§4.7).
        world.traffic.lastLandingS = world.timeS;
        if (ac.directDistanceNm > 0) {
          world.stats.trackMileRatioSum += ac.trackMilesFlown / ac.directDistanceNm;
          world.stats.trackMileSamples += 1;
        }
        log(world, `${ac.callsign} landed runway ${world.scenario.runway.id}.`, 'system', [ac.id]);
        remove(world, ac);
        removed = true;
        break;
      case 'goAround':
        world.stats.goArounds += 1;
        log(world, `${ac.callsign} going around — ${event.reason}.`, 'alert', [ac.id]);
        break;
    }
  }
  return removed;
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
  // Terrain busts, keyed by aircraft and MSA rather than by a pair. Including the
  // level means descending from one band into a higher one is a second violation:
  // it is a second mistake, and the aircraft has to climb further to fix it.
  for (const conflict of world.separation.terrain) {
    const ac = world.aircraft.find((candidate) => candidate.id === conflict.aircraftId);
    if (!ac) continue;
    const key = `terrain-${conflict.aircraftId}-${conflict.msaFt}`;
    seen.add(key);
    if (!world.activeViolations.has(key)) {
      world.activeViolations.set(key, world.timeS);
      world.stats.violations += 1;
      log(
        world,
        `TERRAIN: ${ac.callsign} — ${Math.round(ac.altitudeFt)} ft, ` +
          `MSA ${conflict.msaFt} ft.`,
        'alert',
        [ac.id],
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

/** Center hands over one arrival, if a gate is free to take it (§4.4). */
function spawnArrival(world: World): void {
  if (world.timeS < world.traffic.nextSpawnAtS) return;
  const arrival = trySpawn(world.scenario, world.rng, world.traffic, world.aircraft, world.timeS);
  if (!arrival) return;

  world.aircraft.push(arrival);
  recordMovement(world.stats.arrivalTimesS, world.timeS);
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

/**
 * The flow decides how often a departure turns up at the holding point; the
 * *runway* decides when one rolls. What sits between the two is a queue, and its
 * length is the player's arrival spacing measured from the other side (§4.7).
 * Keeping the two apart is the point, so they are two functions.
 */
function queueDeparture(world: World): void {
  if (world.timeS < world.traffic.nextDepartureAtS) return;
  if (world.departureFlowPerHour > 0) world.traffic.departureQueue += 1;
  scheduleNextDeparture(world.traffic, world.timeS, world.departureFlowPerHour);
}

/**
 * The head of the queue takes the runway the moment it is free, which is any
 * tick at all rather than only the ones the flow lands on — a departure held for
 * landing traffic goes as soon as that traffic is out of the way, not at the next
 * scheduled release. A queue built while the flow was on still drains after it is
 * turned off: those aircraft are already at the threshold.
 */
function releaseDeparture(world: World): void {
  if (world.traffic.departureQueue === 0) return;
  const departure = tryDeparture(world.scenario, world.departureRng, world.traffic, world.aircraft, world.timeS);
  if (!departure) return;

  world.traffic.departureQueue -= 1;
  world.aircraft.push(departure);
  recordMovement(world.stats.departureTimesS, world.timeS);
  const route = departure.sid!.route;
  // The turn is worth saying while the aircraft is still on the ground: it is
  // the one moment the player can see a departure coming before it is anywhere,
  // and which way it goes is what they plan around.
  const out = route.turn === 'straight' ? 'straight out' : `${route.turn} turn out`;
  const waiting =
    world.traffic.departureQueue > 0 ? ` ${world.traffic.departureQueue} more holding.` : '';
  log(
    world,
    `${departure.callsign} (${departure.type.code}) rolling runway ${world.scenario.runway.id}, ` +
      `${route.name} departure — ${out}.${waiting}`,
    'system',
    [departure.id],
  );
}

export function step(world: World, dt: Sec): void {
  world.timeS += dt;

  spawnArrival(world);
  queueDeparture(world);
  releaseDeparture(world);

  // Is there anything on the runway? A departure still rolling, or a landing
  // inside its runway occupancy time — the same 60 s that holds the next
  // departure, applied to the arrivals as well (§9.4). Read once for the tick,
  // before anything moves, so every aircraft sees the same runway.
  const occupied = runwayOccupied(world);

  // ── Separation ───────────────────────────────────────────────────────────
  // Analysed before flying, so in-trail spacing and the handoff closure check
  // see this tick's picture rather than the previous one's — which on the very
  // first tick of a session would be empty.
  world.separation = analyzeSeparation(
    world.scenario.runway,
    world.aircraft,
    world.scenario.terrain,
  );
  accountViolations(world, dt);
  // Where everything sits in its stream, on the same picture the separation was
  // read off. Empty at an approach field, which delivers to nobody.
  world.deliverySlots = deliveryPlan(
    world.scenario.delivery,
    world.aircraft,
    lastDeliveryTimes(world),
    world.timeS,
  );

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
    for (const readback of applyDueInstructions(world.scenario.runway, world.scenario.stars, ac, world.timeS)) {
      log(world, readback.text, readback.kind, [ac.id]);
    }
    logStarEvents(world, ac, stepStar(ac, dt, world.timeS));

    const geo = finalGeometry(world.scenario.runway, ac);
    const inTrailNm = world.separation.inTrail.get(ac.id) ?? null;
    const events = stepApproach(
      world.scenario.runway,
      ac,
      geo,
      { inTrailNm, runwayOccupied: occupied },
      dt,
    );

    if (handleApproachEvents(world, ac, events)) continue;

    // The glideslope and the STAR's published profile each own the vertical
    // while they are being flown; kinematics still pay for it out of the
    // energy budget, so a descending aircraft slows more grudgingly. Read after
    // the route step, since a hold beginning or ending changes who owns it on
    // the very tick it happens.
    stepKinematics(ac, dt, ac.phase !== 'gs' && !starOwnsVertical(ac));

    if (tryDelivery(world, ac)) continue;
    if (checkAirspaceExit(world, ac)) continue;
    if (checkSectorExit(world, ac)) continue;
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
