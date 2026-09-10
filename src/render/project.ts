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
 * one. Thirteen rows against the twelve `drawStats` currently emits, so the
 * reserve stays right if a statistic is added.
 */
export const STATS_BLOCK_HEIGHT_PX = 34 + 13 * 15;

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

/**
 * At rest: no zoom, and no pan *away from the airspace's own centre* — which is
 * what makes `focus` an offset from the view centre rather than an absolute
 * world point. Stated that way so this constant stays field-independent.
 */
export const DEFAULT_VIEWPORT: Viewport = { zoom: 1, focus: { x: 0, y: 0 } };

/**
 * Where the local frame's origin — the airport — sits on the canvas, unzoomed.
 *
 * The scope's own furniture is drawn in the base frame so that it keeps its
 * fitted size and place while the content magnifies inside it, and all of that
 * furniture (the boundary, the clip region) is positioned relative to the
 * *airport* rather than to the middle of the canvas. Those were the same point
 * until an airspace turned up that is not centred on its field.
 */
export function baseOrigin(p: Projection): Point {
  return {
    x: p.base.cx - p.base.viewCentre.x * p.base.pxPerNm,
    y: p.base.cy + p.base.viewCentre.y * p.base.pxPerNm,
  };
}

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

/**
 * The fitted, unzoomed frame: where the *canvas centre* is, and at what scale.
 *
 * `cx`/`cy` are the middle of the space the scope was given, which is where the
 * airspace's own `view` centre is placed — not, in general, where the airport is.
 * At an approach field the two coincide, because the view centre of a circle
 * around the field is the field. At a sector field they do not, and anything
 * drawing the scope's fixed furniture in world coordinates wants `baseOrigin`.
 */
export interface BaseFrame {
  cx: number;
  cy: number;
  pxPerNm: number;
  /** The world point held at `cx`/`cy` when the viewport is at rest. */
  viewCentre: Point;
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
  // canvas. The shape's full east–west extent still has to fit, so on a narrow
  // window the width takes over.
  //
  // Both extents come from the compiled `view` box rather than from the radius,
  // which is what lets a sector-shaped airspace fill the canvas: a wedge from 50
  // to 180 NM on one side of the field is nowhere near centred on the field, and
  // fitting a 180 NM radius about the ARP would draw it in a corner at a third of
  // the usable scale.
  const view = airspace.view;
  const byHeight = ((height / 2) * FIT) / view.halfHeightNm;
  const byWidth = ((scopeWidth / 2) * FIT) / view.halfWidthNm;
  // Zoom is folded in *after* the gutter is reserved, so magnifying the content
  // cannot slide it under the stats panel.
  const base: BaseFrame = {
    cx: scopeWidth / 2,
    cy: height / 2,
    pxPerNm: Math.min(byHeight, byWidth),
    viewCentre: view.centre,
  };

  // Pan by moving the origin so the focus lands on the fixed centre. The view's
  // own centre is the resting focus, so at an approach field — where it is the
  // arp — this is the identity it has always been.
  const pxPerNm = base.pxPerNm * viewport.zoom;
  const focus = { x: viewport.focus.x + view.centre.x, y: viewport.focus.y + view.centre.y };
  return {
    width,
    height,
    cx: base.cx - focus.x * pxPerNm,
    cy: base.cy + focus.y * pxPerNm,
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
  // Where the anchor must sit relative to the canvas centre, at the new scale —
  // less the view centre, since `focus` is an offset from it rather than an
  // absolute point.
  return {
    x: at.x - p.base.viewCentre.x - (sx - p.base.cx) / pxPerNm,
    y: at.y - p.base.viewCentre.y + (sy - p.base.cy) / pxPerNm,
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
