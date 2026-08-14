/**
 * The static scope furniture: range rings, compass ticks, the runway, the
 * extended centerline with 2 NM markers, and the entry gates.
 *
 * Drawn once to an offscreen canvas and blitted every frame — it only changes
 * when the window is resized.
 */
import { AIRPORT } from '../scenario/airport.js';
import {
  AIRSPACE_RADIUS_NM,
  CENTERLINE_LENGTH_NM,
  CENTERLINE_TICK_NM,
  RANGE_RINGS_NM,
} from '../sim/constants.js';
import { centerlinePoint } from '../sim/ils.js';
import { headingVector } from '../sim/units.js';
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
  drawCenterline(ctx, p);
  drawRunway(ctx, p);
  drawGates(ctx, p);
}

function drawRings(ctx: CanvasRenderingContext2D, p: Projection): void {
  ctx.font = THEME.fontLabel;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (const ring of RANGE_RINGS_NM) {
    const outer = ring === AIRSPACE_RADIUS_NM;
    ctx.beginPath();
    ctx.arc(p.cx, p.cy, ring * p.pxPerNm, 0, Math.PI * 2);
    ctx.strokeStyle = outer ? THEME.ringBright : THEME.ring;
    ctx.lineWidth = outer ? 1.5 : 1;
    ctx.stroke();

    // Label each ring below the airport, clear of the centerline.
    ctx.fillStyle = THEME.ringLabel;
    ctx.fillText(String(ring), p.cx + 12, screenY(p, -ring) - 8);
  }
}

function drawCompassTicks(ctx: CanvasRenderingContext2D, p: Projection): void {
  const outer = AIRSPACE_RADIUS_NM * p.pxPerNm;
  ctx.strokeStyle = THEME.compassTick;
  ctx.lineWidth = 1;
  ctx.font = THEME.fontLabel;
  ctx.fillStyle = THEME.ringLabel;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (let deg = 0; deg < 360; deg += 10) {
    const v = headingVector(deg);
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
    const radius = AIRSPACE_RADIUS_NM - 1.5;
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
