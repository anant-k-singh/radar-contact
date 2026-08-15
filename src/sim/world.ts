/**
 * The world: one mutable state object plus `step(world, dt)`.
 * No DOM, no rendering, no input — see docs §11.4.
 */
import { AIRPORT } from '../scenario/airport.js';
import type { Aircraft } from './aircraft.js';
import { sampleRadar } from './aircraft.js';
import {
  AIRSPACE_RADIUS_NM,
  EXIT_WARN_NM,
  FLOW_DEFAULT_PER_HOUR,
  HISTORY_PERIOD_S,
  IN_TRAIL_MIN_NM,
  LANDING_RATE_MIN_ELAPSED_S,
  LANDING_RATE_WINDOW_S,
  MESSAGE_LOG_MAX,
  RADAR_PERIOD_S,
  TOWER_FREQUENCY,
  TRAIL_LENGTH,
} from './constants.js';
import { groundSpeed, stepKinematics } from './dynamics.js';
import { finalGeometry, isEstablished, stepApproach } from './ils.js';
import { applyDueInstructions } from './pilot.js';
import { createRng, type Rng } from './rng.js';
import { analyzeSeparation, type SeparationReport } from './separation.js';
import { starOwnsVertical, stepStar } from './star.js';
import { createTrafficState, scheduleNextSpawn, trySpawn, type TrafficState } from './traffic.js';
import { distance, headingVector, type Nm, type Sec } from './units.js';

export type MessageKind = 'pilot' | 'system' | 'alert';

export interface Message {
  timeS: Sec;
  text: string;
  kind: MessageKind;
}

export interface Stats {
  landings: number;
  /** Sim time of each landing inside the rate window; older ones are dropped. */
  landingTimesS: Sec[];
  handoffs: number;
  violations: number;
  violationSeconds: number;
  goArounds: number;
  exits: number;
  rejections: Map<string, number>;
  trackMileRatioSum: number;
  trackMileSamples: number;
}

export interface World {
  timeS: Sec;
  aircraft: Aircraft[];
  messages: Message[];
  stats: Stats;
  flowPerHour: number;
  rng: Rng;
  /**
   * Pilot reaction times come from their own stream, so how much the player
   * talks cannot shift the traffic sequence a seed produces.
   */
  pilotRng: Rng;
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

export function createWorld(seed: number, flowPerHour = FLOW_DEFAULT_PER_HOUR): World {
  const traffic = createTrafficState();
  traffic.nextSpawnAtS = 5; // don't stare at an empty scope
  return {
    timeS: 0,
    aircraft: [],
    messages: [],
    stats: {
      landings: 0,
      landingTimesS: [],
      handoffs: 0,
      violations: 0,
      violationSeconds: 0,
      goArounds: 0,
      exits: 0,
      rejections: new Map(),
      trackMileRatioSum: 0,
      trackMileSamples: 0,
    },
    flowPerHour,
    rng: createRng(seed),
    pilotRng: createRng(seed ^ 0x5f356495),
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

export function log(world: World, text: string, kind: MessageKind = 'system'): void {
  world.messages.push({ timeS: world.timeS, text, kind });
  if (world.messages.length > MESSAGE_LOG_MAX) {
    world.messages.splice(0, world.messages.length - MESSAGE_LOG_MAX);
  }
}

export function findAircraft(world: World, id: number | null): Aircraft | undefined {
  if (id === null) return undefined;
  return world.aircraft.find((ac) => ac.id === id);
}

export function selectedAircraft(world: World): Aircraft | undefined {
  return findAircraft(world, world.selectedId);
}

function remove(world: World, ac: Aircraft): void {
  const index = world.aircraft.indexOf(ac);
  if (index >= 0) world.aircraft.splice(index, 1);
  if (world.selectedId === ac.id) world.selectedId = null;
}

/**
 * Landings per hour over the trailing window (§8.2), or null while the session
 * is too young for the sample to mean anything. Extrapolated from however much
 * of the window has actually elapsed, so it settles rather than ramping up.
 */
export function landingRatePerHour(world: World): number | null {
  const elapsedS = Math.min(LANDING_RATE_WINDOW_S, world.timeS);
  if (elapsedS < LANDING_RATE_MIN_ELAPSED_S) return null;
  const since = world.timeS - LANDING_RATE_WINDOW_S;
  const landings = world.stats.landingTimesS.filter((timeS) => timeS >= since).length;
  return (landings / elapsedS) * 3600;
}

/** Projected in-trail spacing when the aircraft ahead reaches the threshold (IF 6.14.3). */
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
  // IF 6.14.3 — keep it on frequency until the closure rate is acceptable,
  // against whichever in-trail minimum applies at its current range (§9.3).
  const minimumNm = world.separation.inTrailMinimum.get(ac.id) ?? IN_TRAIL_MIN_NM;
  if (leader && projectedSpacingNm(ac, leader) < minimumNm) return;

  ac.handedOff = true;
  world.stats.handoffs += 1;
  log(world, `${ac.callsign}, contact Tower on ${TOWER_FREQUENCY}.`, 'system');
}

function checkAirspaceExit(world: World, ac: Aircraft): boolean {
  const range = distance({ x: ac.x, y: ac.y }, AIRPORT.arp);
  const track = headingVector(ac.headingDeg);
  const outbound = range > 0 && (ac.x * track.x + ac.y * track.y) / range > 0;

  if (!outbound) {
    ac.exitWarned = false;
    return false;
  }
  if (range > AIRSPACE_RADIUS_NM) {
    world.stats.exits += 1;
    log(world, `${ac.callsign} leaving your airspace, returned to Center.`, 'alert');
    remove(world, ac);
    return true;
  }
  if (range > EXIT_WARN_NM && !ac.exitWarned) {
    ac.exitWarned = true;
    log(world, `${ac.callsign} is approaching the airspace boundary.`, 'alert');
  }
  return false;
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
      );
    }
  }

  // ── Separation ───────────────────────────────────────────────────────────
  // Analysed before flying, so in-trail spacing and the handoff closure check
  // see this tick's picture rather than the previous one's — which on the very
  // first tick of a session would be empty.
  world.separation = analyzeSeparation(world.aircraft);
  accountViolations(world, dt);

  // ── Fly ──────────────────────────────────────────────────────────────────
  for (const ac of [...world.aircraft]) {
    // Instructions the crew has now had time to act on, then the route they
    // fly in the absence of one.
    for (const readback of applyDueInstructions(ac, world.timeS)) {
      log(world, readback.text, readback.kind);
    }
    const onProfile = starOwnsVertical(ac);
    for (const event of stepStar(ac, dt)) {
      if (event.kind === 'starComplete') {
        log(
          world,
          `${ac.callsign} at ${event.fix}, end of the arrival — maintaining heading, ` +
            `request further.`,
          'pilot',
        );
      }
    }

    const geo = finalGeometry(ac);
    const inTrailNm = world.separation.inTrail.get(ac.id) ?? null;
    const events = stepApproach(ac, geo, { inTrailNm }, dt);

    let removed = false;
    for (const event of events) {
      switch (event.kind) {
        case 'locCaptured':
          log(world, `${ac.callsign} established on the localizer.`, 'pilot');
          break;
        case 'gsCaptured':
          log(world, `${ac.callsign} glideslope alive, descending on the ILS.`, 'pilot');
          break;
        case 'landed':
          world.stats.landings += 1;
          world.stats.landingTimesS.push(world.timeS);
          // Only the window is ever read, so the list never grows past it.
          {
            const since = world.timeS - LANDING_RATE_WINDOW_S;
            const stale = world.stats.landingTimesS.findIndex((timeS) => timeS >= since);
            if (stale > 0) world.stats.landingTimesS.splice(0, stale);
          }
          if (ac.directDistanceNm > 0) {
            world.stats.trackMileRatioSum += ac.trackMilesFlown / ac.directDistanceNm;
            world.stats.trackMileSamples += 1;
          }
          log(world, `${ac.callsign} landed runway ${AIRPORT.runway.id}.`, 'system');
          remove(world, ac);
          removed = true;
          break;
        case 'goAround':
          world.stats.goArounds += 1;
          log(world, `${ac.callsign} going around — ${event.reason}.`, 'alert');
          break;
      }
    }
    if (removed) continue;

    // The glideslope and the STAR's published profile each own the vertical
    // while they are being flown; kinematics still pay for it out of the
    // energy budget, so a descending aircraft slows more grudgingly.
    stepKinematics(ac, dt, ac.phase !== 'gs' && !onProfile);

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
