/**
 * ILS approach logic: the clearance gate, localizer and glideslope capture,
 * the deceleration schedule, landing and go-arounds (docs §6).
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
  GS_CAPTURE_WINDOW_FT,
  GS_FT_PER_NM,
  ESTABLISHED_HDG_DEG,
  ESTABLISHED_XTK_NM,
  IDEAL_INTERCEPT_ANGLE_DEG,
  LEVEL_VS_LIMIT_FPM,
  LOC_CAPTURE_XTK_NM,
  LOC_RANGE_NM,
  MAX_CLEARANCE_XTK_NM,
  MAX_INTERCEPT_ANGLE_DEG,
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
 * Established on the localizer — IF 6.14.2: "aircraft must be aligned with the
 * centerline of the runway, regardless of their position inside or outside of
 * the cone." Being near the runway is not enough.
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
  | 'interceptAngle'
  | 'aboveGlideslope'
  | 'belowMva'
  | 'outOfRange'
  | 'tooFarFromLoc'
  | 'notClosing'
  | 'notLevel'
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
 * The clearance gate (§6.1). Every refusal names the condition that failed:
 * this is the app's main teaching surface.
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

  if (geo.interceptAngleDeg > MAX_INTERCEPT_ANGLE_DEG) {
    return refuse(
      'interceptAngle',
      `intercept angle ${Math.round(geo.interceptAngleDeg)}° exceeds ${MAX_INTERCEPT_ANGLE_DEG}°`,
    );
  }

  if (ac.altitudeFt > geo.gsAltitudeFt) {
    return refuse(
      'aboveGlideslope',
      `${Math.round(ac.altitudeFt - geo.gsAltitudeFt)} ft above the glideslope at ` +
        `${geo.alongNm.toFixed(1)} NM — descend to ${Math.floor(geo.gsAltitudeFt / 1000) * 1000} ft`,
    );
  }

  if (ac.altitudeFt < MVA_FT - 1) return refuse('belowMva', `below the MVA of ${MVA_FT} ft`);

  if (geo.alongNm > LOC_RANGE_NM) {
    return refuse(
      'outOfRange',
      `${geo.alongNm.toFixed(0)} NM out — beyond ${LOC_RANGE_NM} NM localizer range`,
    );
  }
  if (Math.abs(geo.xtkNm) > MAX_CLEARANCE_XTK_NM) {
    return refuse(
      'tooFarFromLoc',
      `${Math.abs(geo.xtkNm).toFixed(1)} NM from the localizer — vector closer first`,
    );
  }
  if (!geo.closing) return refuse('notClosing', 'not closing on the localizer');

  if (Math.abs(ac.vsFpm) > LEVEL_VS_LIMIT_FPM) {
    return refuse('notLevel', 'not level yet — wait until the assigned altitude is reached');
  }

  // Accepted, but flag poor technique.
  if (geo.interceptAngleDeg > IDEAL_INTERCEPT_ANGLE_DEG) {
    warnings.push(`intercept angle ${Math.round(geo.interceptAngleDeg)}° (aim for 30°)`);
  }
  if (ac.iasKts > 210 && geo.alongNm < 15) {
    warnings.push(`${Math.round(ac.iasKts)} kt inside 15 NM is fast`);
  }
  if (geo.alongNm < 6) warnings.push('rushed intercept inside 6 NM');

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
 * Speed once cleared. Per IF 6.15.10 speed becomes the aircraft's business,
 * unless the player reissued one — the "maintain X kt until Y mile final"
 * technique of 6.14.4, which is honoured until 5 NM.
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
  | { kind: 'locCaptured' }
  | { kind: 'gsCaptured' }
  | { kind: 'landed' }
  | { kind: 'goAround'; reason: string };

export interface ApproachContext {
  /** Distance to the aircraft ahead on final, or null when there is none. */
  inTrailNm: Nm | null;
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
  if (ac.phase === 'cleared') {
    if (Math.abs(geo.xtkNm) < LOC_CAPTURE_XTK_NM && geo.alongNm > 0 && geo.closing) {
      ac.phase = 'loc';
      events.push({ kind: 'locCaptured' });
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
