/**
 * ILS approach logic: the clearance gate, the intercept window, localizer and
 * glideslope capture, the deceleration schedule, landing and go-arounds (§6).
 *
 * The clearance and the two intercepts are deliberately separate gates. A
 * clearance says *what the aircraft will do when it gets to the localizer*, so
 * it may legally be given before the aircraft is anywhere near it — turned 30°
 * onto the intercept in the same breath, still descending to the platform, 40 NM
 * out, or even pointing away from a final it has just overshot. Whether it
 * actually intercepts is settled later and twice: at the localizer by
 * `interceptPending` + `evaluateIntercept` (§6.1a), and again on the path by
 * `canCaptureGlideslope` (§6.1b), each against its own conditions at its own
 * moment.
 */
import type { Runway } from '../scenario/types.js';
import type { Aircraft } from './aircraft.js';
import {
  APPROACH_SPEED_GATES,
  FINAL_SPEED_NM,
  GO_AROUND_ABOVE_GS_FT,
  GO_AROUND_GATE_NM,
  GO_AROUND_LEVEL_FT,
  GO_AROUND_IN_TRAIL_NM,
  GO_AROUND_OVERSPEED_KTS,
  GO_AROUND_RUNWAY_OCCUPIED_NM,
  GS_CAPTURE_WINDOW_FT,
  GS_FT_PER_NM,
  ESTABLISHED_HDG_DEG,
  ESTABLISHED_XTK_NM,
  IDEAL_INTERCEPT_ANGLE_DEG,
  LEVEL_VS_LIMIT_FPM,
  LOC_CAPTURE_XTK_NM,
  LOC_RANGE_NM,
  MAX_INTERCEPT_ANGLE_DEG,
  MAX_INTERCEPT_SPEED_KTS,
  MAX_LOC_CORRECTION_DEG,
  CLEARANCE_FAST_KTS,
  CLEARANCE_FAST_RANGE_NM,
  CLEARANCE_RUSHED_NM,
  PURSUIT_AIM_MIN_NM,
  PURSUIT_LEAD_FRACTION,
  PURSUIT_LEAD_MIN_NM,
  PURSUIT_LEAD_NM,
  TOUCHDOWN_WINDOW_FT,
  XTK_ON_COURSE_NM,
} from './constants.js';
import {
  bearing,
  clamp,
  distance,
  headingDelta,
  headingDiff,
  headingVector,
  normalizeHeading,
  project,
  rightOf,
  type Deg,
  type Ft,
  type Nm,
  type Point,
  type Sec,
} from './units.js';

export interface FinalGeometry {
  /** Distance to the threshold along the final approach course. Positive = still to fly. */
  alongNm: Nm;
  /** Cross-track error. Positive = right of course, facing the landing direction. */
  xtkNm: Nm;
  /** Glideslope altitude at this along-track distance. */
  gsAltitudeFt: Ft;
  /** Angle between the current heading and the final approach course, 0..180. */
  interceptAngleDeg: Deg;
  /** True when the current track is reducing the cross-track error. */
  closing: boolean;
}

/** Glideslope altitude at a distance from the threshold: 318.4 ft/NM on a 3° path. */
export function glideslopeAltitudeFt(runway: Runway, alongNm: Nm): Ft {
  return Math.max(runway.elevationFt, alongNm * GS_FT_PER_NM + runway.elevationFt);
}

/** A point on the extended centerline, `alongNm` before the threshold. */
export function centerlinePoint(runway: Runway, alongNm: Nm): Point {
  return {
    x: runway.threshold.x - runway.direction.x * alongNm,
    y: runway.threshold.y - runway.direction.y * alongNm,
  };
}

export function finalGeometry(runway: Runway, ac: Aircraft): FinalGeometry {
  // Along-track is measured *to* the threshold, so it counts down as the
  // aircraft flies in; `project` measures away from it.
  const frame = project(runway.threshold, { x: ac.x, y: ac.y }, runway.direction);
  const alongNm = -frame.alongNm;
  const xtkNm = frame.rightNm;

  const right = rightOf(runway.direction);
  const track = headingVector(ac.headingDeg);
  const xtkRate = track.x * right.x + track.y * right.y;
  const closing = Math.abs(xtkNm) < XTK_ON_COURSE_NM || xtkNm * xtkRate < 0;

  return {
    alongNm,
    xtkNm,
    gsAltitudeFt: glideslopeAltitudeFt(runway, alongNm),
    interceptAngleDeg: headingDiff(ac.headingDeg, runway.courseDeg),
    closing,
  };
}

export function rangeToThresholdNm(runway: Runway, ac: Aircraft): Nm {
  return distance({ x: ac.x, y: ac.y }, runway.threshold);
}

/**
 * Established on the localizer: aligned with the centerline of the runway,
 * regardless of position inside or outside the cone. Being near the runway is
 * not enough.
 */
export function isEstablished(ac: Aircraft, geo: FinalGeometry): boolean {
  return (
    (ac.phase === 'loc' || ac.phase === 'gs') &&
    Math.abs(geo.xtkNm) < ESTABLISHED_XTK_NM &&
    geo.interceptAngleDeg < ESTABLISHED_HDG_DEG &&
    geo.alongNm > 0
  );
}

/** Refusal categories, for the score panel's breakdown. */
export type RefusalCode = 'state' | 'belowMva' | 'pastThreshold';

export interface ClearanceResult {
  ok: boolean;
  /** Why the clearance was refused — shown to the player verbatim. */
  reason?: string;
  code?: RefusalCode;
  /** Accepted, but poor practice. Logged and scored. */
  warnings: string[];
}

/**
 * The clearance gate (§6.1). Only the conditions that make a clearance
 * *meaningless* refuse it — the aircraft is behind the runway, below the MVA,
 * or not ours to clear. Everything else (range, closing, angle, level, speed)
 * describes where the aircraft is *right now*, and where it is right now says
 * nothing about where it will be at the localizer: it belongs to §6.1a. Every
 * refusal still names the condition that failed: this is the app's main
 * teaching surface.
 */
export function evaluateClearance(
  mvaFt: Ft,
  ac: Aircraft,
  geo: FinalGeometry,
): ClearanceResult {
  const warnings: string[] = [];
  const refuse = (code: RefusalCode, reason: string): ClearanceResult => ({
    ok: false,
    reason,
    code,
    warnings,
  });

  if (ac.handedOff) return refuse('state', 'already handed to Tower');
  if (ac.phase === 'cleared' || ac.phase === 'loc' || ac.phase === 'gs') {
    return refuse('state', 'already cleared for the approach');
  }
  if (ac.phase === 'goAround') return refuse('state', 'going around — re-vector first');

  if (geo.alongNm <= 0) return refuse('pastThreshold', 'past the threshold — vector back around');
  if (ac.altitudeFt < mvaFt - 1) return refuse('belowMva', `below the MVA of ${mvaFt} ft`);

  // Accepted, but flag poor technique. Anything the aircraft can still fix on
  // the way in is advisory here and decided for real at the localizer.
  if (geo.alongNm <= LOC_RANGE_NM && ac.altitudeFt > geo.gsAltitudeFt) {
    warnings.push(
      `${Math.round(ac.altitudeFt - geo.gsAltitudeFt)} ft above the glideslope at ` +
        `${geo.alongNm.toFixed(1)} NM — must be at or below it by the intercept`,
    );
  }
  if (ac.iasKts > CLEARANCE_FAST_KTS && geo.alongNm < CLEARANCE_FAST_RANGE_NM) {
    warnings.push(
      `${Math.round(ac.iasKts)} kt inside ${CLEARANCE_FAST_RANGE_NM} NM is fast`,
    );
  }
  if (geo.alongNm < CLEARANCE_RUSHED_NM) {
    warnings.push(`rushed intercept inside ${CLEARANCE_RUSHED_NM} NM`);
  }

  return { ok: true, warnings };
}

/** Why an aircraft failed to intercept, for the score panel's breakdown. */
export type InterceptFailureCode = 'interceptAngle' | 'tooFast';

export interface InterceptResult {
  ok: boolean;
  /** Why the localizer was not captured — shown to the player verbatim. */
  reason?: string;
  code?: InterceptFailureCode;
  /** Captured, but poor practice. Logged and scored. */
  warnings: string[];
}

/**
 * The localizer intercept window (§6.1a), tested at the localizer rather than
 * at the clearance. These are the two ways an aircraft that has actually
 * arrived at the course can *blow* the intercept: too steep an angle to roll
 * out on before overshooting, or too fast for the turn. Both are failures of a
 * pass that really happened, so both cancel the clearance.
 *
 * Being level is deliberately *not* required here. A descent does not stop an
 * aircraft tracking the localizer, and demanding it made the vertical the
 * localizer's business when it is the glideslope's — see
 * `canCaptureGlideslope`, which owns the vertical and tests it at its own
 * moment. That is what "checked individually at the time of intercept" means.
 */
export function evaluateIntercept(ac: Aircraft, geo: FinalGeometry): InterceptResult {
  const warnings: string[] = [];
  const miss = (code: InterceptFailureCode, reason: string): InterceptResult => ({
    ok: false,
    reason,
    code,
    warnings,
  });

  if (geo.interceptAngleDeg > MAX_INTERCEPT_ANGLE_DEG) {
    return miss(
      'interceptAngle',
      `intercept angle ${Math.round(geo.interceptAngleDeg)}° exceeds ${MAX_INTERCEPT_ANGLE_DEG}°`,
    );
  }
  if (ac.iasKts > MAX_INTERCEPT_SPEED_KTS) {
    return miss(
      'tooFast',
      `${Math.round(ac.iasKts)} kt exceeds ${MAX_INTERCEPT_SPEED_KTS} kt for the intercept`,
    );
  }

  if (geo.interceptAngleDeg > IDEAL_INTERCEPT_ANGLE_DEG) {
    warnings.push(`intercept angle ${Math.round(geo.interceptAngleDeg)}° (aim for 30°)`);
  }
  // The path falls away as the aircraft flies inbound, so one that reaches the
  // localizer above it never captures — it is a go-around at 5 NM already, and
  // this is the last moment the controller can be told while it is still fixable.
  if (ac.altitudeFt > geo.gsAltitudeFt + GS_CAPTURE_WINDOW_FT) {
    warnings.push(
      `${Math.round(ac.altitudeFt - geo.gsAltitudeFt)} ft above the glideslope — ` +
        `it cannot capture from here`,
    );
  }

  return { ok: true, warnings };
}

/**
 * Whether the localizer can be intercepted from here at all (§6.1a). Unlike
 * `evaluateIntercept` these are not *failures*: they say the aircraft has not
 * reached the localizer yet, so nothing is tested and nothing is lost. A
 * clearance survives them and is retried every tick.
 *
 * That distinction is the whole point of clearing early. An aircraft that has
 * overshot the final can be cleared and turned back in one go: while it is
 * diverging or outside the service volume it simply is not intercepting, and
 * the moment the new heading brings it back through the course the intercept
 * is tested for real.
 */
export function interceptPending(geo: FinalGeometry): string | null {
  if (geo.alongNm <= 0) return 'past the threshold';
  if (geo.alongNm > LOC_RANGE_NM) {
    return `${geo.alongNm.toFixed(0)} NM out — outside the ${LOC_RANGE_NM} NM localizer range`;
  }
  if (!geo.closing) return 'not closing on the localizer';
  return null;
}

/**
 * The glideslope's own gate (§6.1b), tested on the path and against the
 * aircraft's state at that moment — not at the clearance and not at the
 * localizer. It needs the localizer captured, the aircraft inside the service
 * volume, slow enough, level rather than descending through the path, and
 * *below* it: the 3° path is only ever joined from below, which is why the
 * window is one-sided. An aircraft sitting above must never "capture" downwards.
 *
 * "On the localizer" here means the capture of §6.2.1, not the stricter
 * `isEstablished` of §2.3. The latter is the handoff criterion and waits for
 * the roll-out to settle inside 5°, which on a 30° intercept takes ~1.7 NM —
 * long enough for the path to fall straight past an aircraft that had done
 * nothing wrong.
 *
 * Failing this is not a blown approach either — the aircraft stays on the
 * localizer and captures as soon as it is level under the path. What catches
 * one that never manages it is the 5 NM stability gate.
 */
export function canCaptureGlideslope(ac: Aircraft, geo: FinalGeometry): boolean {
  const belowByFt = geo.gsAltitudeFt - ac.altitudeFt;
  return (
    ac.phase === 'loc' &&
    geo.alongNm > 0 &&
    geo.alongNm <= LOC_RANGE_NM &&
    ac.iasKts <= MAX_INTERCEPT_SPEED_KTS &&
    Math.abs(ac.vsFpm) <= LEVEL_VS_LIMIT_FPM &&
    belowByFt >= 0 &&
    belowByFt <= GS_CAPTURE_WINDOW_FT
  );
}

/** Heading that tracks the localizer, by pure pursuit toward a point down the centerline. */
export function localizerHeading(runway: Runway, ac: Aircraft, geo: FinalGeometry): Deg {
  const lead = clamp(geo.alongNm * PURSUIT_LEAD_FRACTION, PURSUIT_LEAD_MIN_NM, PURSUIT_LEAD_NM);
  const aim = centerlinePoint(runway, Math.max(PURSUIT_AIM_MIN_NM, geo.alongNm - lead));
  const desired = bearing({ x: ac.x, y: ac.y }, aim);
  // Never allow a wild correction — clamp to ±25° of the course.
  const offset = clamp(
    headingDelta(runway.courseDeg, desired),
    -MAX_LOC_CORRECTION_DEG,
    MAX_LOC_CORRECTION_DEG,
  );
  return normalizeHeading(runway.courseDeg + offset);
}

/**
 * Speed once cleared. It becomes the aircraft's own business, and a speed the
 * player reissues after the clearance — the "maintain X kt until Y mile final"
 * technique — can only slow it further.
 *
 * **The schedule is a ceiling, not a default.** An assignment used to replace it
 * outright, and that put the aircraft at the 5 NM stability gate still doing the
 * assigned speed with nowhere to lose it: a medium assigned 190 (which is
 * `minCleanKts`, the slowest a clean assignment is *allowed* to be) needs 0.27 NM
 * to get under the gate's Vapp+45 at best deceleration, and one assigned 200 needs
 * 0.86 NM. Both were flown correctly and both went around for excessive speed —
 * the technique the override existed to support was the thing it broke (§6.2).
 *
 * Taking the lower of the two keeps the technique and removes the trap. It also
 * reads the flag correctly: `speedAssignedAfterClearance` is set by *any*
 * post-clearance assignment, 160 as much as 210, so it never meant "stay fast".
 */
export function approachSpeedTargetKts(ac: Aircraft, alongNm: Nm): number {
  if (alongNm <= FINAL_SPEED_NM) return ac.type.vappKts;
  for (const gateSpeed of APPROACH_SPEED_GATES) {
    if (alongNm > gateSpeed.beyondNm) return Math.min(ac.targetIasKts, gateSpeed.kts);
  }
  return Math.min(ac.targetIasKts, ac.type.minCleanKts);
}

export type ApproachEvent =
  | { kind: 'locCaptured'; warnings: readonly string[] }
  | { kind: 'interceptMissed'; code: InterceptFailureCode; reason: string }
  | { kind: 'gsCaptured' }
  | { kind: 'landed' }
  | { kind: 'goAround'; reason: string };

export interface ApproachContext {
  /** Distance to the aircraft ahead on final, or null when there is none. */
  inTrailNm: Nm | null;
  /**
   * True while something is still on the runway — a departure rolling, or a
   * landing inside its runway occupancy time (§9.4). Passed in rather than
   * worked out here: the runway's state belongs to `world.ts`, and this module
   * only decides what an approach does about it.
   */
  runwayOccupied: boolean;
}

/**
 * Drive an aircraft's approach for one tick. Sets targets; kinematics are
 * integrated afterwards by stepKinematics, except on the glideslope where the
 * altitude is taken straight from the geometry.
 */
export function stepApproach(
  runway: Runway,
  ac: Aircraft,
  geo: FinalGeometry,
  ctx: ApproachContext,
  dt: Sec,
): ApproachEvent[] {
  const events: ApproachEvent[] = [];

  if (ac.phase === 'goAround') {
    ac.targetAltitudeFt = runway.missedApproachAltitudeFt;
    ac.targetHeadingDeg = runway.courseDeg;
    ac.targetIasKts = ac.type.minCleanKts;
    if (Math.abs(ac.altitudeFt - runway.missedApproachAltitudeFt) < GO_AROUND_LEVEL_FT) {
      ac.phase = 'inbound';
    }
    return events;
  }

  if (ac.phase === 'inbound') return events;

  // ── Localizer capture ────────────────────────────────────────────────────
  // Reaching the localizer is where the clearance is finally tested. An
  // aircraft that arrives outside the window does not capture and does not go
  // around: it flies straight through the centerline, the clearance is gone,
  // and the controller has to vector it back and clear it again (§6.1a).
  if (ac.phase === 'cleared') {
    if (Math.abs(geo.xtkNm) < LOC_CAPTURE_XTK_NM && interceptPending(geo) === null) {
      const intercept = evaluateIntercept(ac, geo);
      if (intercept.ok) {
        ac.phase = 'loc';
        events.push({ kind: 'locCaptured', warnings: intercept.warnings });
      } else {
        ac.phase = 'inbound';
        ac.speedAssignedAfterClearance = false;
        events.push({
          kind: 'interceptMissed',
          code: intercept.code!,
          reason: intercept.reason!,
        });
        return events;
      }
    }
  }

  if (ac.phase === 'loc' || ac.phase === 'gs') {
    ac.targetHeadingDeg = localizerHeading(runway, ac, geo);
    ac.targetIasKts = approachSpeedTargetKts(ac, geo.alongNm);
  }

  // ── Glideslope capture (§6.1b) ───────────────────────────────────────────
  // The second intercept, on its own conditions and at its own moment: only as
  // the path descends through a level, established, slow aircraft.
  if (canCaptureGlideslope(ac, geo)) {
    ac.phase = 'gs';
    events.push({ kind: 'gsCaptured' });
  }

  if (ac.phase === 'gs') {
    // Fly the path exactly; derive the vertical rate for display (~740 fpm at 140 kt).
    const previous = ac.altitudeFt;
    ac.altitudeFt = Math.min(previous, geo.gsAltitudeFt);
    ac.targetAltitudeFt = runway.elevationFt;
    ac.vsFpm = dt > 0 ? ((ac.altitudeFt - previous) / dt) * 60 : 0;
  }

  // ── The runway itself, inside 0.3 NM (§6.2) ──────────────────────────────
  // Separate from the stability gate below and deliberately much later: this is
  // not about how the approach was flown, it is about what is on the concrete.
  // A release decision made a minute ago cannot bind an aircraft about to land
  // on an occupied runway, so this is the backstop that overrides it.
  if (geo.alongNm > 0 && geo.alongNm <= GO_AROUND_RUNWAY_OCCUPIED_NM && ctx.runwayOccupied) {
    goAround(runway, ac);
    events.push({ kind: 'goAround', reason: 'runway occupied' });
    return events;
  }

  // ── Stability gate inside 5 NM (§6.2) ────────────────────────────────────
  if (geo.alongNm > 0 && geo.alongNm <= GO_AROUND_GATE_NM) {
    const reason = unstableReason(ac, geo, ctx);
    if (reason) {
      goAround(runway, ac);
      events.push({ kind: 'goAround', reason });
      return events;
    }
  }

  // ── Touchdown ────────────────────────────────────────────────────────────
  if (geo.alongNm <= 0) {
    if (ac.phase === 'gs' && ac.altitudeFt < runway.elevationFt + TOUCHDOWN_WINDOW_FT) {
      events.push({ kind: 'landed' });
    } else {
      goAround(runway, ac);
      events.push({ kind: 'goAround', reason: 'crossed the threshold without a stable approach' });
    }
  }

  return events;
}

function unstableReason(ac: Aircraft, geo: FinalGeometry, ctx: ApproachContext): string | null {
  if (!isEstablished(ac, geo)) return 'not established on the localizer';
  if (ac.altitudeFt > geo.gsAltitudeFt + GO_AROUND_ABOVE_GS_FT) return 'high on the glideslope';
  if (ac.iasKts > ac.type.vappKts + GO_AROUND_OVERSPEED_KTS) return 'excessive speed on final';
  // Last-resort backstop only. The 4 NM sequencing gap is enforced out at
  // 10 NM (§9.3); this close in the runway genuinely will not be clear, and
  // nothing the controller does now can change that.
  if (ctx.inTrailNm !== null && ctx.inTrailNm < GO_AROUND_IN_TRAIL_NM) {
    return `insufficient spacing (${ctx.inTrailNm.toFixed(1)} NM to the aircraft ahead)`;
  }
  return null;
}

function goAround(runway: Runway, ac: Aircraft): void {
  ac.phase = 'goAround';
  ac.handedOff = false;
  ac.speedAssignedAfterClearance = false;
  ac.goArounds += 1;
  ac.targetAltitudeFt = runway.missedApproachAltitudeFt;
  ac.targetHeadingDeg = runway.courseDeg;
  ac.targetIasKts = ac.type.minCleanKts;
}
