/**
 * Aircraft: history trail, blip, leader line and data block.
 * Data blocks are placed by trying candidate offsets until one does not
 * overlap an already-placed block — cheap, and it matters a lot at 25 aircraft.
 */
import type { Aircraft } from '../sim/aircraft.js';
import { assignedAltitudeFt, assignedHeadingDeg, isPending } from '../sim/pilot.js';
import { activeFix } from '../sim/star.js';
import { displayHeading, headingDiff, headingVector } from '../sim/units.js';
import type { World } from '../sim/world.js';
import { screenX, screenY, type Projection } from './project.js';
import { THEME } from './theme.js';

const LINE_HEIGHT = 13;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const CANDIDATES: ReadonlyArray<{ dx: number; dy: number; align: 'left' | 'right' }> = [
  { dx: 14, dy: -18, align: 'left' },
  { dx: 14, dy: 6, align: 'left' },
  { dx: -14, dy: -18, align: 'right' },
  { dx: -14, dy: 6, align: 'right' },
  { dx: 14, dy: -34, align: 'left' },
  { dx: 14, dy: 22, align: 'left' },
  { dx: -14, dy: -34, align: 'right' },
  { dx: -14, dy: 22, align: 'right' },
];

function stateTag(ac: Aircraft): string {
  if (ac.handedOff) return 'TWR';
  // On the arrival, the fix it is tracking to says more than any state name.
  if (ac.star && ac.phase === 'inbound') return activeFix(ac.star).name;
  switch (ac.phase) {
    case 'cleared':
      return 'ILS';
    case 'loc':
      return 'LOC';
    case 'gs':
      return 'G/S';
    case 'goAround':
      return 'G/A';
    default:
      return '';
  }
}

function primaryColor(ac: Aircraft, selected: boolean): string {
  if (ac.alert === 'violation') return THEME.violation;
  if (ac.alert === 'warning') return THEME.warning;
  if (selected) return THEME.selected;
  if (ac.handedOff) return THEME.handedOff;
  return THEME.traffic;
}

function blockLines(ac: Aircraft): string[] {
  const hundreds = Math.round(ac.radar.altitudeFt / 100);
  const assignedFt = assignedAltitudeFt(ac);
  const target = Math.round(assignedFt / 100);
  let vertical: string;
  if (ac.phase === 'gs') {
    vertical = `${hundreds} G/S`;
  } else if (Math.abs(ac.radar.altitudeFt - assignedFt) < 100) {
    vertical = `${hundreds} =${target}`;
  } else {
    vertical = `${hundreds} ${ac.radar.altitudeFt > assignedFt ? '↓' : '↑'}${target}`;
  }

  const tag = stateTag(ac);
  return [
    tag ? `${ac.callsign} ${tag}` : ac.callsign,
    vertical,
    `${Math.round(ac.radar.iasKts)}${ac.type.wake}`,
  ];
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w + 2 && a.x + a.w + 2 > b.x && a.y < b.y + b.h + 2 && a.y + a.h + 2 > b.y;
}

function placeBlock(
  ctx: CanvasRenderingContext2D,
  bx: number,
  by: number,
  lines: string[],
  placed: Rect[],
  p: Projection,
): Rect {
  const width = Math.max(...lines.map((line) => ctx.measureText(line).width));
  const height = lines.length * LINE_HEIGHT;

  for (const candidate of CANDIDATES) {
    const x = candidate.align === 'left' ? bx + candidate.dx : bx + candidate.dx - width;
    const y = by + candidate.dy;
    const rect: Rect = { x, y, w: width, h: height };
    const onScreen = x > 2 && y > 2 && x + width < p.width - 2 && y + height < p.height - 2;
    if (onScreen && !placed.some((other) => overlaps(rect, other))) return rect;
  }
  // Everything collided — fall back to the first candidate.
  return { x: bx + 14, y: by - 18, w: width, h: height };
}

function drawGlyph(ctx: CanvasRenderingContext2D, sx: number, sy: number, headingDeg: number): void {
  const dir = headingVector(headingDeg);
  const perp = headingVector(headingDeg + 90);
  // Screen y is inverted.
  const fx = dir.x;
  const fy = -dir.y;
  const px = perp.x;
  const py = -perp.y;

  ctx.beginPath();
  ctx.moveTo(sx - fx * 5, sy - fy * 5);
  ctx.lineTo(sx + fx * 6, sy + fy * 6);
  ctx.moveTo(sx - px * 5, sy - py * 5);
  ctx.lineTo(sx + px * 5, sy + py * 5);
  ctx.moveTo(sx - fx * 5 - px * 2.5, sy - fy * 5 - py * 2.5);
  ctx.lineTo(sx - fx * 5 + px * 2.5, sy - fy * 5 + py * 2.5);
  ctx.stroke();
}

/** Returns where each data block ended up, so clicks can hit the label as well as the blip. */
export function drawTraffic(
  ctx: CanvasRenderingContext2D,
  world: World,
  p: Projection,
): Map<number, Rect> {
  const placed: Rect[] = [];
  const blocks = new Map<number, Rect>();
  ctx.lineCap = 'round';

  // Nearest the runway first, so the busiest part of the scope gets first
  // choice of label position.
  const ordered = [...world.aircraft].sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y));

  for (const ac of ordered) {
    const selected = world.selectedId === ac.id;
    const color = primaryColor(ac, selected);
    const sx = screenX(p, ac.x);
    const sy = screenY(p, ac.y);

    // History trail — one dot per radar return, oldest faintest.
    for (let i = 0; i < ac.trail.length - 1; i += 1) {
      const point = ac.trail[i]!;
      ctx.globalAlpha = 0.2 + (i / ac.trail.length) * 0.45;
      ctx.fillStyle = ac.handedOff ? THEME.handedOff : THEME.trafficDim;
      ctx.beginPath();
      ctx.arc(screenX(p, point.x), screenY(p, point.y), 1.7, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Alert halo.
    if (ac.alert !== 'none') {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.arc(sx, sy, 13, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Leader line: one minute of flight at the current ground speed.
    const minuteNm = ac.radar.groundSpeedKts / 60;
    const leaderPx = minuteNm * p.pxPerNm;

    // Assigned-heading vector, for a few seconds after the instruction: where
    // the nose is going, alongside the green leader line showing where it is.
    const assignedDeg = assignedHeadingDeg(ac);
    const hintLeftS = ac.headingHintUntilS - world.timeS;
    if (hintLeftS > 0 && !ac.handedOff) {
      const want = headingVector(assignedDeg);
      // Half again the leader line, and never so short that it hides under the
      // selection ring — this has to read at a glance from across the scope.
      const hintPx = Math.max(leaderPx * 1.5, 60);
      const ex = sx + want.x * hintPx;
      const ey = sy - want.y * hintPx;
      ctx.strokeStyle = THEME.hint;
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.85 * Math.min(1, hintLeftS); // fades out over the last second
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.setLineDash([]);

      // Cap tick across the end, so the target is readable even at a small angle.
      const cross = headingVector(assignedDeg + 90);
      ctx.beginPath();
      ctx.moveTo(ex + cross.x * 4, ey - cross.y * 4);
      ctx.lineTo(ex - cross.x * 4, ey + cross.y * 4);
      ctx.stroke();

      ctx.font = THEME.fontLabel;
      ctx.fillStyle = THEME.hint;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(displayHeading(assignedDeg), ex + want.x * 12, ey - want.y * 12);
      ctx.globalAlpha = 1;
    }

    const dir = headingVector(ac.headingDeg);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + dir.x * leaderPx, sy - dir.y * leaderPx);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Blip.
    ctx.strokeStyle = color;
    ctx.lineWidth = selected ? 2 : 1.4;
    drawGlyph(ctx, sx, sy, ac.headingDeg);

    if (selected) {
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.arc(sx, sy, 16, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Data block.
    ctx.font = THEME.fontBlock;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const lines = blockLines(ac);
    const rect = placeBlock(ctx, sx, sy, lines, placed, p);
    placed.push(rect);
    blocks.set(ac.id, rect);

    ctx.fillStyle = color;
    lines.forEach((line, index) => {
      ctx.fillText(line, rect.x, rect.y + index * LINE_HEIGHT);
    });

    // Assigned heading, shown only while a turn the player asked for is
    // outstanding — an aircraft turning to follow its STAR was not vectored.
    const vectored = !ac.star || isPending(ac, 'heading');
    const turning = headingDiff(ac.headingDeg, assignedDeg) > 1.5;
    if (turning && vectored && !ac.handedOff) {
      ctx.fillStyle = THEME.assigned;
      ctx.fillText(displayHeading(assignedDeg), rect.x + rect.w + 6, rect.y);
    }
  }

  return blocks;
}
