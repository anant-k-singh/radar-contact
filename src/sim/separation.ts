/**
 * Separation monitoring (docs §9). IF ATC manual 6.2.2: no closer than 3 NM
 * laterally *or* 1000 ft vertically — so a violation needs both to be breached.
 */
import { AIRPORT } from '../scenario/airport.js';
import type { Aircraft, AlertLevel } from './aircraft.js';
import { isDeparture } from './aircraft.js';
import { groundSpeed } from './dynamics.js';
import { finalGeometry } from './ils.js';
import {
  ALERT_RED_HORIZ_NM,
  ALERT_RED_VERT_FT,
  CONFLICT_PREDICT_S,
  CONFLICT_PREDICT_STEP_S,
  CONFLICT_SCREEN_HORIZ_NM,
  CONFLICT_SCREEN_VERT_FT,
  IN_TRAIL_MIN_NM,
  IN_TRAIL_SEQUENCING_MIN_NM,
  IN_TRAIL_SEQUENCING_RANGE_NM,
  RUNWAY_SEP_EXEMPT_FT,
  RUNWAY_SEP_EXEMPT_NM,
  SEP_HORIZ_NM,
  SEP_VERT_FT,
} from './constants.js';
import { distance, headingVector, type Nm } from './units.js';

export interface ConflictPair {
  a: Aircraft;
  b: Aircraft;
  horizNm: Nm;
  vertFt: number;
  level: Exclude<AlertLevel, 'none'>;
  /** <1.5 NM and <500 ft — the tier that warrants an audible alarm. */
  red: boolean;
  key: string;
}

export interface SeparationReport {
  pairs: ConflictPair[];
  alerts: Map<number, AlertLevel>;
  /** Distance to the aircraft ahead on final, per aircraft id. */
  inTrail: Map<number, Nm>;
  /** The aircraft ahead on final, per aircraft id. */
  inTrailLeader: Map<number, Aircraft>;
  /** The in-trail minimum that applies to this aircraft right now, per id. */
  inTrailMinimum: Map<number, Nm>;
}

const pairKey = (a: Aircraft, b: Aircraft): string =>
  a.id < b.id ? `${a.id}-${b.id}` : `${b.id}-${a.id}`;

/** True while the aircraft is tracking the final approach course. */
function onFinal(ac: Aircraft): boolean {
  return ac.phase === 'loc' || ac.phase === 'gs';
}

/**
 * True while a departure is still in the runway environment (§9.4).
 *
 * A departure rolling underneath an aircraft on short final is not a radar
 * separation problem — it is the tower's, and runway separation is what governs
 * it. Radar minima only begin to apply once the departure is airborne and away
 * from the runway, so until then the pair is skipped, exactly as two aircraft on
 * the same localizer are.
 *
 * Both halves of the test matter: the height alone would carry the exemption
 * with an aircraft the player has managed to get in front of somewhere else, and
 * the distance alone would exempt one still sitting on the runway at 5 NM.
 */
function inRunwayEnvironment(ac: Aircraft): boolean {
  if (!isDeparture(ac)) return false;
  if (ac.phase === 'roll') return true;
  return (
    ac.altitudeFt - AIRPORT.elevationFt < RUNWAY_SEP_EXEMPT_FT &&
    distance({ x: ac.x, y: ac.y }, AIRPORT.runway.threshold) < RUNWAY_SEP_EXEMPT_NM
  );
}

/**
 * The in-trail minimum in force for an aircraft this far down the final.
 *
 * The landing interval is set by the runway rather than the radar — the one
 * ahead has to land, roll out and vacate first — but that gap is only buildable
 * out where there is still room to vector and slow. So the requirement bites at
 * **10 NM and beyond**, at 4 NM, and inside 10 NM the ordinary 3 NM radar
 * minimum applies: by then the sequence is what it is, and squeezing an
 * aircraft on short final achieves nothing (§9.3).
 */
export function inTrailMinimumNm(alongNm: Nm): Nm {
  return alongNm >= IN_TRAIL_SEQUENCING_RANGE_NM ? IN_TRAIL_SEQUENCING_MIN_NM : IN_TRAIL_MIN_NM;
}

/**
 * In-trail spacing on final. Aircraft on the same localizer are not laterally
 * separated in the usual sense, so they are measured nose-to-tail instead.
 */
export function inTrailSpacing(aircraft: readonly Aircraft[]): {
  spacing: Map<number, Nm>;
  leader: Map<number, Aircraft>;
  minimum: Map<number, Nm>;
} {
  const spacing = new Map<number, Nm>();
  const leader = new Map<number, Aircraft>();
  const minimum = new Map<number, Nm>();
  const queue = aircraft
    .filter((ac) => onFinal(ac))
    .map((ac) => ({ ac, along: finalGeometry(ac).alongNm }))
    .filter((entry) => entry.along > 0)
    .sort((p, q) => p.along - q.along);

  for (const entry of queue) {
    minimum.set(entry.ac.id, inTrailMinimumNm(entry.along));
  }
  for (let i = 1; i < queue.length; i += 1) {
    spacing.set(queue[i]!.ac.id, queue[i]!.along - queue[i - 1]!.along);
    leader.set(queue[i]!.ac.id, queue[i - 1]!.ac);
  }
  return { spacing, leader, minimum };
}

function horizontalDistance(a: Aircraft, b: Aircraft): Nm {
  return distance({ x: a.x, y: a.y }, { x: b.x, y: b.y });
}

/** Closest approach within the prediction window, by straight-line extrapolation. */
function predictedMinima(a: Aircraft, b: Aircraft): { horizNm: Nm; vertFt: number } {
  const va = headingVector(a.headingDeg);
  const vb = headingVector(b.headingDeg);
  const sa = groundSpeed(a) / 3600;
  const sb = groundSpeed(b) / 3600;

  let bestHoriz = Number.POSITIVE_INFINITY;
  let bestVert = Number.POSITIVE_INFINITY;
  for (let t = CONFLICT_PREDICT_STEP_S; t <= CONFLICT_PREDICT_S; t += CONFLICT_PREDICT_STEP_S) {
    const ax = a.x + va.x * sa * t;
    const ay = a.y + va.y * sa * t;
    const bx = b.x + vb.x * sb * t;
    const by = b.y + vb.y * sb * t;
    // Left as a raw hypot: this is the inner loop of an O(n²) scan at 20 Hz, and
    // `distance()` would allocate two points per iteration.
    const horiz = Math.hypot(ax - bx, ay - by);
    const vert = Math.abs(
      a.altitudeFt + (a.vsFpm * t) / 60 - (b.altitudeFt + (b.vsFpm * t) / 60),
    );
    if (horiz < bestHoriz) bestHoriz = horiz;
    if (vert < bestVert) bestVert = vert;
  }
  return { horizNm: bestHoriz, vertFt: bestVert };
}

export function analyzeSeparation(aircraft: readonly Aircraft[]): SeparationReport {
  const alerts = new Map<number, AlertLevel>();
  const pairs: ConflictPair[] = [];
  const {
    spacing: inTrail,
    leader: inTrailLeader,
    minimum: inTrailMinimum,
  } = inTrailSpacing(aircraft);

  const raise = (ac: Aircraft, level: AlertLevel): void => {
    const current = alerts.get(ac.id);
    if (level === 'violation' || current === undefined || current === 'none') {
      if (current !== 'violation') alerts.set(ac.id, level);
    }
  };

  for (let i = 0; i < aircraft.length; i += 1) {
    for (let j = i + 1; j < aircraft.length; j += 1) {
      const a = aircraft[i]!;
      const b = aircraft[j]!;

      // Both on the localizer: in-trail spacing applies instead (§9.3).
      if (onFinal(a) && onFinal(b)) continue;
      // One of them is still on or just off the runway: runway separation
      // applies instead, and it is the tower's to apply (§9.4).
      if (inRunwayEnvironment(a) || inRunwayEnvironment(b)) continue;

      const horizNm = horizontalDistance(a, b);
      const vertFt = Math.abs(a.altitudeFt - b.altitudeFt);

      if (horizNm < SEP_HORIZ_NM && vertFt < SEP_VERT_FT) {
        const red = horizNm < ALERT_RED_HORIZ_NM && vertFt < ALERT_RED_VERT_FT;
        pairs.push({ a, b, horizNm, vertFt, level: 'violation', red, key: pairKey(a, b) });
        raise(a, 'violation');
        raise(b, 'violation');
        continue;
      }

      if (horizNm > CONFLICT_SCREEN_HORIZ_NM || vertFt > CONFLICT_SCREEN_VERT_FT) continue;

      const predicted = predictedMinima(a, b);
      if (predicted.horizNm < SEP_HORIZ_NM && predicted.vertFt < SEP_VERT_FT) {
        pairs.push({
          a,
          b,
          horizNm,
          vertFt,
          level: 'warning',
          red: false,
          key: pairKey(a, b),
        });
        raise(a, 'warning');
        raise(b, 'warning');
      }
    }
  }

  // In-trail busts on final.
  for (const ac of aircraft) {
    const spacing = inTrail.get(ac.id);
    const leader = inTrailLeader.get(ac.id);
    const minimum = inTrailMinimum.get(ac.id) ?? IN_TRAIL_MIN_NM;
    if (spacing === undefined || leader === undefined || spacing >= minimum) continue;
    raise(ac, 'violation');
    raise(leader, 'violation');
    pairs.push({
      a: leader,
      b: ac,
      horizNm: spacing,
      vertFt: Math.abs(leader.altitudeFt - ac.altitudeFt),
      level: 'violation',
      red: spacing < ALERT_RED_HORIZ_NM,
      key: pairKey(leader, ac),
    });
  }

  return { pairs, alerts, inTrail, inTrailLeader, inTrailMinimum };
}
