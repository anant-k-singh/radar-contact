import type { Airspace } from '../scenario/types.js';
import type { Nm, Point } from '../sim/units.js';

/** Fraction of the canvas the airspace fills, leaving the boundary off the edge. */
const FIT = 0.98;

/**
 * Width reserved down the right-hand edge for the session stats overlay. The
 * airspace is centred in what is left, so the boundary clears the panel instead
 * of running under it — the circle moves left by half this, not all of it.
 */
export const STATS_GUTTER_PX = 190;

/**
 * How far down that gutter the stats block reaches.
 *
 * Here rather than in `statsLayer.ts` for the same reason `STATS_GUTTER_PX` is:
 * it is a fact about the space the scope is given, and the consumers are the
 * layers that have to keep out of it. `mapLayer` needs it and is the *static*
 * layer, so it has no `World` to count the panel's rows from and must not acquire
 * one. Twelve rows against the eleven `drawStats` currently emits, so the reserve
 * stays right if a statistic is added.
 */
export const STATS_BLOCK_HEIGHT_PX = 34 + 12 * 15;

/**
 * How far the scope will magnify. The controller zooms to pull apart a pair that
 * has become one smear, then goes back — it is not a way to fly the whole session
 * closer in, which is why 1x is the floor as well as the resting state.
 */
export const MAX_ZOOM = 2;
export const MIN_ZOOM = 1;

/**
 * Where the scope is looking, and how close.
 *
 * View state, so it lives in `Scope` beside the log offset rather than on the
 * `World`: a replay frame is rebuilt every redraw and anything written onto it is
 * lost (docs §17.3). It is also not recorded — where the controller was looking is
 * not what the aircraft did.
 */
export interface Viewport {
  zoom: number;
  /** World point held under the centre of the circle. `arp` at rest. */
  focus: Point;
}

export const DEFAULT_VIEWPORT: Viewport = { zoom: 1, focus: { x: 0, y: 0 } };

/**
 * Maps the local NM frame to canvas pixels. North is up, so screen y is inverted.
 *
 * `pxPerNm` carries the zoom and `cx`/`cy` carry the pan, so every call site that
 * projects a position zooms without knowing that zoom exists — and everything sized
 * in pixels (glyphs, fonts, line widths) stays put, because none of them consult
 * `pxPerNm`. That split is what the whole feature rests on.
 */
export interface Projection {
  width: number;
  height: number;
  cx: number;
  cy: number;
  pxPerNm: number;
  /**
   * The unzoomed frame: the circle the airspace is drawn in, which does not move
   * when the content inside it does. Layers that draw the scope's own furniture —
   * the boundary, the clip region, the terrain legend out in the margin — measure
   * from this, so the shape stays fixed while the content magnifies inside it.
   */
  base: BaseFrame;
}

/** The fitted, unzoomed frame. Identical to `Projection` at 1x. */
export interface BaseFrame {
  cx: number;
  cy: number;
  pxPerNm: number;
}

export function createProjection(
  airspace: Airspace,
  width: number,
  height: number,
  viewport: Viewport = DEFAULT_VIEWPORT,
): Projection {
  // The stats overlay owns the right-hand edge, so the airspace gets the rest.
  // Reserving the gutter before fitting is what keeps the boundary off the panel
  // at every window size, rather than only at the one this was eyeballed on.
  const scopeWidth = Math.max(1, width - STATS_GUTTER_PX);

  // The chords fill the height — that is the whole reason for cutting them, and
  // it buys ~20 % more scale than fitting a 100 NM diameter into the same
  // canvas. The circle's full east–west extent still has to fit, so on a narrow
  // window the width takes over.
  const byHeight = ((height / 2) * FIT) / airspace.halfHeightNm;
  const byWidth = ((scopeWidth / 2) * FIT) / airspace.radiusNm;
  // Zoom is folded in *after* the gutter is reserved, so magnifying the content
  // cannot slide it under the stats panel.
  const base: BaseFrame = { cx: scopeWidth / 2, cy: height / 2, pxPerNm: Math.min(byHeight, byWidth) };

  // Pan by moving the origin so the focus lands on the fixed centre: at rest the
  // focus is the arp and this is the identity.
  const pxPerNm = base.pxPerNm * viewport.zoom;
  return {
    width,
    height,
    cx: base.cx - viewport.focus.x * pxPerNm,
    cy: base.cy + viewport.focus.y * pxPerNm,
    pxPerNm,
    base,
  };
}

/**
 * The world point under a screen position — the inverse of `toScreen`, and what
 * anchors a pinch: hold this fixed across a zoom change and the scope magnifies
 * about the fingers rather than about the airport.
 */
export function focusHolding(
  p: Projection,
  sx: number,
  sy: number,
  zoom: number,
): Point {
  const at = toWorld(p, sx, sy);
  const pxPerNm = p.base.pxPerNm * zoom;
  // Where the anchor must sit relative to the centre, at the new scale.
  return {
    x: at.x - (sx - p.base.cx) / pxPerNm,
    y: at.y + (sy - p.base.cy) / pxPerNm,
  };
}

export const clampZoom = (zoom: number): number =>
  zoom < MIN_ZOOM ? MIN_ZOOM : zoom > MAX_ZOOM ? MAX_ZOOM : zoom;

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
