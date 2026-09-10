/**
 * The static scope furniture: range rings, compass ticks, the runway, the
 * extended centerline with 2 NM markers, and the entry gates.
 *
 * Drawn once to an offscreen canvas and blitted every frame — it only changes
 * when the window is resized.
 */
import { boundaryRangeAtBearing, isInsideAirspace } from '../scenario/airspace.js';
import type { Scenario, Sid, SidWaypoint } from '../scenario/types.js';
import { centerlinePoint } from '../sim/ils.js';
import {
  bearing,
  headingDiff,
  headingVector,
  magnitude,
  normalizeHeading,
  toRad,
  type Deg,
  type Point,
} from '../sim/units.js';
import { clipped, nested, unclipped } from './clip.js';
import { baseOrigin, screenX, screenY, toScreen, type Projection } from './project.js';
import { terrainRamp, THEME } from './theme.js';

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
export function haloText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
): void {
  // Unclipped, always: this is the chokepoint every label on the layer goes
  // through, so routing it here is what makes "the clip never cuts a label" a
  // property of the code rather than of remembering (see `clip.ts`).
  unclipped(ctx, () => {
    ctx.save();
    ctx.strokeStyle = THEME.background;
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.strokeText(text, x, y);
    ctx.restore();
    ctx.fillText(text, x, y);
  });
}

/**
 * Whether the scope is at its fitted size. Pan cannot happen without zoom — the
 * pinch is the only gesture — so the scale is the whole test.
 */
const atRest = (p: Projection): boolean => p.pxPerNm === p.base.pxPerNm;

/**
 * Two entries, and the reason is the zoom.
 *
 * The resting 1x layer is the one the scope spends nearly all its time drawing, so
 * it is kept in its own slot: a single entry would be evicted by the first frame of
 * a pinch and rebuilt on the way back out, which is the one redraw the player would
 * actually notice. The other slot holds whatever zoom the gesture is currently at.
 * VABB's chart costs a few ms to redraw, so a pinch stays inside frame budget, but
 * there is no reason to pay it for going home.
 */
let restCache: { key: string; canvas: HTMLCanvasElement } | null = null;
let zoomCache: { key: string; canvas: HTMLCanvasElement } | null = null;

export function mapLayer(
  scenario: Scenario,
  projection: Projection,
  dpr: number,
): HTMLCanvasElement {
  // Keyed by the field as well as the canvas: the chart is what this layer draws,
  // so a different field is a different layer even at the same size.
  // The viewport is in the key: zoom and pan change what this layer draws, so a
  // pinch redraws it per frame and then hits cache again the moment it settles.
  const key =
    `${scenario.id}|${projection.width}x${projection.height}@${dpr}` +
    `|${projection.pxPerNm}|${projection.cx},${projection.cy}`;
  const rest = atRest(projection);
  const cache = rest ? restCache : zoomCache;
  if (cache && cache.key === key) return cache.canvas;

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(projection.width * dpr));
  canvas.height = Math.max(1, Math.round(projection.height * dpr));
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(ctx, scenario, projection);
  }
  if (rest) restCache = { key, canvas };
  else zoomCache = { key, canvas };
  return canvas;
}

export function draw(ctx: CanvasRenderingContext2D, scenario: Scenario, p: Projection): void {
  ctx.fillStyle = THEME.background;
  ctx.fillRect(0, 0, p.width, p.height);

  // Everything that lives *in* the airspace is drawn zoomed and clipped to the
  // fixed circle, so magnifying the content cannot spill it across the scope.
  clipped(ctx, (c) => clipToAirspace(c, scenario, p), () => {
    // Under everything, in the order the ground itself is layered: high ground
    // shaded, then the coast drawn on top of it.
    drawTerrain(ctx, scenario, p);
    drawCoastline(ctx, scenario, p);
    drawRings(ctx, scenario, p);
    drawCompassTicks(ctx, scenario, p);
    drawStars(ctx, scenario, p);
    // After the STARs, so where a SID passes under one the departure track is
    // the line drawn on top — which carries the restriction that matters.
    drawSids(ctx, scenario, p);
    drawCenterline(ctx, scenario, p);
    drawRunway(ctx, scenario, p);
  });

  // The boundary itself is the frame, not content: it is drawn from the base
  // frame at its fitted size and does not move. Drawn last so the clipped
  // content inside meets a clean edge.
  drawBoundary(ctx, scenario, p);
  // A gate sits *on* the boundary and its label is offset outward from the
  // marker, so it lands outside the circle the content is clipped to. Drawn with
  // the boundary, after the clip is released, or the diamond appears with its
  // name and handover level shaved off. At rest only — see `drawGates`.
  drawGates(ctx, scenario, p);
}

/**
 * Clip to the airspace: a circle intersected with a horizontal band (§3.1).
 *
 * Clipped by the canvas rather than by walking the geometry, which is what gets
 * the edge right at the chords as well as the arcs without turning every segment
 * into a boundary intersection. Two clip regions, exactly the two the shape is.
 * The caller owns the surrounding `save`/`restore`.
 */
export function clipToAirspace(
  ctx: CanvasRenderingContext2D,
  scenario: Scenario,
  p: Projection,
): void {
  // The *base* frame throughout: the shape is the window the content is zoomed
  // inside, so it keeps its fitted size and position at every zoom. Measured
  // from where the airport is on the canvas, which is the middle of it only at a
  // field whose airspace is centred on itself.
  const origin = baseOrigin(p);
  const radiusPx = scenario.airspace.radiusNm * p.base.pxPerNm;
  const shape = scenario.airspace.shape;
  if (shape.kind === 'sector') {
    // One path, not two: a wedge is a single region — out along one radial,
    // round the outer arc, back down the other and home along the inner one —
    // so there is nothing to intersect and `canvasAngle` does the whole job of
    // turning a compass bearing into the direction a canvas arc sweeps.
    const innerPx = shape.innerNm * p.base.pxPerNm;
    const { from, to } = sectorAngles(shape.fromDeg, shape.toDeg);
    ctx.beginPath();
    ctx.arc(origin.x, origin.y, radiusPx, from, to);
    ctx.arc(origin.x, origin.y, innerPx, to, from, true);
    ctx.closePath();
    ctx.clip();
    return;
  }
  ctx.beginPath();
  ctx.arc(origin.x, origin.y, radiusPx, 0, Math.PI * 2);
  ctx.clip();
  const halfHeightPx = scenario.airspace.halfHeightNm * p.base.pxPerNm;
  ctx.beginPath();
  ctx.rect(origin.x - radiusPx, origin.y - halfHeightPx, radiusPx * 2, halfHeightPx * 2);
  ctx.clip();
}

/**
 * A compass bearing as a canvas arc angle.
 *
 * A bearing is clockwise from north with y *up*; a canvas angle is from due east
 * with y *down*. Screen-space north is therefore −y, which is canvas angle −90°,
 * and the two clockwises agree once that flip is made — so the offset is
 * `bearing − 90` and an increasing bearing is an increasing canvas angle. It is
 * `bearing − 90` and not `90 − bearing`: the latter is the same at due east and
 * mirrored everywhere else, which draws a southern sector in the north.
 */
function canvasAngle(bearingDeg: Deg): number {
  return toRad(bearingDeg - 90);
}

/**
 * The two ends of a wedge as canvas angles, with the far end wound forward past
 * the near one so an arc between them always sweeps the *short* way round the
 * compass — including a sector that straddles north, where the raw bearings run
 * backwards (300° to 060° is 120° clockwise, not 240° anticlockwise).
 */
function sectorAngles(fromDeg: Deg, toDeg: Deg): { from: number; to: number } {
  const from = canvasAngle(fromDeg);
  return { from, to: from + toRad(normalizeHeading(toDeg - fromDeg)) };
}

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
 * Nonzero winding, so a ring wound the other way is a **hole** and the band below
 * shows through it — a basin inside a massif. Most rings are not holes: they
 * enclose ground above their level and wind the same way, making a band the union
 * of its rings. `msaAt` reads the same rule, and has to, or the figure under the
 * cursor contradicts the shading beneath it.
 *
 * **Nothing here is labelled.** A band's level is read at the pointer instead
 * (`MSA @ pointer`), which is what fourteen bands over most of the scope made
 * necessary: figures stacked in the margin say which levels exist without saying
 * where any of them is, leaving the reader matching a shade against a legend.
 *
 * The shading is context rather than a limit either way: what the controller is
 * held to is `airspace.mvaFt`, one number for the whole field, which `commands.ts`
 * clamps every assignment to. So this says how high the ground is, not how low the
 * player may go — and it is drawn in a dim grey-green rather than the amber a
 * crossing restriction owns, because amber on this scope means someone has to do
 * something about it.
 */
function drawTerrain(ctx: CanvasRenderingContext2D, scenario: Scenario, p: Projection): void {
  if (scenario.terrain.length === 0) return;
  ctx.save();

  // Built for this field's band count, so the whole contrast range is used
  // whatever that count is. A fixed four-colour ramp painted eleven of LSGG's
  // fourteen bands the same shade — everything from 7000 up was one flat mass,
  // because the array ran out and the top colour repeated.
  const ramp = terrainRamp(scenario.terrain.length);

  scenario.terrain.forEach((band, index) => {
    ctx.fillStyle = ramp[index] ?? THEME.background;
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
  // No clip of its own: `draw` already clips the whole content group to exactly
  // this region.
  ctx.save();
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
  // `nested` rather than a bare `save`, so a label lifting the clip knows how far
  // to unwind — see `clip.ts`. A raw pair here is what kept the SID tops clipped.
  nested(ctx, () => drawSidChart(ctx, scenario, p));
}

function drawSidChart(ctx: CanvasRenderingContext2D, scenario: Scenario, p: Projection): void {
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

    // Rings only — no figures, no names. Levels are read by hovering
    // (`sidHover.ts`). The thinning rule that used to live here left them partly
    // readable with the split invisible, which is what hovering answers.
    for (const { index, wpt } of sidFixLabels(sid)) {
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
    }
  }
}

/**
 * What each fix on a SID publishes, as a label string. A ceiling only where it
 * *changes* — republished at the next fix it is the same restriction (§4.7).
 * Drawn by `sidHover.ts`; lives here because `drawSidChart` walks the same fixes.
 */
export interface SidFixLabel {
  index: number;
  wpt: SidWaypoint;
  /** The figure to print, or undefined where the fix publishes nothing. */
  crossing: string | undefined;
}

export function sidFixLabels(sid: Sid): SidFixLabel[] {
  const out: SidFixLabel[] = [];
  let maxAltitudeFt: number | undefined;
  for (const [index, wpt] of sid.waypoints.entries()) {
    const crossing =
      wpt.maxAltitudeFt !== undefined && wpt.maxAltitudeFt !== maxAltitudeFt
        ? `≤${wpt.maxAltitudeFt}`
        : wpt.minAltitudeFt !== undefined
          ? `${wpt.minAltitudeFt}+`
          : undefined;
    maxAltitudeFt = wpt.maxAltitudeFt;
    out.push({ index, wpt, crossing });
  }
  return out;
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
}

/**
 * The same projection with the zoom taken back out, for drawing the scope's own
 * fixed furniture. Cheaper to read than threading `.base` through every `p.cx`,
 * and it means a furniture routine can go on using `screenX`/`screenY`.
 */
function atBaseFrame(p: Projection): Projection {
  return { ...p, ...p.base };
}

/**
 * The airspace edge: a circle with its caps cut off (§3.1), or a sector's wedge.
 */
function drawBoundary(ctx: CanvasRenderingContext2D, scenario: Scenario, zoomed: Projection): void {
  // The boundary is the scope's own shape rather than content inside it, so the
  // whole of it is drawn in the unzoomed frame — arcs, chords and all.
  const p = atBaseFrame(zoomed);
  const origin = baseOrigin(zoomed);
  const radiusPx = scenario.airspace.radiusNm * p.pxPerNm;
  const half = scenario.airspace.arcHalfAngleRad;

  ctx.strokeStyle = THEME.ringBright;
  ctx.lineWidth = 1.5;

  const shape = scenario.airspace.shape;
  if (shape.kind === 'sector') {
    const innerPx = shape.innerNm * p.pxPerNm;
    const { from, to } = sectorAngles(shape.fromDeg, shape.toDeg);
    ctx.beginPath();
    ctx.arc(origin.x, origin.y, radiusPx, from, to);
    ctx.arc(origin.x, origin.y, innerPx, to, from, true);
    ctx.closePath();
    ctx.stroke();
    return;
  }

  // The two surviving arcs, east and west of the cuts.
  for (const centre of [0, Math.PI]) {
    ctx.beginPath();
    ctx.arc(origin.x, origin.y, radiusPx, centre - half, centre + half);
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

/**
 * The entry gates — drawn at rest only, and that is the whole of the rule.
 *
 * A gate marks where a route crosses the boundary, so it has to sit on both: on
 * the circle, and on the end of the STAR it belongs to. Zoom separates the two,
 * because the boundary is fixed furniture while the route magnifies inside it, and
 * there is no frame in which the marker is still telling the truth. Drawn in the
 * base frame it drifts off its own route; drawn zoomed it leaves the circle and
 * lands over the stats gutter at 2x. So it is withheld, the way the leader line is
 * in replay — the label offset that puts it outside the clip is exactly why it
 * cannot simply be clipped away instead.
 */
function drawGates(ctx: CanvasRenderingContext2D, scenario: Scenario, p: Projection): void {
  if (!atRest(p)) return;
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
