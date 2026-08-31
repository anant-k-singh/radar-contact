/**
 * Compatibility shim: the active field's airspace shape, under the names the
 * simulation and the scope still use.
 *
 * The shape itself moved to `src/scenario/airspace.ts`, because a radius and a
 * pair of chords are facts about a field rather than rules of the job. This file
 * binds those functions to the active scenario and goes away when `world.scenario`
 * is threaded through.
 */
import {
  boundaryMarginNm as marginNm,
  boundaryRangeAtBearing as rangeAtBearing,
} from '../scenario/airspace.js';
import { AIRPORT } from '../scenario/airport.js';
import type { Deg, Nm, Point } from './units.js';

const AIRSPACE = AIRPORT.airspace;

export const AIRSPACE_CHORD_HALF_WIDTH_NM: Nm = AIRSPACE.chordHalfWidthNm;
export const AIRSPACE_ARC_HALF_ANGLE_RAD = AIRSPACE.arcHalfAngleRad;

export function boundaryMarginNm(point: Point): Nm {
  return marginNm(AIRSPACE, point);
}

export function isInsideAirspace(point: Point): boolean {
  return marginNm(AIRSPACE, point) >= 0;
}

export function boundaryRangeAtBearing(bearingDeg: Deg): Nm {
  return rangeAtBearing(AIRSPACE, bearingDeg);
}
