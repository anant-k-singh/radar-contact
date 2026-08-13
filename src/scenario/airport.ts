/**
 * The airport definition. Swap this file to fly a different field —
 * nothing outside it hard-codes runway 18 or the gate names.
 */
import { AIRSPACE_RADIUS_NM } from '../sim/constants.js';
import { headingVector, normalizeHeading, type Deg, type Ft, type Nm, type Point } from '../sim/units.js';

export interface EntryGate {
  name: string;
  /** Bearing of the gate from the airport reference point. */
  bearingDeg: Deg;
  position: Point;
  /** Handover heading: direct to the airport reference point. */
  inboundHeadingDeg: Deg;
}

export interface Runway {
  id: string;
  /** Final approach course, i.e. the runway's own heading. */
  courseDeg: Deg;
  lengthNm: Nm;
  /** Landing threshold — the point the glideslope aims at. */
  threshold: Point;
  /** Unit vector along the landing direction. */
  direction: Point;
  /** Departure end, for drawing. */
  farEnd: Point;
}

function gate(name: string, bearingDeg: Deg): EntryGate {
  const v = headingVector(bearingDeg);
  return {
    name,
    bearingDeg,
    position: { x: v.x * AIRSPACE_RADIUS_NM, y: v.y * AIRSPACE_RADIUS_NM },
    inboundHeadingDeg: normalizeHeading(bearingDeg + 180),
  };
}

function runway(id: string, courseDeg: Deg, lengthNm: Nm): Runway {
  const direction = headingVector(courseDeg);
  // Centre the runway on the airport reference point.
  const threshold: Point = { x: (-direction.x * lengthNm) / 2, y: (-direction.y * lengthNm) / 2 };
  return {
    id,
    courseDeg,
    lengthNm,
    threshold,
    direction,
    farEnd: { x: threshold.x + direction.x * lengthNm, y: threshold.y + direction.y * lengthNm },
  };
}

export interface Airport {
  name: string;
  icao: string;
  elevationFt: Ft;
  arp: Point;
  runway: Runway;
  gates: readonly EntryGate[];
}

export const AIRPORT: Airport = {
  name: 'Approach Trainer',
  icao: 'ZZZZ',
  elevationFt: 0,
  arp: { x: 0, y: 0 },
  runway: runway('18', 180, 1.6),
  // Spaced 90° apart and offset 40° from the cardinals, so nothing enters
  // already aligned with the final approach course.
  gates: [gate('KOVAL', 40), gate('TEMBA', 130), gate('RIMOL', 230), gate('VANDA', 320)],
};
