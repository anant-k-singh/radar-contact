/**
 * The hovered SID: every fix named, every published level printed.
 *
 * The chart layer thins a SID's figures down to the ones the controller cannot
 * infer — a floor only at a turn, at the exit and at the first fix after the
 * runway, because a departure's floors otherwise print a column of ascending
 * numbers along a line that never turns (see `drawSidChart`). That is the right
 * default and it is also lossy: the levels are *there*, in `scenario.sids`, and a
 * player who wants to read one has no way to ask.
 *
 * Hovering is that ask. It prints the fix names, which the chart layer never
 * shows at all, and the figures the thinning dropped.
 *
 * **This draws per frame, not into `mapLayer`.** The map layer is an offscreen
 * canvas keyed on field and viewport; painting a hover into it would rebuild the
 * whole chart on every pointer move, which is the one redraw that would actually
 * cost something. Drawing here costs a few dozen segment tests and under ten
 * labels, against the per-aircraft blocks `drawTraffic` already paints at 20 fps.
 *
 * What it must *not* do is disagree with the layer underneath. Both go through
 * `sidFixLabels`, so "would the chart have printed this" is asked once and
 * answered the same way twice — two copies of that rule would drift into a
 * doubled label.
 */
import type { Scenario, Sid } from '../scenario/types.js';
import type { Point } from '../sim/units.js';
import { haloText, sidFixLabels } from './mapLayer.js';
import { toScreen, type Projection } from './project.js';
import { THEME } from './theme.js';

/**
 * How near the pointer has to be to a SID's track to pick it, in pixels.
 *
 * Generous, because the track is a 1.5 px line drawn at `SID_ALPHA` and hitting
 * it exactly is not a thing a player should have to do. Small enough that two
 * SIDs sharing a leg still resolve by which one the pointer is nearer.
 */
const HOVER_PX = 12;

/**
 * Which SID the pointer is over, or null.
 *
 * Nearest wins rather than first: LSGG's five SIDs share their first leg out of
 * the field, and picking the first in registration order would make four of them
 * unhoverable near the runway.
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

  // The track again, at full strength over the receded one.
  ctx.strokeStyle = THEME.sidHover;
  ctx.lineWidth = 2;
  ctx.beginPath();
  sid.waypoints.forEach((wpt, index) => {
    const point = toScreen(p, wpt.position);
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.stroke();

  for (const { index, wpt, crossing, printed } of sidFixLabels(sid)) {
    // Index 0 is the runway threshold, which the runway drawing already owns.
    if (index === 0) continue;
    const point = toScreen(p, wpt.position);

    ctx.strokeStyle = THEME.sidHover;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(point.x, point.y, 3, 0, Math.PI * 2);
    ctx.stroke();

    // The name is the half the chart layer never draws, so it is always new.
    ctx.fillStyle = THEME.sidHover;
    haloText(ctx, wpt.name, point.x, point.y - 10);

    // The figure sits under the name. Drawn whether or not the chart already
    // printed it: overprinting an identical string at an identical point is
    // invisible, where skipping it would make the hovered route show *fewer*
    // levels at a turn than the layer beneath it.
    if (crossing !== undefined) {
      ctx.fillStyle = printed ? THEME.sidConstraint : THEME.sidHover;
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
