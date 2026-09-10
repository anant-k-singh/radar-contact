/**
 * Player instructions. Each one is validated, then *transmitted*: the crew
 * reads it back and flies it a second or two later (docs §4.3, §7.2), so what
 * happens here is limited to the refusals the controller hears immediately.
 */
import type { Aircraft } from './aircraft.js';
import { isControllable, isDeparture } from './aircraft.js';
import {
  ALTITUDE_STEP_FT,
  CONFIG_RANGE_NM,
  HEADING_HINT_S,
  HEADING_STEP_DEG,
  MAX_REJOIN_ANGLE_DEG,
  SPEED_FLOOR_CENTER_KTS,
  SPEED_FLOOR_CLEAN_KTS,
  SPEED_FLOOR_LOW_KTS,
  SPEED_HIGH_LEVEL_FT,
  SPEED_MAX_HIGH_KTS,
  SPEED_MAX_KTS,
  SPEED_STEP_KTS,
} from './constants.js';
import type { FacilityRole, Runway } from '../scenario/types.js';
import { evaluateClearance, finalGeometry, rangeToThresholdNm } from './ils.js';
import {
  assignedAltitudeFt,
  assignedHeadingDeg,
  assignedIasKts,
  isPending,
  issue,
} from './pilot.js';
import {
  activeFix,
  holdFixIndex,
  rejoinAngleDeg,
  rejoinTarget,
  starTargetSpeedKts,
} from './star.js';
import { clamp, displayHeading, normalizeHeading, quantize } from './units.js';
import { log, type World } from './world.js';

export type Direction = -1 | 1;

/**
 * Slowest speed the player may assign.
 * Don't make an aircraft configure until it is within 20 track miles.
 */
export function speedFloorKts(runway: Runway, ac: Aircraft, role: FacilityRole): number {
  // The role rather than the runway, because the runway is exactly what does not
  // apply: both floors below are measured from a threshold, and an en-route
  // sector's traffic is 50 to 160 NM from one it never reaches — so the range
  // test always answers "far out" and leaves a flat 180 kt at FL300.
  if (role === 'center') return SPEED_FLOOR_CENTER_KTS;
  if (rangeToThresholdNm(runway, ac) <= CONFIG_RANGE_NM) return SPEED_FLOOR_LOW_KTS;
  return Math.max(SPEED_FLOOR_CLEAN_KTS, ac.type.minCleanKts);
}

/**
 * Fastest the player may assign, which depends on how high the aircraft is.
 *
 * Read off the *assigned* altitude rather than the live one, for the reason the
 * increments are computed from the assigned value: an aircraft descending
 * through 10,100 towards an assigned 8000 is already a low-level aircraft as far
 * as what may be asked of it goes, and stepping its speed should not depend on
 * which side of the line this tick's altitude happens to fall.
 */
export function speedCeilingKts(ac: Aircraft): number {
  return assignedAltitudeFt(ac) > SPEED_HIGH_LEVEL_FT ? SPEED_MAX_HIGH_KTS : SPEED_MAX_KTS;
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
  const next = clamp(base + direction * ALTITUDE_STEP_FT, world.scenario.airspace.mvaFt, world.scenario.airspace.ceilingFt);
  if (next === base) {
    const limit = direction > 0 ? `ceiling ${world.scenario.airspace.ceilingFt} ft` : `MVA ${world.scenario.airspace.mvaFt} ft`;
    log(world, `${ac.callsign} unable — at the ${limit}.`, 'system', [ac.id]);
    return;
  }

  issue(world, ac, { kind: 'altitude', altitudeFt: next });
}

export function adjustSpeed(world: World, ac: Aircraft, direction: Direction): void {
  if (!guard(world, ac)) return;

  const floor = speedFloorKts(world.scenario.runway, ac, world.scenario.role);
  // Step from the number the player is reading, which on a STAR is the *next
  // fix's* speed and not the autopilot's own target. Those differ the whole time
  // an aircraft is decelerating between two fixes: passing 229 towards BOXAR's
  // 200, the block shows 200 while `targetIasKts` slides through 229.15, so
  // stepping from the target sent E to 240 where the player expected 210.
  const base = quantize(starTargetSpeedKts(ac) ?? assignedIasKts(ac), SPEED_STEP_KTS);
  const requested = base + direction * SPEED_STEP_KTS;

  if (requested < floor) {
    // The reason, not just the number. "Clean minimum until 20 track miles" is a
    // statement about configuring to land, and there is nothing to configure for
    // in a sector that hands off at 14,000 ft.
    const flat =
      world.scenario.role === 'center' ||
      rangeToThresholdNm(world.scenario.runway, ac) <= CONFIG_RANGE_NM;
    log(
      world,
      flat
        ? `${ac.callsign} unable — ${floor} kt is the minimum.`
        : `${ac.callsign} unable ${requested} kt — ${floor} kt clean minimum until ` +
            `${CONFIG_RANGE_NM} track miles.`,
      'system',
      [ac.id],
    );
    return;
  }
  const ceiling = speedCeilingKts(ac);
  const next = clamp(requested, floor, ceiling);
  if (next === base) {
    log(world, `${ac.callsign} unable — at ${ceiling} kt.`, 'system', [ac.id]);
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

  // A bare fix cannot anchor a pattern, so the hold moves up the route to the
  // next fix publishing a level. Entry only — an existing hold is toggling out.
  if (ac.star.hold === null) {
    const holdAt = holdFixIndex(ac.star);
    if (holdAt === null) {
      log(world, `${ac.callsign} unable — no holding fix ahead on the arrival.`, 'system', [
        ac.id,
      ]);
      return;
    }
    // Sequencing forward is what anchors it. Skipping the fixes between loses
    // no crossing, since they publish none.
    ac.star.index = holdAt;
  }

  const fix = activeFix(ac.star);

  // `H` toggles one thing: whether the aircraft is to stay in the pattern. That
  // makes three cases rather than two, because an aircraft that has been told
  // to leave is still in the pattern until it next crosses the fix — and
  // pressing H again there means "never mind", not "enter again" (§4.6).
  const hold = ac.star.hold;
  const stay = hold === null || hold.exitRequested;
  if (hold === null) {
    log(world, `${ac.callsign}, hold at ${fix.name} as published.`, 'system', [ac.id]);
  } else if (hold.exitRequested) {
    log(world, `${ac.callsign}, disregard, continue holding at ${hold.fix}.`, 'system', [ac.id]);
  } else {
    log(world, `${ac.callsign}, leave the hold, continue on the arrival.`, 'system', [ac.id]);
  }
  issue(world, ac, { kind: 'hold', hold: stay });
}

/**
 * Resume the arrival (§4.5a). Three meanings by state, as `H` has: on the route
 * it hands the published profile back, off it and unarmed it arms an intercept
 * of the first leg of any STAR the assigned heading crosses, and off it and
 * armed it cancels.
 */
export function resumeArrival(world: World, ac: Aircraft): void {
  if (!guard(world, ac)) return;
  if (isPending(ac, 'rejoin')) return; // already transmitted, still being read back

  // A clearance is not something `R` may quietly take back — only a heading
  // cancels one (§6.1c) — and a go-around is being flown, not sequenced.
  if (ac.phase !== 'inbound') {
    const reason =
      ac.phase === 'goAround' ? 'going around — re-vector first' : 'cleared for the approach';
    log(world, `${ac.callsign} unable — ${reason}.`, 'alert', [ac.id]);
    return;
  }

  if (ac.star?.hold) {
    log(world, `${ac.callsign} unable — in the hold at ${ac.star.hold.fix}.`, 'alert', [ac.id]);
    return;
  }

  if (ac.star) {
    if (!ac.star.altitudeManual && !ac.star.speedManual) {
      log(world, `${ac.callsign} is already on the ${ac.star.route.name}.`, 'system', [ac.id]);
      return;
    }
    log(world, `${ac.callsign}, resume the ${ac.star.route.name} arrival.`, 'system', [ac.id]);
    issue(world, ac, { kind: 'rejoin', resume: true });
    return;
  }

  const rejoin = ac.rejoin;
  if (!rejoin) {
    log(world, `${ac.callsign} unable — no arrival to resume.`, 'alert', [ac.id]);
    return;
  }

  if (rejoin.leg !== null) {
    log(world, `${ac.callsign}, cancel the rejoin, maintain heading.`, 'system', [ac.id]);
    issue(world, ac, { kind: 'rejoin', resume: false });
    return;
  }

  // The intercept is settled off the *assigned* heading, so "turn left 210,
  // resume the arrival" joins the leg the turn is aimed at rather than the one
  // the aircraft is still pointing at.
  // Any published STAR, not just the one it came off (§4.5a): a vectored arrival
  // sequences behind the traffic on whichever route it now reaches first.
  const headingDeg = assignedHeadingDeg(ac);
  const target = rejoinTarget(world.scenario.stars, ac, headingDeg, rejoin.nav);
  if (target === null) {
    log(
      world,
      `${ac.callsign} unable — heading ${displayHeading(headingDeg)} does not reach an ` +
        `arrival route.`,
      'alert',
      [ac.id],
    );
    return;
  }

  // The angle is knowable here because the leg is, so the refusal is heard now
  // rather than two minutes away at the leg (§6.1a takes the other half of this
  // split, for the case that only the aircraft can settle).
  const angleDeg = rejoinAngleDeg(target.route, target.leg, headingDeg);
  if (angleDeg > MAX_REJOIN_ANGLE_DEG) {
    log(
      world,
      `${ac.callsign} unable — heading ${displayHeading(headingDeg)} crosses the ` +
        `${target.route.name} at ${Math.round(angleDeg)}°.`,
      'alert',
      [ac.id],
    );
    return;
  }

  // "Resume" only fits the route it came off; another one is a route change and
  // is read as one.
  const fixName = target.route.waypoints[target.leg]!.name;
  log(
    world,
    target.route === rejoin.nav.route
      ? `${ac.callsign}, resume the ${target.route.name} arrival, join at ${fixName}.`
      : `${ac.callsign}, join the ${target.route.name} arrival at ${fixName}.`,
    'system',
    [ac.id],
  );
  issue(world, ac, { kind: 'rejoin', resume: true });
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

  const geo = finalGeometry(world.scenario.runway, ac);
  const result = evaluateClearance(world.scenario.airspace.mvaFt, ac, geo);

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
    .sort(
      (a, b) =>
        rangeToThresholdNm(world.scenario.runway, a) - rangeToThresholdNm(world.scenario.runway, b),
    );
  if (ordered.length === 0) return null;
  const index = ordered.findIndex((ac) => ac.id === world.selectedId);
  return ordered[(index + 1) % ordered.length]!.id;
}

/** Cycle selection by distance to the threshold, nearest first. */
export function selectNext(world: World): void {
  const next = nextSelectableId(world);
  if (next !== null) world.selectedId = next;
}
