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
import { bearing, distance, headingVector, magnitude, type Point } from '../sim/units.js';
import { screenX, screenY, toScreen, type Projection } from './project.js';
import { THEME } from './theme.js';

/**
 * How far the SID chart sits behind the STAR chart. Low enough that a departure
 * route reads as background the moment the eye is looking for an arrival one,
 * high enough that following one across the scope is still easy.
 */
const SID_ALPHA = 0.55;

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

      // Labels go *above* the fix, stacked away from the track. Every SID fix
      // sits south of or abeam the field, and the STAR labels are placed
      // outward from the airport — which for the two downwind fixes the SIDs
      // pass under is downward, right where a SID label would land. Pushing
      // these the other way keeps the two chart layers apart at the one place
      // they come close, which is also the only place either label matters.
      ctx.textAlign = 'center';
      ctx.fillStyle = THEME.sidLabel;
      ctx.fillText(wpt.name, point.x, point.y - 10);
      if (crossing !== undefined) {
        ctx.fillStyle = THEME.sidConstraint;
        ctx.fillText(crossing, point.x, point.y - 22);
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
 * The four STARs, drawn the way a chart draws them: the track, a tick at each
 * fix, and the published crossing altitude and speed printed where they change.
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

    let altitudeFt: number | undefined;
    for (const [index, wpt] of star.waypoints.entries()) {
      // Only the altitude, and only where it changes, so a long level leg is
      // not labelled twice. The published speeds are deliberately left off the
      // chart: they are flown for the player rather than by them, and a second
      // number per fix cost more legibility than it bought.
      const crossing =
        wpt.altitudeFt !== undefined && wpt.altitudeFt !== altitudeFt
          ? String(wpt.altitudeFt)
          : undefined;
      altitudeFt = wpt.altitudeFt ?? altitudeFt;

      // The gate marker already carries its own name and altitude.
      if (index === 0) continue;

      const point = toScreen(p, wpt.position);
      ctx.strokeStyle = THEME.starFix;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(point.x, point.y, 2.5, 0, Math.PI * 2);
      ctx.stroke();

      // Labels sit on the far side of the fix from the airport, where there is
      // no traffic and nothing else drawn.
      const range = magnitude(wpt.position);
      const outward = range > 0 ? { x: wpt.position.x / range, y: wpt.position.y / range } : { x: 0, y: 1 };
      const lx = point.x + outward.x * 9;
      const ly = point.y - outward.y * 9;
      ctx.textAlign = outward.x < -0.2 ? 'right' : outward.x > 0.2 ? 'left' : 'center';

      ctx.fillStyle = THEME.starLabel;
      ctx.fillText(wpt.name, lx, ly - (crossing !== undefined ? 6 : 0));
      if (crossing !== undefined) {
        ctx.fillStyle = THEME.starConstraint;
        ctx.fillText(crossing, lx, ly + 6);
      }
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
    ctx.fillText(String(ring), p.cx + 12, screenY(p, -ring) + 10);
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
    if (major) {
      const labelRadius = outer - 24;
      ctx.fillText(
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
  ctx.textAlign = 'left';
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
    if (major) ctx.fillText(String(nm), sx + 12, sy);
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
  for (const other of scenario.inactiveRunways) {
    const from = toScreen(p, other.ends[0]);
    const to = toScreen(p, other.ends[1]);
    ctx.strokeStyle = THEME.runwayInactive;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();

    // Labelled at the end furthest from the active threshold, so the two names
    // do not land on top of each other on a crossing pair.
    const away =
      distance(other.ends[0], scenario.runway.threshold) >
      distance(other.ends[1], scenario.runway.threshold)
        ? from
        : to;
    ctx.fillStyle = THEME.runwayInactive;
    ctx.textAlign = 'center';
    ctx.fillText(other.id, away.x, away.y - 9);
  }

  const threshold = toScreen(p, scenario.runway.threshold);
  const far = toScreen(p, scenario.runway.farEnd);
  ctx.strokeStyle = THEME.runway;
  ctx.lineWidth = 4;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.moveTo(threshold.x, threshold.y);
  ctx.lineTo(far.x, far.y);
  ctx.stroke();

  ctx.font = THEME.fontLabel;
  ctx.fillStyle = THEME.runway;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(scenario.runway.id, threshold.x + 8, threshold.y + 2);
}

function drawGates(ctx: CanvasRenderingContext2D, scenario: Scenario, p: Projection): void {
  ctx.font = THEME.fontLabel;
  ctx.textBaseline = 'middle';

  for (const gate of scenario.gates) {
    // Pull the marker just inside the boundary so it stays on screen.
    const inward = headingVector(gate.bearingDeg);
    const radius = boundaryRangeAtBearing(scenario.airspace, gate.bearingDeg) - 1.5;
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
    ctx.fillText(gate.name, sx + dx, sy - 6);
    ctx.fillText(String(Math.round(gate.entryAltitudeFt / 100)), sx + dx, sy + 7);
  }
}
