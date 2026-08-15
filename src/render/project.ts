import { AIRSPACE_HALF_HEIGHT_NM, AIRSPACE_RADIUS_NM } from '../sim/constants.js';
import type { Nm, Point } from '../sim/units.js';

/** Fraction of the canvas the airspace fills, leaving the boundary off the edge. */
const FIT = 0.98;

/**
 * Width reserved down the right-hand edge for the session stats overlay. The
 * airspace is centred in what is left, so the boundary clears the panel instead
 * of running under it — the circle moves left by half this, not all of it.
 */
export const STATS_GUTTER_PX = 190;

/** Maps the local NM frame to canvas pixels. North is up, so screen y is inverted. */
export interface Projection {
  width: number;
  height: number;
  cx: number;
  cy: number;
  pxPerNm: number;
}

export function createProjection(width: number, height: number): Projection {
  // The stats overlay owns the right-hand edge, so the airspace gets the rest.
  // Reserving the gutter before fitting is what keeps the boundary off the panel
  // at every window size, rather than only at the one this was eyeballed on.
  const scopeWidth = Math.max(1, width - STATS_GUTTER_PX);

  // The chords fill the height — that is the whole reason for cutting them, and
  // it buys ~20 % more scale than fitting a 100 NM diameter into the same
  // canvas. The circle's full east–west extent still has to fit, so on a narrow
  // window the width takes over.
  const byHeight = ((height / 2) * FIT) / AIRSPACE_HALF_HEIGHT_NM;
  const byWidth = ((scopeWidth / 2) * FIT) / AIRSPACE_RADIUS_NM;
  return {
    width,
    height,
    cx: scopeWidth / 2,
    cy: height / 2,
    pxPerNm: Math.min(byHeight, byWidth),
  };
}

export function screenX(p: Projection, xNm: Nm): number {
  return p.cx + xNm * p.pxPerNm;
}

export function screenY(p: Projection, yNm: Nm): number {
  return p.cy - yNm * p.pxPerNm;
}

export function toScreen(p: Projection, point: Point): { x: number; y: number } {
  return { x: screenX(p, point.x), y: screenY(p, point.y) };
}

export function toWorld(p: Projection, sx: number, sy: number): Point {
  return { x: (sx - p.cx) / p.pxPerNm, y: (p.cy - sy) / p.pxPerNm };
}
