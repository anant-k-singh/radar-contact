/**
 * The selected aircraft's whole recorded path, in replay only (docs §17.3).
 *
 * The live scope shows where an aircraft has been for the last 100 s and where
 * it is pointing for the next 60 — that is what a controller can act on. A
 * replay is not being controlled, so the useful question is the opposite one:
 * *what did this aircraft actually end up doing?* The answer is the whole
 * track, drawn under the traffic so the blips still read on top of it.
 */
import type { Point } from '../sim/units.js';
import type { Projection } from './project.js';
import { screenX, screenY } from './project.js';
import { THEME } from './theme.js';

export interface TrackPathView {
  flown: readonly Point[];
  remaining: readonly Point[];
}

function stroke(
  ctx: CanvasRenderingContext2D,
  points: readonly Point[],
  p: Projection,
  color: string,
  widthPx: number,
): void {
  if (points.length < 2) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = widthPx;
  // Solid, and stated rather than inherited: the traffic layer leaves both of
  // these set from the previous frame's blips.
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
  ctx.beginPath();
  points.forEach((point, index) => {
    const sx = screenX(p, point.x);
    const sy = screenY(p, point.y);
    if (index === 0) ctx.moveTo(sx, sy);
    else ctx.lineTo(sx, sy);
  });
  ctx.stroke();
}

export function drawTrackPath(
  ctx: CanvasRenderingContext2D,
  path: TrackPathView,
  p: Projection,
): void {
  // One solid line through the whole flight, the part still to come a shade
  // dimmer. Dashing it read as a cleared route rather than as history, and cost
  // it the legibility it needs where the track lies along a STAR leg.
  stroke(ctx, path.remaining, p, THEME.pathRemaining, 1.4);
  stroke(ctx, path.flown, p, THEME.pathFlown, 1.6);
}
