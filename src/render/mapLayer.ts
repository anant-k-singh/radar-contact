/**
 * The static scope furniture: range rings, compass ticks, the runway, the
 * extended centerline with 2 NM markers, and the entry gates.
 *
 * Drawn once to an offscreen canvas and blitted every frame — it only changes
 * when the window is resized.
 */
import { AIRPORT } from '../scenario/airport.js';
import { STARS } from '../scenario/stars.js';
import {
  AIRSPACE_ARC_HALF_ANGLE_RAD,
  AIRSPACE_CHORD_HALF_WIDTH_NM,
  boundaryRangeAtBearing,
} from '../sim/airspace.js';
import {
  AIRSPACE_HALF_HEIGHT_NM,
  AIRSPACE_RADIUS_NM,
  CENTERLINE_LENGTH_NM,
  CENTERLINE_TICK_NM,
  RANGE_RINGS_NM,
} from '../sim/constants.js';
import { centerlinePoint } from '../sim/ils.js';
import { headingVector, magnitude } from '../sim/units.js';
import { screenX, screenY, toScreen, type Projection } from './project.js';
import { THEME } from './theme.js';

let cache: { key: string; canvas: HTMLCanvasElement } | null = null;

export function mapLayer(projection: Projection, dpr: number): HTMLCanvasElement {
  const key = `${projection.width}x${projection.height}@${dpr}`;
  if (cache && cache.key === key) return cache.canvas;

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(projection.width * dpr));
  canvas.height = Math.max(1, Math.round(projection.height * dpr));
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(ctx, projection);
  }
  cache = { key, canvas };
  return canvas;
}

function draw(ctx: CanvasRenderingContext2D, p: Projection): void {
  ctx.fillStyle = THEME.background;
  ctx.fillRect(0, 0, p.width, p.height);

  drawRings(ctx, p);
  drawCompassTicks(ctx, p);
  drawStars(ctx, p);
  drawCenterline(ctx, p);
  drawRunway(ctx, p);
  drawGates(ctx, p);
}

/**
 * The four STARs, drawn the way a chart draws them: the track, a tick at each
 * fix, and the published crossing altitude and speed printed where they change.
 */
function drawStars(ctx: CanvasRenderingContext2D, p: Projection): void {
  ctx.font = THEME.fontLabel;
  ctx.textBaseline = 'middle';

  for (const star of STARS) {
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
    let speedKts: number | undefined;
    for (const [index, wpt] of star.waypoints.entries()) {
      // Only what changes at this fix, so a long level leg is not labelled twice.
      const parts: string[] = [];
      if (wpt.altitudeFt !== undefined && wpt.altitudeFt !== altitudeFt) {
        parts.push(String(wpt.altitudeFt));
      }
      if (wpt.speedKts !== undefined && wpt.speedKts !== speedKts) parts.push(`${wpt.speedKts}K`);
      altitudeFt = wpt.altitudeFt ?? altitudeFt;
      speedKts = wpt.speedKts ?? speedKts;

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
      ctx.fillText(wpt.name, lx, ly - (parts.length > 0 ? 6 : 0));
      if (parts.length > 0) {
        ctx.fillStyle = THEME.starConstraint;
        ctx.fillText(parts.join(' · '), lx, ly + 6);
      }
    }
  }
}

function drawRings(ctx: CanvasRenderingContext2D, p: Projection): void {
  ctx.font = THEME.fontLabel;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (const ring of RANGE_RINGS_NM) {
    // The outermost ring *is* the boundary, and the boundary is not a circle.
    if (ring >= AIRSPACE_RADIUS_NM) continue;
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

  drawBoundary(ctx, p);
}

/** The 50 NM circle with its northern and southern caps cut off (§3.1). */
function drawBoundary(ctx: CanvasRenderingContext2D, p: Projection): void {
  const radiusPx = AIRSPACE_RADIUS_NM * p.pxPerNm;
  const half = AIRSPACE_ARC_HALF_ANGLE_RAD;

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
    const y = screenY(p, side * AIRSPACE_HALF_HEIGHT_NM);
    ctx.beginPath();
    ctx.moveTo(screenX(p, -AIRSPACE_CHORD_HALF_WIDTH_NM), y);
    ctx.lineTo(screenX(p, AIRSPACE_CHORD_HALF_WIDTH_NM), y);
    ctx.stroke();
  }
}

function drawCompassTicks(ctx: CanvasRenderingContext2D, p: Projection): void {
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
    const outer = boundaryRangeAtBearing(deg) * p.pxPerNm;
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
function drawCenterline(ctx: CanvasRenderingContext2D, p: Projection): void {
  const start = toScreen(p, AIRPORT.runway.threshold);
  const end = toScreen(p, centerlinePoint(CENTERLINE_LENGTH_NM));

  ctx.strokeStyle = THEME.centerline;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();

  // Ticks perpendicular to the course, longer every 10 NM.
  const perpendicular = headingVector(AIRPORT.runway.courseDeg + 90);
  ctx.strokeStyle = THEME.centerlineTick;
  ctx.font = THEME.fontLabel;
  ctx.fillStyle = THEME.centerlineTick;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  for (let nm = CENTERLINE_TICK_NM; nm <= CENTERLINE_LENGTH_NM; nm += CENTERLINE_TICK_NM) {
    const point = centerlinePoint(nm);
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

function drawRunway(ctx: CanvasRenderingContext2D, p: Projection): void {
  const threshold = toScreen(p, AIRPORT.runway.threshold);
  const far = toScreen(p, AIRPORT.runway.farEnd);
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
  ctx.fillText(AIRPORT.runway.id, threshold.x + 8, threshold.y + 2);
}

function drawGates(ctx: CanvasRenderingContext2D, p: Projection): void {
  ctx.font = THEME.fontLabel;
  ctx.textBaseline = 'middle';

  for (const gate of AIRPORT.gates) {
    // Pull the marker just inside the boundary so it stays on screen.
    const inward = headingVector(gate.bearingDeg);
    const radius = boundaryRangeAtBearing(gate.bearingDeg) - 1.5;
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
