/**
 * Player instructions. Each one is validated, then *transmitted*: the crew
 * reads it back and flies it a second or two later (docs §4.3, §7.2), so what
 * happens here is limited to the refusals the controller hears immediately.
 */
import type { Aircraft } from './aircraft.js';
import { isControllable, isDeparture } from './aircraft.js';
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
import {
  assignedAltitudeFt,
  assignedHeadingDeg,
  assignedIasKts,
  isPending,
  issue,
} from './pilot.js';
import { activeFix } from './star.js';
import { clamp, normalizeHeading, quantize } from './units.js';
import { log, type World } from './world.js';

export type Direction = -1 | 1;

/**
 * Slowest speed the player may assign.
 * Don't make an aircraft configure until it is within 20 track miles.
 */
export function speedFloorKts(ac: Aircraft): number {
  if (rangeToThresholdNm(ac) <= CONFIG_RANGE_NM) return SPEED_FLOOR_LOW_KTS;
  return Math.max(SPEED_FLOOR_CLEAN_KTS, ac.type.minCleanKts);
}

function guard(world: World, ac: Aircraft): boolean {
  if (isDeparture(ac)) {
    // Not ours and never was: a departure is worked by Departure Control from
    // the moment it rolls (§4.7).
    log(world, `${ac.callsign} is with Departure — not on your frequency.`, 'system', [ac.id]);
    return false;
  }
  if (!isControllable(ac)) {
    log(world, `${ac.callsign} is on Tower frequency now.`, 'system', [ac.id]);
    return false;
  }
  return true;
}

export function adjustHeading(world: World, ac: Aircraft, direction: Direction): void {
  if (!guard(world, ac)) return;

  const base = quantize(assignedHeadingDeg(ac), HEADING_STEP_DEG);
  const next = normalizeHeading(base + direction * HEADING_STEP_DEG);
  // Show the assigned vector on the scope from the moment it is transmitted, so
  // the reaction delay reads as a gap between the two lines rather than as lag.
  ac.headingHintUntilS = world.timeS + HEADING_HINT_S;
  issue(world, ac, { kind: 'heading', headingDeg: next });
}

export function adjustAltitude(world: World, ac: Aircraft, direction: Direction): void {
  if (!guard(world, ac)) return;

  const base = quantize(assignedAltitudeFt(ac), ALTITUDE_STEP_FT);
  const next = clamp(base + direction * ALTITUDE_STEP_FT, MVA_FT, CEILING_FT);
  if (next === base) {
    const limit = direction > 0 ? `ceiling ${CEILING_FT} ft` : `MVA ${MVA_FT} ft`;
    log(world, `${ac.callsign} unable — at the ${limit}.`, 'system', [ac.id]);
    return;
  }

  issue(world, ac, { kind: 'altitude', altitudeFt: next });
}

export function adjustSpeed(world: World, ac: Aircraft, direction: Direction): void {
  if (!guard(world, ac)) return;

  const floor = speedFloorKts(ac);
  const base = quantize(assignedIasKts(ac), SPEED_STEP_KTS);
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
      [ac.id],
    );
    return;
  }
  const next = clamp(requested, floor, SPEED_MAX_KTS);
  if (next === base) {
    log(world, `${ac.callsign} unable — at ${SPEED_MAX_KTS} kt.`, 'system', [ac.id]);
    return;
  }

  issue(world, ac, { kind: 'speed', iasKts: next });
}

/**
 * Toggle the holding pattern (§4.6). Only an aircraft on its STAR can be sent
 * into one — the pattern is anchored on the fix it is tracking to, and off the
 * route there is no next fix to hold at.
 */
export function toggleHold(world: World, ac: Aircraft): void {
  if (!guard(world, ac)) return;
  if (isPending(ac, 'hold')) return; // already transmitted, still being read back

  if (!ac.star) {
    log(world, `${ac.callsign} unable — not on an arrival, no fix to hold at.`, 'system', [
      ac.id,
    ]);
    return;
  }

  const holding = ac.star.hold !== null;
  if (!holding) {
    log(world, `${ac.callsign}, hold at ${activeFix(ac.star).name} as published.`, 'system', [
      ac.id,
    ]);
  } else {
    log(world, `${ac.callsign}, leave the hold, continue on the arrival.`, 'system', [ac.id]);
  }
  issue(world, ac, { kind: 'hold', enter: !holding });
}

export function clearForIls(world: World, ac: Aircraft): void {
  if (!guard(world, ac)) return;
  if (isPending(ac, 'approach')) return; // already transmitted, still being read back

  // A holding aircraft is going round in circles at a fix, not tracking towards
  // final: take it out of the pattern first (§4.6).
  if (ac.star?.hold) {
    log(world, `${ac.callsign} unable — in the hold at ${ac.star.hold.fix}.`, 'alert', [ac.id]);
    return;
  }

  const geo = finalGeometry(ac);
  const result = evaluateClearance(ac, geo);

  if (!result.ok) {
    const code = result.code ?? 'state';
    world.stats.rejections.set(code, (world.stats.rejections.get(code) ?? 0) + 1);
    log(world, `${ac.callsign} unable — ${result.reason}.`, 'alert', [ac.id]);
    return;
  }

  issue(world, ac, { kind: 'approach', warnings: result.warnings });
}

/**
 * The next aircraft in the cycle, by distance to the threshold, nearest first.
 * Returned rather than assigned, since replay holds the selection outside the
 * world it is looking at (§17.2).
 *
 * Departures are skipped. Tab is how the player reaches the aircraft they are
 * about to instruct, and stepping through traffic that takes no instructions is
 * a key press wasted every time — at 20 departures an hour, often. They are
 * still selectable by clicking, which is how you read one's altitude.
 */
export function nextSelectableId(world: World): number | null {
  const ordered = world.aircraft
    .filter((ac) => !isDeparture(ac))
    .sort((a, b) => rangeToThresholdNm(a) - rangeToThresholdNm(b));
  if (ordered.length === 0) return null;
  const index = ordered.findIndex((ac) => ac.id === world.selectedId);
  return ordered[(index + 1) % ordered.length]!.id;
}

/** Cycle selection by distance to the threshold, nearest first. */
export function selectNext(world: World): void {
  const next = nextSelectableId(world);
  if (next !== null) world.selectedId = next;
}
