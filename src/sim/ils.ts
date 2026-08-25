/**
 * ILS approach logic: the clearance gate, the intercept window, localizer and
 * glideslope capture, the deceleration schedule, landing and go-arounds (§6).
 *
 * The clearance and the intercept are deliberately two separate gates. A
 * clearance says *what the aircraft will do when it gets to the localizer*, so
 * it may legally be given before the aircraft is anywhere near the window —
 * turned 30° onto the intercept in the same breath, or still descending to the
 * platform. Whether it actually intercepts is settled later, at the localizer,
 * by `evaluateIntercept` (§6.1a).
 */
import { AIRPORT } from '../scenario/airport.js';
import type { Aircraft } from './aircraft.js';
import {
  APPROACH_SPEED_GATES,
  FINAL_SPEED_NM,
  GO_AROUND_ABOVE_GS_FT,
  GO_AROUND_ALT_FT,
  GO_AROUND_GATE_NM,
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
  MVA_FT,
  PURSUIT_LEAD_NM,
} from './constants.js';
import {
  bearing,
  clamp,
  distance,
  headingDelta,
  headingDiff,
  headingVector,
  normalizeHeading,
  type Deg,
  type Ft,
  type Nm,
  type Point,
  type Sec,
} from './units.js';

const RUNWAY = AIRPORT.runway;
/** Unit vector 90° right of the landing direction. */
const RIGHT = headingVector(RUNWAY.courseDeg + 90);

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
export function glideslopeAltitudeFt(alongNm: Nm): Ft {
  return Math.max(AIRPORT.elevationFt, alongNm * GS_FT_PER_NM + AIRPORT.elevationFt);
}

/** A point on the extended centerline, `alongNm` before the threshold. */
export function centerlinePoint(alongNm: Nm): Point {
  return {
    x: RUNWAY.threshold.x - RUNWAY.direction.x * alongNm,
    y: RUNWAY.threshold.y - RUNWAY.direction.y * alongNm,
  };
}

export function finalGeometry(ac: Aircraft): FinalGeometry {
  const rx = ac.x - RUNWAY.threshold.x;
  const ry = ac.y - RUNWAY.threshold.y;
  const alongNm = -(rx * RUNWAY.direction.x + ry * RUNWAY.direction.y);
  const xtkNm = rx * RIGHT.x + ry * RIGHT.y;

  const track = headingVector(ac.headingDeg);
  const xtkRate = track.x * RIGHT.x + track.y * RIGHT.y;
  const closing = Math.abs(xtkNm) < 0.05 || xtkNm * xtkRate < 0;

  return {
    alongNm,
    xtkNm,
    gsAltitudeFt: glideslopeAltitudeFt(alongNm),
    interceptAngleDeg: headingDiff(ac.headingDeg, RUNWAY.courseDeg),
    closing,
  };
}

export function rangeToThresholdNm(ac: Aircraft): Nm {
  return distance({ x: ac.x, y: ac.y }, RUNWAY.threshold);
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
export type RefusalCode =
  | 'state'
  | 'belowMva'
  | 'outOfRange'
  | 'notClosing'
  | 'pastThreshold';

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
 * *meaningless* refuse it — the geometry is nonsense, or the localizer cannot
 * be received at all. Everything about the aircraft's instantaneous state
 * (angle, level, speed) is a prediction at this point and belongs to
 * `evaluateIntercept` instead. Every refusal still names the condition that
 * failed: this is the app's main teaching surface.
 */
export function evaluateClearance(ac: Aircraft, geo: FinalGeometry): ClearanceResult {
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
  if (ac.altitudeFt < MVA_FT - 1) return refuse('belowMva', `below the MVA of ${MVA_FT} ft`);

  if (geo.alongNm > LOC_RANGE_NM) {
    return refuse(
      'outOfRange',
      `${geo.alongNm.toFixed(0)} NM out — beyond ${LOC_RANGE_NM} NM localizer range`,
    );
  }
  // A track that takes the aircraft away from the localizer is not a prediction
  // that has yet to come true; it will never reach the window at all.
  if (!geo.closing) return refuse('notClosing', 'not closing on the localizer');

  // Accepted, but flag poor technique. Anything the aircraft can still fix on
  // the way in is advisory here and decided for real at the localizer.
  if (ac.altitudeFt > geo.gsAltitudeFt) {
    warnings.push(
      `${Math.round(ac.altitudeFt - geo.gsAltitudeFt)} ft above the glideslope at ` +
        `${geo.alongNm.toFixed(1)} NM — must be at or below it by the intercept`,
    );
  }
  if (ac.iasKts > 210 && geo.alongNm < 15) {
    warnings.push(`${Math.round(ac.iasKts)} kt inside 15 NM is fast`);
  }
  if (geo.alongNm < 6) warnings.push('rushed intercept inside 6 NM');

  return { ok: true, warnings };
}

/** Why an aircraft failed to intercept, for the score panel's breakdown. */
export type InterceptFailureCode = 'interceptAngle' | 'notLevel' | 'tooFast';

export interface InterceptResult {
  ok: boolean;
  /** Why the localizer was not captured — shown to the player verbatim. */
  reason?: string;
  code?: InterceptFailureCode;
  /** Captured, but poor practice. Logged and scored. */
  warnings: string[];
}

/**
 * The intercept window (§6.1a), tested at the localizer rather than at the
 * clearance. The three conditions are what a real autopilot needs to arm and
 * fly a localizer capture: a shallow enough angle to turn onto the course
 * before overshooting, wings-level cruise flight rather than an active descent,
 * and a speed the turn can actually be flown at.
 *
 * The glideslope is deliberately *not* checked here. It has its own capture,
 * from below only, further down this file — which is exactly what "checked
 * individually at the time of intercept" means for the vertical axis.
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
  if (Math.abs(ac.vsFpm) > LEVEL_VS_LIMIT_FPM) {
    return miss('notLevel', `still ${Math.abs(Math.round(ac.vsFpm))} fpm — not level`);
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

/** Heading that tracks the localizer, by pure pursuit toward a point down the centerline. */
export function localizerHeading(ac: Aircraft, geo: FinalGeometry): Deg {
  const lead = clamp(geo.alongNm * 0.4, 0.6, PURSUIT_LEAD_NM);
  const aim = centerlinePoint(Math.max(0.2, geo.alongNm - lead));
  const desired = bearing({ x: ac.x, y: ac.y }, aim);
  // Never allow a wild correction — clamp to ±25° of the course.
  const offset = clamp(
    headingDelta(RUNWAY.courseDeg, desired),
    -MAX_LOC_CORRECTION_DEG,
    MAX_LOC_CORRECTION_DEG,
  );
  return normalizeHeading(RUNWAY.courseDeg + offset);
}

/**
 * Speed once cleared. It becomes the aircraft's own business, unless the
 * player reissued one — the "maintain X kt until Y mile final" technique,
 * which is honoured until 5 NM.
 */
export function approachSpeedTargetKts(ac: Aircraft, alongNm: Nm): number {
  if (alongNm <= FINAL_SPEED_NM) return ac.type.vappKts;
  if (ac.speedAssignedAfterClearance) return ac.targetIasKts;
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
  ac: Aircraft,
  geo: FinalGeometry,
  ctx: ApproachContext,
  dt: Sec,
): ApproachEvent[] {
  const events: ApproachEvent[] = [];

  if (ac.phase === 'goAround') {
    ac.targetAltitudeFt = GO_AROUND_ALT_FT;
    ac.targetHeadingDeg = RUNWAY.courseDeg;
    ac.targetIasKts = ac.type.minCleanKts;
    if (Math.abs(ac.altitudeFt - GO_AROUND_ALT_FT) < 100) ac.phase = 'inbound';
    return events;
  }

  if (ac.phase === 'inbound') return events;

  // ── Localizer capture ────────────────────────────────────────────────────
  // Reaching the localizer is where the clearance is finally tested. An
  // aircraft that arrives outside the window does not capture and does not go
  // around: it flies straight through the centerline, the clearance is gone,
  // and the controller has to vector it back and clear it again (§6.1a).
  if (ac.phase === 'cleared') {
    if (Math.abs(geo.xtkNm) < LOC_CAPTURE_XTK_NM && geo.alongNm > 0 && geo.closing) {
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
    ac.targetHeadingDeg = localizerHeading(ac, geo);
    ac.targetIasKts = approachSpeedTargetKts(ac, geo.alongNm);
  }

  // ── Glideslope capture ───────────────────────────────────────────────────
  // Only as the path passes through our level. An aircraft sitting well above
  // the path must never "capture" it downwards — that is the high-and-hot case
  // the clearance gate exists to prevent, and the go-around gate to catch.
  if (ac.phase === 'loc' && Math.abs(geo.gsAltitudeFt - ac.altitudeFt) <= GS_CAPTURE_WINDOW_FT) {
    ac.phase = 'gs';
    events.push({ kind: 'gsCaptured' });
  }

  if (ac.phase === 'gs') {
    // Fly the path exactly; derive the vertical rate for display (~740 fpm at 140 kt).
    const previous = ac.altitudeFt;
    ac.altitudeFt = Math.min(previous, geo.gsAltitudeFt);
    ac.targetAltitudeFt = AIRPORT.elevationFt;
    ac.vsFpm = dt > 0 ? ((ac.altitudeFt - previous) / dt) * 60 : 0;
  }

  // ── The runway itself, inside 0.3 NM (§6.2) ──────────────────────────────
  // Separate from the stability gate below and deliberately much later: this is
  // not about how the approach was flown, it is about what is on the concrete.
  // A release decision made a minute ago cannot bind an aircraft about to land
  // on an occupied runway, so this is the backstop that overrides it.
  if (geo.alongNm > 0 && geo.alongNm <= GO_AROUND_RUNWAY_OCCUPIED_NM && ctx.runwayOccupied) {
    goAround(ac);
    events.push({ kind: 'goAround', reason: 'runway occupied' });
    return events;
  }

  // ── Stability gate inside 5 NM (§6.2) ────────────────────────────────────
  if (geo.alongNm > 0 && geo.alongNm <= GO_AROUND_GATE_NM) {
    const reason = unstableReason(ac, geo, ctx);
    if (reason) {
      goAround(ac);
      events.push({ kind: 'goAround', reason });
      return events;
    }
  }

  // ── Touchdown ────────────────────────────────────────────────────────────
  if (geo.alongNm <= 0) {
    if (ac.phase === 'gs' && ac.altitudeFt < AIRPORT.elevationFt + 200) {
      events.push({ kind: 'landed' });
    } else {
      goAround(ac);
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

function goAround(ac: Aircraft): void {
  ac.phase = 'goAround';
  ac.handedOff = false;
  ac.speedAssignedAfterClearance = false;
  ac.goArounds += 1;
  ac.targetAltitudeFt = GO_AROUND_ALT_FT;
  ac.targetHeadingDeg = RUNWAY.courseDeg;
  ac.targetIasKts = ac.type.minCleanKts;
}
