/**
 * Player instructions. Each one assigns a *target* and emits a readback —
 * the aircraft gets there in its own time (docs §4.3, §7.2).
 */
import { AIRPORT } from '../scenario/airport.js';
import type { Aircraft } from './aircraft.js';
import { isControllable } from './aircraft.js';
import {
  ALTITUDE_STEP_FT,
  CEILING_FT,
  CONFIG_RANGE_NM,
  HEADING_HINT_S,
  HEADING_STEP_DEG,
  MVA_FT,
  SPEED_FLOOR_CLEAN_KTS,
  SPEED_FLOOR_LOW_KTS,
  SPEED_MAX_KTS,
  SPEED_STEP_KTS,
} from './constants.js';
import { evaluateClearance, finalGeometry, rangeToThresholdNm } from './ils.js';
import { log, type World } from './world.js';
import { clamp, headingDelta, normalizeHeading, quantize, type Deg } from './units.js';

export type Direction = -1 | 1;

/** Headings read out as 010–360 rather than 000. */
export function displayHeading(deg: Deg): string {
  const rounded = Math.round(normalizeHeading(deg)) % 360;
  return String(rounded === 0 ? 360 : rounded).padStart(3, '0');
}

/**
 * Slowest speed the player may assign.
 * IF 6.15.8: don't make an aircraft configure until within 20 track miles.
 */
export function speedFloorKts(ac: Aircraft): number {
  if (rangeToThresholdNm(ac) <= CONFIG_RANGE_NM) return SPEED_FLOOR_LOW_KTS;
  return Math.max(SPEED_FLOOR_CLEAN_KTS, ac.type.minCleanKts);
}

function guard(world: World, ac: Aircraft): boolean {
  if (!isControllable(ac)) {
    log(world, `${ac.callsign} is on Tower frequency now.`, 'system');
    return false;
  }
  return true;
}

/** A vector or an altitude change while on the approach cancels the clearance. */
function cancelApproachIfNeeded(world: World, ac: Aircraft): void {
  if (ac.phase === 'cleared' || ac.phase === 'loc' || ac.phase === 'gs') {
    ac.phase = 'inbound';
    ac.speedAssignedAfterClearance = false;
    log(world, `${ac.callsign}, cancelling the approach clearance.`, 'pilot');
  }
}

export function adjustHeading(world: World, ac: Aircraft, direction: Direction): void {
  if (!guard(world, ac)) return;
  cancelApproachIfNeeded(world, ac);

  const base = quantize(ac.targetHeadingDeg, HEADING_STEP_DEG);
  const next = normalizeHeading(base + direction * HEADING_STEP_DEG);
  ac.targetHeadingDeg = next;
  // Show the assigned vector on the scope for a few seconds. Restarted on every
  // press, so holding D down keeps the hint alive through the whole turn.
  ac.headingHintUntilS = world.timeS + HEADING_HINT_S;

  const turn = headingDelta(ac.headingDeg, next);
  const sense = Math.abs(turn) < 0.5 ? 'maintaining' : turn < 0 ? 'turning left' : 'turning right';
  log(world, `${ac.callsign}, ${sense} heading ${displayHeading(next)}.`, 'pilot');
}

export function adjustAltitude(world: World, ac: Aircraft, direction: Direction): void {
  if (!guard(world, ac)) return;

  const base = quantize(ac.targetAltitudeFt, ALTITUDE_STEP_FT);
  const next = clamp(base + direction * ALTITUDE_STEP_FT, MVA_FT, CEILING_FT);
  if (next === ac.targetAltitudeFt) {
    const limit = direction > 0 ? `ceiling ${CEILING_FT} ft` : `MVA ${MVA_FT} ft`;
    log(world, `${ac.callsign} unable — at the ${limit}.`, 'system');
    return;
  }

  cancelApproachIfNeeded(world, ac);
  ac.targetAltitudeFt = next;
  const verb = next > ac.altitudeFt ? 'climbing' : next < ac.altitudeFt ? 'descending' : 'maintaining';
  log(world, `${ac.callsign}, ${verb} ${next} feet.`, 'pilot');
}

export function adjustSpeed(world: World, ac: Aircraft, direction: Direction): void {
  if (!guard(world, ac)) return;

  const floor = speedFloorKts(ac);
  const base = quantize(ac.targetIasKts, SPEED_STEP_KTS);
  const requested = base + direction * SPEED_STEP_KTS;

  if (requested < floor) {
    const withinConfigRange = rangeToThresholdNm(ac) <= CONFIG_RANGE_NM;
    log(
      world,
      withinConfigRange
        ? `${ac.callsign} unable — ${floor} kt is the minimum.`
        : `${ac.callsign} unable ${requested} kt — ${floor} kt clean minimum until ` +
            `${CONFIG_RANGE_NM} track miles.`,
      'system',
    );
    return;
  }
  const next = clamp(requested, floor, SPEED_MAX_KTS);
  if (next === ac.targetIasKts) {
    log(world, `${ac.callsign} unable — at ${SPEED_MAX_KTS} kt.`, 'system');
    return;
  }

  ac.targetIasKts = next;
  // IF 6.14.4 — "maintain XXX kt until X mile final" survives the clearance.
  if (ac.phase === 'cleared' || ac.phase === 'loc' || ac.phase === 'gs') {
    ac.speedAssignedAfterClearance = true;
  }
  const verb = next > ac.iasKts ? 'increasing' : 'reducing';
  log(world, `${ac.callsign}, ${verb} ${next} knots.`, 'pilot');
}

export function clearForIls(world: World, ac: Aircraft): void {
  if (!guard(world, ac)) return;

  const geo = finalGeometry(ac);
  const result = evaluateClearance(ac, geo);

  if (!result.ok) {
    const code = result.code ?? 'state';
    world.stats.rejections.set(code, (world.stats.rejections.get(code) ?? 0) + 1);
    log(world, `${ac.callsign} unable — ${result.reason}.`, 'alert');
    return;
  }

  ac.phase = 'cleared';
  ac.speedAssignedAfterClearance = false;
  log(world, `${ac.callsign}, cleared ILS approach runway ${AIRPORT.runway.id}.`, 'pilot');
  for (const warning of result.warnings) {
    log(world, `Poor practice: ${ac.callsign} — ${warning}.`, 'system');
  }
}

/** Cycle selection by distance to the threshold, nearest first. */
export function selectNext(world: World): void {
  const ordered = [...world.aircraft].sort(
    (a, b) => rangeToThresholdNm(a) - rangeToThresholdNm(b),
  );
  if (ordered.length === 0) return;
  const index = ordered.findIndex((ac) => ac.id === world.selectedId);
  world.selectedId = ordered[(index + 1) % ordered.length]!.id;
}
