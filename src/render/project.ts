import { AIRSPACE_RADIUS_NM } from '../sim/constants.js';
import type { Nm, Point } from '../sim/units.js';

/** Maps the local NM frame to canvas pixels. North is up, so screen y is inverted. */
export interface Projection {
  width: number;
  height: number;
  cx: number;
  cy: number;
  pxPerNm: number;
}

export function createProjection(width: number, height: number): Projection {
  const radiusPx = (Math.min(width, height) / 2) * 0.94;
  return {
    width,
    height,
    cx: width / 2,
    cy: height / 2,
    pxPerNm: radiusPx / AIRSPACE_RADIUS_NM,
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
