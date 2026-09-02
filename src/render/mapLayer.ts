/**
 * The static scope furniture: range rings, compass ticks, the runway, the
 * extended centerline with 2 NM markers, and the entry gates.
 *
 * Drawn once to an offscreen canvas and blitted every frame — it only changes
 * when the window is resized.
 */
import { boundaryRangeAtBearing, isInsideAirspace } from '../scenario/airspace.js';
import type { Scenario, Sid } from '../scenario/types.js';
import { centerlinePoint } from '../sim/ils.js';
import { bearing, headingDiff, headingVector, magnitude, type Ft, type Nm, type Point } from '../sim/units.js';
import {
  screenX,
  screenY,
  STATS_BLOCK_HEIGHT_PX,
  STATS_GUTTER_PX,
  toScreen,
  type Projection,
} from './project.js';
import { THEME } from './theme.js';

/**
 * How far the SID chart sits behind the STAR chart. Low enough that a departure
 * route reads as background the moment the eye is looking for an arrival one,
 * high enough that following one across the scope is still easy.
 */
const SID_ALPHA = 0.55;

/** Line height of a stacked label block. */
const LABEL_LINE_PX = 11;

/**
 * Text with a dark outline behind it.
 *
 * Every label on this layer sits on top of something — a route line, a range ring,
 * the boundary — and at this size a dim label crossing a line of similar brightness
 * stops being readable. The outline is the background colour, so it reads as the
 * label having cut a hole in whatever it crosses rather than as a border.
 */
function haloText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number): void {
  ctx.save();
  ctx.strokeStyle = THEME.background;
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.strokeText(text, x, y);
  ctx.restore();
  ctx.fillText(text, x, y);
}

let cache: { key: string; canvas: HTMLCanvasElement } | null = null;

export function mapLayer(
  scenario: Scenario,
  projection: Projection,
  dpr: number,
): HTMLCanvasElement {
  // Keyed by the field as well as the canvas: the chart is what this layer draws,
  // so a different field is a different layer even at the same size.
  const key = `${scenario.id}|${projection.width}x${projection.height}@${dpr}`;
  if (cache && cache.key === key) return cache.canvas;

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(projection.width * dpr));
  canvas.height = Math.max(1, Math.round(projection.height * dpr));
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(ctx, scenario, projection);
  }
  cache = { key, canvas };
  return canvas;
}

function draw(ctx: CanvasRenderingContext2D, scenario: Scenario, p: Projection): void {
  ctx.fillStyle = THEME.background;
  ctx.fillRect(0, 0, p.width, p.height);

  // Under everything, in the order the ground itself is layered: high ground
  // shaded, then the coast drawn on top of it.
  drawTerrain(ctx, scenario, p);
  drawCoastline(ctx, scenario, p);
  drawRings(ctx, scenario, p);
  drawCompassTicks(ctx, scenario, p);
  drawStars(ctx, scenario, p);
  // After the STARs, so where a SID passes under one the departure track is the
  // line drawn on top — which is the one carrying the restriction that matters.
  drawSids(ctx, scenario, p);
  drawCenterline(ctx, scenario, p);
  drawRunway(ctx, scenario, p);
  drawGates(ctx, scenario, p);
}

/**
 * One callout per terrain band, keyed off the boundary.
 *
 * Labelling a band from inside it does not work on this scope, and the reason is
 * not that the bands are small. The compass rose prints its bearings 24 px *inside*
 * the boundary and the gates own the edge on their own radials, so the eastern
 * third of the airspace — which is exactly where the terrain is — is already spoken
 * for; an `MSA 4000` placed in the band lands on the `090` tick, and one placed in
 * a coastal ring collides with the fix labels the player is actually reading. The
 * chart is the working layer and the terrain is context, so the context moves out.
 *
 * So each band gets a leader from a point inside it to a figure just outside the
 * boundary — stopping a few pixels past the arc rather than running to the edge of
 * the canvas, which would draw a full-width rule across the scope and put the
 * figures under the stats panel. A leader crossing the boundary once and ending on
 * open background is unambiguous in a way an interior label is not: it says *this*
 * area, and it cannot be mistaken for a crossing restriction on a route beneath
 * it.
 *
 * **One per band, not one per ring.** The point of the figure is the step in the
 * ramp — "the dark green is 4000, the next one up is 5000" — and once that reads,
 * repeating it on all twenty-six rings is noise: the fill itself already says which
 * band any given patch belongs to. So the anchor is the band's most generous
 * interior point, which is the patch the eye lands on anyway.
 */
function drawTerrainCallouts(
  ctx: CanvasRenderingContext2D,
  scenario: Scenario,
  p: Projection,
): void {
  if (scenario.terrain.length === 0) return;

  ctx.save();
  ctx.font = THEME.fontLabel;
  ctx.textBaseline = 'middle';

  // Stack the labels down the right-hand margin in band order, so the reader gets
  // the ramp as a legend — lowest at the top — rather than three figures scattered
  // wherever their bands happen to sit.
  const anchors = scenario.terrain
    .map((band) => {
      let best: (Point & { clearanceNm: Nm }) | null = null;
      for (const ring of band.rings) {
        const spot = labelSpot(ring, (point) => isInsideAirspace(scenario.airspace, point));
        if (spot !== null && (best === null || spot.clearanceNm > best.clearanceNm)) best = spot;
      }
      return best === null ? null : { levelFt: band.levelFt, at: best };
    })
    .filter((entry): entry is { levelFt: Ft; at: Point & { clearanceNm: Nm } } => entry !== null)
    // A band with nowhere to put a leader's foot is a band whose rings are all
    // slivers; there is nothing for the callout to point at.
    .filter((entry) => entry.at.clearanceNm >= TERRAIN_CALLOUT_FOOT_CLEARANCE_NM);

  // Each figure sits level with its own anchor, so the leader runs out almost
  // horizontally and crosses as little of the terrain as possible. Only when two
  // would overlap is one moved, and then by the least that separates them —
  // pushing the later one down, or up if there is no room below. Stacking them
  // all downward from the first (which is what this did at first) drags the whole
  // set to the bottom of the canvas behind the lowest band's anchor, and every
  // leader then cuts diagonally across the fill it is trying to point at.
  const lo = TERRAIN_CALLOUT_MARGIN_PX;
  const hi = p.height - TERRAIN_CALLOUT_MARGIN_PX;
  const placed: number[] = [];
  for (const entry of anchors) {
    const wanted = clampToCanvas(toScreen(p, entry.at).y, lo, hi);
    let y = wanted;
    // Walk away from the wanted height in both directions and take the first
    // slot that clears everything already placed.
    for (let nudge = 0; nudge <= p.height; nudge += 2) {
      const down = clampToCanvas(wanted + nudge, lo, hi);
      if (placed.every((other) => Math.abs(other - down) >= TERRAIN_CALLOUT_LINE_PX)) {
        y = down;
        break;
      }
      const up = clampToCanvas(wanted - nudge, lo, hi);
      if (placed.every((other) => Math.abs(other - up) >= TERRAIN_CALLOUT_LINE_PX)) {
        y = up;
        break;
      }
    }
    placed.push(y);
  }

  anchors.forEach((entry, index) => {
    const foot = toScreen(p, entry.at);
    const textY = placed[index]!;

    // The leader stops just clear of the boundary at its own height, not at the
    // edge of the canvas. Running it to the canvas edge is what put these figures
    // under the stats panel and drew a full-width rule across the scope; what the
    // callout has to do is get out of the airspace, and a couple of pixels past
    // the arc is out.
    //
    // The exit x is the boundary's own half-width at this height, so a figure
    // level with the middle of the scope sits further right than one near the
    // caps — the labels follow the curve of the circle, which is what makes them
    // read as belonging to it.
    // On a tall window the airspace is fitted by height and the circle reaches
    // most of the way to the gutter, so a figure level with the widest part of it
    // would sit under the stats block. That block is only the top of the gutter,
    // so the limit is the panel's left edge for a label beside it and the canvas
    // edge for one below.
    const rightLimit =
      textY < STATS_BLOCK_HEIGHT_PX
        ? p.width - STATS_GUTTER_PX - TERRAIN_CALLOUT_MARGIN_PX
        : p.width - TERRAIN_CALLOUT_MARGIN_PX;
    const exitX = clampToCanvas(
      p.cx + boundaryHalfWidthPx(scenario, p, textY) + TERRAIN_CALLOUT_STANDOFF_PX,
      foot.x,
      Math.max(foot.x, rightLimit - TERRAIN_CALLOUT_TEXT_PX),
    );

    ctx.strokeStyle = THEME.terrainCallout;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(foot.x, foot.y);
    ctx.lineTo(exitX, textY);
    ctx.stroke();

    // A dot on the foot, so the leader reads as pointing *at* something rather
    // than merely stopping there.
    ctx.fillStyle = THEME.terrainCallout;
    ctx.beginPath();
    ctx.arc(foot.x, foot.y, 1.5, 0, Math.PI * 2);
    ctx.fill();

    // Left-aligned off the end of the leader, so the figure reads outward from
    // the circle rather than being pinned to a right-hand column.
    ctx.fillStyle = THEME.terrainLabel;
    ctx.textAlign = 'left';
    haloText(ctx, String(entry.levelFt), exitX + TERRAIN_CALLOUT_GAP_PX, textY);
  });

  ctx.restore();
}

const clampToCanvas = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

/**
 * Half the width of the airspace at a given screen height, in pixels.
 *
 * The boundary is a circle cut by two horizontal chords (§3.1), so at a height
 * inside the chords this is the circle's own half-chord there, and at a height
 * outside them the shape has no width at all — a leader aimed past a cap gets the
 * radius, which puts its figure clear of the widest part rather than inside the
 * corner the cap cuts off.
 */
function boundaryHalfWidthPx(scenario: Scenario, p: Projection, screenY: number): number {
  const radiusPx = scenario.airspace.radiusNm * p.pxPerNm;
  const dy = Math.abs(screenY - p.cy);
  if (dy > scenario.airspace.halfHeightNm * p.pxPerNm) return radiusPx;
  return dy >= radiusPx ? 0 : Math.sqrt(radiusPx * radiusPx - dy * dy);
}

/**
 * Clip to the airspace: a circle intersected with a horizontal band (§3.1).
 *
 * Clipped by the canvas rather than by walking the geometry, which is what gets
 * the edge right at the chords as well as the arcs without turning every segment
 * into a boundary intersection. Two clip regions, exactly the two the shape is.
 * The caller owns the surrounding `save`/`restore`.
 */
function clipToAirspace(
  ctx: CanvasRenderingContext2D,
  scenario: Scenario,
  p: Projection,
): void {
  const radiusPx = scenario.airspace.radiusNm * p.pxPerNm;
  ctx.beginPath();
  ctx.arc(p.cx, p.cy, radiusPx, 0, Math.PI * 2);
  ctx.clip();
  const halfHeightPx = scenario.airspace.halfHeightNm * p.pxPerNm;
  ctx.beginPath();
  ctx.rect(p.cx - radiusPx, p.cy - halfHeightPx, radiusPx * 2, halfHeightPx * 2);
  ctx.clip();
}

/**
 * How far inside its band a callout's foot has to sit.
 *
 * Only a 1.5 px dot goes here, so this is about the leader being unambiguous
 * rather than about fitting anything: a quarter-mile inside the edge is already
 * two pixels clear of it at this scale. It is deliberately low enough to keep the
 * *highest* band, whose largest patch clears only 0.41 NM — that band is the one
 * worth pointing at, and a gate tuned to the big escarpment silently dropped it.
 */
const TERRAIN_CALLOUT_FOOT_CLEARANCE_NM = 0.25;

/** Margin from the canvas edge, as the last resort when the boundary is close to it. */
const TERRAIN_CALLOUT_MARGIN_PX = 12;

/** How far past the boundary arc a leader stops. Just clear of it, and no further. */
const TERRAIN_CALLOUT_STANDOFF_PX = 6;

/** Room a four-digit figure needs to the right of a leader's end, plus its gap. */
const TERRAIN_CALLOUT_TEXT_PX = 32;

/** Gap between the end of a leader line and its figure. */
const TERRAIN_CALLOUT_GAP_PX = 6;

/** Vertical room one callout's figure needs, for keeping two off each other. */
const TERRAIN_CALLOUT_LINE_PX = 13;

/**
 * Where to print a ring's altitude: the interior point furthest from any edge,
 * with how far that is.
 *
 * The *pole of inaccessibility*, not the centroid, and not the average of the
 * vertices — which is what this replaced. A terrain ring is long and concave, and
 * for the largest one here the vertex average fell 23 NM outside the polygon
 * altogether, printing the band's altitude out on the boundary arc where it read
 * as a compass tick. An average of points on a curve is not a point in the region
 * the curve encloses, and for these shapes it usually is not.
 *
 * Found by sampling the bounding box and keeping the inside point with the
 * greatest edge distance, optionally restricted to where the fill is actually
 * drawn. Coarse, but this runs once per field into a cached offscreen layer, and
 * the answer only has to be good enough to aim a leader line at.
 *
 * Exported for the test that asserts the spot is actually inside its ring, which
 * is the property the vertex average silently failed.
 */
export function labelSpot(
  ring: readonly Point[],
  isDrawn: (point: Point) => boolean = () => true,
): (Point & { clearanceNm: Nm }) | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of ring) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }
  const step = Math.max(0.15, Math.min(maxX - minX, maxY - minY) / 40);

  let best: (Point & { clearanceNm: Nm }) | null = null;
  for (let x = minX; x <= maxX; x += step)
    for (let y = minY; y <= maxY; y += step) {
      if (!enclosedBy(ring, x, y)) continue;
      // A ring may overhang the boundary, where `mapLayer`'s clip removes the
      // fill — anchoring a callout out there points the leader at bare
      // background. The caller passes the airspace test so this only ever lands
      // where the band is really drawn.
      if (!isDrawn({ x, y })) continue;
      const clearanceNm = distanceToRing(ring, x, y);
      if (best === null || clearanceNm > best.clearanceNm) best = { x, y, clearanceNm };
    }
  return best;
}

/** Whether a closed ring encloses a point — the usual crossing count. */
function enclosedBy(ring: readonly Point[], x: Nm, y: Nm): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Distance from a point to the nearest of a ring's segments. */
function distanceToRing(ring: readonly Point[], x: Nm, y: Nm): Nm {
  let nearest = Infinity;
  for (let i = 1; i < ring.length; i++) {
    const a = ring[i - 1]!;
    const b = ring[i]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    const t = lenSq === 0 ? 0 : clamp01(((x - a.x) * dx + (y - a.y) * dy) / lenSq);
    nearest = Math.min(nearest, Math.hypot(x - a.x - t * dx, y - a.y - t * dy));
  }
  return nearest;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * High ground, as filled bands.
 *
 * The one thing on this layer that is a *fill* rather than a line, and the reason
 * is that it is the only thing which is an area: everything else on the scope is
 * a route, a ring or an aircraft. Lowest band first, each drawn over the one
 * below, so where a higher contour lies inside a lower one the darker fill is
 * simply covered — no holes to punch, and a band whose rings are disjoint from
 * the others (the coastal hills here) comes out the same way.
 *
 * Nonzero winding, and no ring is treated as a hole: every ring in this data
 * encloses ground *above* its level and they all wind the same way, so a band is
 * the union of its rings. A basin would be a ring at a *lower* level lying inside
 * a higher one, which the low-to-high draw order already renders correctly.
 *
 * Each ring carries its own altitude, printed in full feet — but only where the
 * ring is big enough to hold the text clear of its own edges, which here is five
 * of the twenty-six. A 1 sq NM summit has nowhere to put four digits.
 *
 * The figure is the *terrain's*, and it is context rather than a limit: what the
 * controller is held to is `airspace.mvaFt`, one number for the whole field, which
 * `commands.ts` clamps every assignment to. So this says how high the ground is,
 * not how low the player may go — and it is drawn in a dim grey-green rather than
 * the amber a crossing restriction owns, because an amber figure on this scope
 * means someone has to do something about it.
 */
function drawTerrain(ctx: CanvasRenderingContext2D, scenario: Scenario, p: Projection): void {
  if (scenario.terrain.length === 0) return;
  ctx.save();
  clipToAirspace(ctx, scenario, p);

  scenario.terrain.forEach((band, index) => {
    // The ramp is shorter than the number of bands a field might state, so the
    // top colour repeats rather than running off the end of the array.
    ctx.fillStyle = THEME.terrain[Math.min(index, THEME.terrain.length - 1)] ?? THEME.background;
    ctx.beginPath();
    for (const ring of band.rings) {
      ring.forEach((point, i) => {
        const screen = toScreen(p, point);
        if (i === 0) ctx.moveTo(screen.x, screen.y);
        else ctx.lineTo(screen.x, screen.y);
      });
      ctx.closePath();
    }
    ctx.fill();
  });

  ctx.restore();

  // The labels are outside the airspace, so they are drawn after the clip is
  // released rather than inside it.
  drawTerrainCallouts(ctx, scenario, p);
}

/**
 * The coast, clipped to the airspace.
 *
 * A single hairline in a cold blue and nothing else — no fill either side. Land
 * and water are the same thing to this simulator (there is no terrain and no
 * water in the model), so shading one of them would be drawing a fact the scope
 * does not have; the line alone is what a radar display shows and is all the
 * player needs to know where the bay is.
 *
 * Over the terrain fill, because the coast is the harder fact of the two: the
 * shoreline is a line on a chart and a contour is an interpolation.
 */
function drawCoastline(ctx: CanvasRenderingContext2D, scenario: Scenario, p: Projection): void {
  if (scenario.coastline.length === 0) return;
  ctx.save();
  clipToAirspace(ctx, scenario, p);

  ctx.strokeStyle = THEME.coastline;
  ctx.lineWidth = 1;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (const chain of scenario.coastline) {
    chain.forEach((point, index) => {
      const screen = toScreen(p, point);
      if (index === 0) ctx.moveTo(screen.x, screen.y);
      else ctx.lineTo(screen.x, screen.y);
    });
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * The three SIDs (§4.7). Drawn in the departure amber rather than the STARs'
 * blue-grey, because the two chart layers cross and the whole question the
 * player asks of them is "which of these is the one I do not control".
 *
 * And drawn *faint*. The STAR chart is a working reference — the player is
 * flying aircraft along it and reading crossing altitudes off it all session.
 * The SID chart is context: it says where the traffic you cannot instruct is
 * going, which is a thing to notice once and then keep out of. So the whole
 * layer goes down at `SID_ALPHA`, receding behind the STARs where the two
 * cross instead of competing with them.
 *
 * A SID publishes restrictions rather than a profile, so the labels read as
 * restrictions: `≤4000` across the arrival downwind, `13000+` at the exit fix.
 * Past the last fix the track continues to the boundary with an arrowhead —
 * that leg is flown on the exit heading and is the aircraft's way out.
 *
 * **The fix names are not drawn, only the restrictions.** A departure takes no
 * instructions, so its fixes are never spoken to or read back: the only thing
 * the player needs off this layer is where the amber line goes and how low it
 * is kept, and seven names crowding the STAR chart bought neither.
 */
function drawSids(ctx: CanvasRenderingContext2D, scenario: Scenario, p: Projection): void {
  ctx.save();
  ctx.globalAlpha = SID_ALPHA;
  ctx.font = THEME.fontLabel;
  ctx.textBaseline = 'middle';

  // A branching SID compiles to one route per exit, each carrying the shared
  // trunk again. The strokes overdraw identically and are invisible, but the
  // trunk's labels would be painted once per branch — so each fix is labelled
  // the first time it is met and skipped after that.
  const labelled = new Set<string>();

  for (const sid of scenario.sids) {
    const last = sid.waypoints[sid.waypoints.length - 1]!;
    const exit = boundaryExitPoint(scenario, sid);

    ctx.strokeStyle = THEME.sidPath;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    sid.waypoints.forEach((wpt, index) => {
      const point = toScreen(p, wpt.position);
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    const exitPoint = toScreen(p, exit);
    ctx.lineTo(exitPoint.x, exitPoint.y);
    ctx.stroke();
    drawArrowHead(ctx, toScreen(p, last.position), exitPoint);

    let maxAltitudeFt: number | undefined;
    for (const [index, wpt] of sid.waypoints.entries()) {
      // A ceiling republished at the next fix is the *same* restriction carried
      // on (§4.7), so it is labelled only where it changes — otherwise the level
      // segment reads as two separate constraints instead of one that runs
      // through both fixes. Same trick `drawStars` uses for a level leg.
      const crossing =
        wpt.maxAltitudeFt !== undefined && wpt.maxAltitudeFt !== maxAltitudeFt
          ? `≤${wpt.maxAltitudeFt}`
          : wpt.minAltitudeFt !== undefined
            ? `${wpt.minAltitudeFt}+`
            : undefined;
      maxAltitudeFt = wpt.maxAltitudeFt;

      // Index 0 is the runway itself, which is already drawn and labelled.
      if (index === 0) continue;
      if (labelled.has(wpt.name)) continue;
      labelled.add(wpt.name);

      const point = toScreen(p, wpt.position);
      ctx.strokeStyle = THEME.sidFix;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(point.x, point.y, 2.5, 0, Math.PI * 2);
      ctx.stroke();

      // The label goes *above* the fix, away from the track. Every SID fix
      // sits south of or abeam the field, and the STAR labels are placed
      // outward from the airport — which for the two downwind fixes the SIDs
      // pass under is downward, right where a SID label would land. Pushing
      // these the other way keeps the two chart layers apart at the one place
      // they come close, which is also the only place either label matters.
      ctx.textAlign = 'center';
      if (crossing !== undefined) {
        ctx.fillStyle = THEME.sidConstraint;
        haloText(ctx, crossing, point.x, point.y - 10);
      }
    }
  }
  ctx.restore();
}

/**
 * Where a SID's exit leg meets the boundary: the last fix's own outbound track
 * continued until it runs out of airspace, which is the leg the aircraft
 * actually flies once the route is complete.
 */
function boundaryExitPoint(scenario: Scenario, sid: Sid): Point {
  const waypoints = sid.waypoints;
  const last = waypoints[waypoints.length - 1]!;
  const previous = waypoints[waypoints.length - 2]!;
  const courseDeg = bearing(previous.position, last.position);
  const track = headingVector(courseDeg);
  // Step out along the track until the boundary is behind us, then take that
  // point: the shape is not a circle (§3.1), so there is no closed form worth
  // writing for a line drawn once per resize.
  let distNm = 0;
  while (distNm < scenario.airspace.radiusNm * 2) {
    const next = distNm + 0.25;
    const point = { x: last.position.x + track.x * next, y: last.position.y + track.y * next };
    if (!isInsideAirspace(scenario.airspace, point)) break;
    distNm = next;
  }
  return { x: last.position.x + track.x * distNm, y: last.position.y + track.y * distNm };
}

function drawArrowHead(
  ctx: CanvasRenderingContext2D,
  from: { x: number; y: number },
  to: { x: number; y: number },
): void {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const size = 7;
  ctx.fillStyle = THEME.sidPath;
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - size * Math.cos(angle - 0.4), to.y - size * Math.sin(angle - 0.4));
  ctx.lineTo(to.x - size * Math.cos(angle + 0.4), to.y - size * Math.sin(angle + 0.4));
  ctx.closePath();
  ctx.fill();
}

/**
 * The STARs, drawn the way a chart draws them: the track, a tick at each fix, and
 * the published crossing altitude printed where it changes.
 *
 * Labelled **per fix, not per route**, because a fix can be on more than one route
 * and at a real field is: VABB's EMROS is on IGBAN 2A at 8000 and POKON 2A at
 * 11,000, and three routes cross OLGUS at three levels. Drawing each route's label
 * at its own fix printed them all at the same point, on top of each other. So the
 * crossings are collected by fix and stacked, highest first — which is what a chart
 * does at a merge, and which makes the vertical split that keeps the two streams
 * apart the thing you actually see.
 */
function drawStars(ctx: CanvasRenderingContext2D, scenario: Scenario, p: Projection): void {
  ctx.font = THEME.fontLabel;
  ctx.textBaseline = 'middle';

  for (const star of scenario.stars) {
    ctx.strokeStyle = THEME.starPath;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    star.waypoints.forEach((wpt, index) => {
      const point = toScreen(p, wpt.position);
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.stroke();
  }

  const fixes = new Map<string, { position: Point; crossings: number[] }>();
  for (const star of scenario.stars) {
    let previousFt: number | undefined;
    for (const [index, wpt] of star.waypoints.entries()) {
      // Only where the altitude changes, so a long level leg is not labelled twice.
      // The published speeds are deliberately left off: they are flown for the
      // player rather than by them, and a second number per fix cost more
      // legibility than it bought.
      const changed = wpt.altitudeFt !== undefined && wpt.altitudeFt !== previousFt;
      previousFt = wpt.altitudeFt ?? previousFt;
      // Index 0 is the gate, whose own marker carries its name and handover level.
      if (index === 0) continue;
      const entry = fixes.get(wpt.name) ?? { position: wpt.position, crossings: [] };
      if (changed && !entry.crossings.includes(wpt.altitudeFt!)) {
        entry.crossings.push(wpt.altitudeFt!);
      }
      fixes.set(wpt.name, entry);
    }
  }

  for (const [name, { position, crossings }] of fixes) {
    const point = toScreen(p, position);
    ctx.strokeStyle = THEME.starFix;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(point.x, point.y, 2.5, 0, Math.PI * 2);
    ctx.stroke();

    // The block sits on the far side of the fix from the airport, where there is
    // no traffic and nothing else drawn, and is centred on that offset so a fix
    // with three crossings grows both ways rather than downwards into the track.
    const range = magnitude(position);
    const outward = range > 0 ? { x: position.x / range, y: position.y / range } : { x: 0, y: 1 };
    const lx = point.x + outward.x * 9;
    const ly = point.y - outward.y * 9;
    ctx.textAlign = outward.x < -0.2 ? 'right' : outward.x > 0.2 ? 'left' : 'center';

    const lines = 1 + crossings.length;
    let y = ly - ((lines - 1) * LABEL_LINE_PX) / 2;
    ctx.fillStyle = THEME.starLabel;
    haloText(ctx, name, lx, y);
    ctx.fillStyle = THEME.starConstraint;
    for (const crossing of [...crossings].sort((a, b) => b - a)) {
      y += LABEL_LINE_PX;
      haloText(ctx, String(crossing), lx, y);
    }
  }
}

function drawRings(ctx: CanvasRenderingContext2D, scenario: Scenario, p: Projection): void {
  ctx.font = THEME.fontLabel;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (const ring of scenario.airspace.rangeRingsNm) {
    // The outermost ring *is* the boundary, and the boundary is not a circle.
    if (ring >= scenario.airspace.radiusNm) continue;
    ctx.beginPath();
    ctx.arc(p.cx, p.cy, ring * p.pxPerNm, 0, Math.PI * 2);
    ctx.strokeStyle = THEME.ring;
    ctx.lineWidth = 1;
    ctx.stroke();

    // Label each ring below the airport, clear of the centerline — and *under*
    // its own line, since above it the outermost ring now shares a row with the
    // 180° compass label sitting on the southern chord.
    ctx.fillStyle = THEME.ringLabel;
    haloText(ctx, String(ring), p.cx + 12, screenY(p, -ring) + 10);
  }

  drawBoundary(ctx, scenario, p);
}

/** The 50 NM circle with its northern and southern caps cut off (§3.1). */
function drawBoundary(ctx: CanvasRenderingContext2D, scenario: Scenario, p: Projection): void {
  const radiusPx = scenario.airspace.radiusNm * p.pxPerNm;
  const half = scenario.airspace.arcHalfAngleRad;

  ctx.strokeStyle = THEME.ringBright;
  ctx.lineWidth = 1.5;

  // The two surviving arcs, east and west of the cuts.
  for (const centre of [0, Math.PI]) {
    ctx.beginPath();
    ctx.arc(p.cx, p.cy, radiusPx, centre - half, centre + half);
    ctx.stroke();
  }

  // The chords that replaced the caps.
  for (const side of [1, -1]) {
    const y = screenY(p, side * scenario.airspace.halfHeightNm);
    ctx.beginPath();
    ctx.moveTo(screenX(p, -scenario.airspace.chordHalfWidthNm), y);
    ctx.lineTo(screenX(p, scenario.airspace.chordHalfWidthNm), y);
    ctx.stroke();
  }
}

function drawCompassTicks(ctx: CanvasRenderingContext2D, scenario: Scenario, p: Projection): void {
  ctx.strokeStyle = THEME.compassTick;
  ctx.lineWidth = 1;
  ctx.font = THEME.fontLabel;
  ctx.fillStyle = THEME.ringLabel;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (let deg = 0; deg < 360; deg += 10) {
    const v = headingVector(deg);
    // Ride the boundary rather than a circle, so the rose stays on the edge of
    // the shape where the caps have been replaced by chords.
    const outer = boundaryRangeAtBearing(scenario.airspace, deg) * p.pxPerNm;
    const major = deg % 30 === 0;
    const inner = outer - (major ? 12 : 6);
    ctx.beginPath();
    ctx.moveTo(p.cx + v.x * inner, p.cy - v.y * inner);
    ctx.lineTo(p.cx + v.x * outer, p.cy - v.y * outer);
    ctx.stroke();
    // A gate marker owns the edge on its own bearing, and its two lines of label
    // land exactly where the rose's would. The gate is the one carrying
    // information the player needs, so the rose gives way.
    if (major && !scenario.gates.some((gate) => headingDiff(gate.bearingDeg, deg) < 12)) {
      const labelRadius = outer - 24;
      haloText(
        ctx,
        String(deg === 0 ? 360 : deg).padStart(3, '0'),
        p.cx + v.x * labelRadius,
        p.cy - v.y * labelRadius,
      );
    }
  }
}

/** Extended centerline out to 20 NM with a tick every 2 NM (§3.1). */
function drawCenterline(ctx: CanvasRenderingContext2D, scenario: Scenario, p: Projection): void {
  const start = toScreen(p, scenario.runway.threshold);
  const end = toScreen(p, centerlinePoint(scenario.runway, scenario.runway.centerlineLengthNm));

  ctx.strokeStyle = THEME.centerline;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();

  // Ticks perpendicular to the course, longer every 10 NM.
  const perpendicular = headingVector(scenario.runway.courseDeg + 90);
  ctx.strokeStyle = THEME.centerlineTick;
  ctx.font = THEME.fontLabel;
  ctx.fillStyle = THEME.centerlineTick;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (let nm = scenario.runway.centerlineTickNm; nm <= scenario.runway.centerlineLengthNm; nm += scenario.runway.centerlineTickNm) {
    const point = centerlinePoint(scenario.runway, nm);
    const sx = screenX(p, point.x);
    const sy = screenY(p, point.y);
    const major = nm % 10 === 0;
    const half = major ? 8 : 4;
    ctx.lineWidth = major ? 1.5 : 1;
    ctx.beginPath();
    ctx.moveTo(sx + perpendicular.x * half, sy - perpendicular.y * half);
    ctx.lineTo(sx - perpendicular.x * half, sy + perpendicular.y * half);
    ctx.stroke();
    // Clear of the tick and off the course line, on the *left* of the landing
    // direction. Printed beside the line it read as struck through: on a runway
    // that lands east or west the centreline is horizontal, so a label offset
    // along it sat on top of the ticks and the digits ran into them.
    if (major) {
      const offset = half + 10;
      haloText(ctx, String(nm), sx - perpendicular.x * offset, sy + perpendicular.y * offset);
    }
  }
}

/**
 * The runway in use, and any others the field has.
 *
 * The inactive ones go down first, thinner and dimmer, so the strip the whole
 * session is about is the one drawn on top and in the bright colour. They are
 * scenery: nothing in the simulation knows they exist (§3.1 A2).
 */
function drawRunway(ctx: CanvasRenderingContext2D, scenario: Scenario, p: Projection): void {
  ctx.font = THEME.fontLabel;
  ctx.textBaseline = 'middle';
  // Unlabelled, on purpose. Nothing in the simulation knows this strip exists, so
  // its name is never spoken, never assigned and never read back — and at the
  // field it sits within a few pixels of the active runway's own label, which is
  // the one the player is looking for.
  for (const other of scenario.inactiveRunways) {
    const from = toScreen(p, other.ends[0]);
    const to = toScreen(p, other.ends[1]);
    ctx.strokeStyle = THEME.runwayInactive;
    ctx.lineWidth = 2;
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  }

  const threshold = toScreen(p, scenario.runway.threshold);
  const far = toScreen(p, scenario.runway.farEnd);
  ctx.strokeStyle = THEME.runway;
  ctx.lineWidth = 3;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.moveTo(threshold.x, threshold.y);
  ctx.lineTo(far.x, far.y);
  ctx.stroke();

  ctx.font = THEME.fontLabel;
  ctx.fillStyle = THEME.runway;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  haloText(ctx, scenario.runway.id, threshold.x + 8, threshold.y + 2);
}

function drawGates(ctx: CanvasRenderingContext2D, scenario: Scenario, p: Projection): void {
  ctx.font = THEME.fontLabel;
  ctx.textBaseline = 'middle';

  for (const gate of scenario.gates) {
    // Pull the marker 1.5 NM in along its own bearing, so it stays on screen for a
    // gate placed on the boundary and sits on the fix for one placed at a position.
    const inward = headingVector(gate.bearingDeg);
    const radius = Math.max(0, magnitude(gate.position) - 1.5);
    const sx = p.cx + inward.x * radius * p.pxPerNm;
    const sy = p.cy - inward.y * radius * p.pxPerNm;

    ctx.strokeStyle = THEME.gate;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(sx, sy - 5);
    ctx.lineTo(sx + 5, sy);
    ctx.lineTo(sx, sy + 5);
    ctx.lineTo(sx - 5, sy);
    ctx.closePath();
    ctx.stroke();

    ctx.fillStyle = THEME.gateLabel;
    const onLeft = inward.x < 0;
    ctx.textAlign = onLeft ? 'right' : 'left';
    const dx = onLeft ? -10 : 10;
    // Handover altitude in hundreds, the way a flight level reads.
    haloText(ctx, gate.name, sx + dx, sy - 6);
    haloText(ctx, String(Math.round(gate.entryAltitudeFt / 100)), sx + dx, sy + 7);
  }
}
