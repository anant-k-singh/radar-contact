/**
 * The hovered SID: every fix named, every published level printed.
 *
 * The chart draws a SID as rings and a track only, so all of this is new. It
 * draws per frame rather than into `mapLayer` — that layer is cached on field and
 * viewport, and painting a hover into it would rebuild the chart on every pointer
 * move. Here it is a few dozen segment tests and under ten labels.
 */
import type { Scenario, Sid } from '../scenario/types.js';
import type { Point } from '../sim/units.js';
import { haloText, sidFixLabels } from './mapLayer.js';
import { toScreen, type Projection } from './project.js';
import { THEME } from './theme.js';

/** Pick radius. Generous — the track is a 1.5 px line at `SID_ALPHA`. */
const HOVER_PX = 12;

/**
 * Which SID the pointer is over, or null. Nearest wins rather than first: four of
 * LSGG's five share the leg out to PAS, and first-match makes three unpickable.
 */
export function sidUnderPointer(
  scenario: Scenario,
  p: Projection,
  sx: number,
  sy: number,
): Sid | null {
  let best: Sid | null = null;
  let bestPx = HOVER_PX;
  for (const sid of scenario.sids) {
    for (let i = 1; i < sid.waypoints.length; i += 1) {
      const a = toScreen(p, sid.waypoints[i - 1]!.position);
      const b = toScreen(p, sid.waypoints[i]!.position);
      const px = distanceToSegmentPx({ x: sx, y: sy }, a, b);
      if (px < bestPx) {
        bestPx = px;
        best = sid;
      }
    }
  }
  return best;
}

export function drawSidHover(
  ctx: CanvasRenderingContext2D,
  p: Projection,
  sid: Sid,
): void {
  ctx.save();
  ctx.font = THEME.fontLabel;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';

  // The track again over the receded one — lifted, but well below the labels.
  // It only has to say which route these belong to; it is not what is being read.
  ctx.strokeStyle = THEME.sidHoverPath;
  ctx.lineWidth = 2;
  ctx.beginPath();
  sid.waypoints.forEach((wpt, index) => {
    const point = toScreen(p, wpt.position);
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.stroke();

  for (const { index, wpt, crossing } of sidFixLabels(sid)) {
    // Index 0 is the runway threshold, which the runway drawing already owns.
    if (index === 0) continue;
    const point = toScreen(p, wpt.position);

    ctx.strokeStyle = THEME.sidHoverPath;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(point.x, point.y, 3, 0, Math.PI * 2);
    ctx.stroke();

    // The name is the half the chart layer never draws, so it is always new.
    ctx.fillStyle = THEME.sidHover;
    haloText(ctx, wpt.name, point.x, point.y - 10);

    // Under the name. All new — the chart draws no SID figures.
    if (crossing !== undefined) {
      ctx.fillStyle = THEME.sidHover;
      haloText(ctx, crossing, point.x, point.y + 10);
    }
  }

  ctx.restore();
}

/** Pixel distance from a point to a segment — the hit test, in screen space. */
function distanceToSegmentPx(point: Point, a: Point, b: Point): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const lengthSq = vx * vx + vy * vy;
  if (lengthSq < 1e-9) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.max(
    0,
    Math.min(1, ((point.x - a.x) * vx + (point.y - a.y) * vy) / lengthSq),
  );
  return Math.hypot(point.x - (a.x + vx * t), point.y - (a.y + vy * t));
}
