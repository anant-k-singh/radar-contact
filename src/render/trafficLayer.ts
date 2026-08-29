/**
 * Aircraft: history trail, blip, leader line and data block.
 * Data blocks are placed by trying candidate offsets until one does not
 * overlap an already-placed block — cheap, and it matters a lot at 25 aircraft.
 */
import type { WakeCategory } from '../scenario/aircraftTypes.js';
import type { Aircraft } from '../sim/aircraft.js';
import { isDeparture, isDimmed } from '../sim/aircraft.js';
import { TRAIL_LENGTH } from '../sim/constants.js';
import { assignedAltitudeFt, assignedHeadingDeg, isPending } from '../sim/pilot.js';
import { activeFix } from '../sim/star.js';
import { displayHeading, headingDiff, headingVector } from '../sim/units.js';
import type { World } from '../sim/world.js';
import { screenX, screenY, type Projection } from './project.js';
import type { RenderOptions } from './scope.js';
import { THEME } from './theme.js';

const LINE_HEIGHT = 12;
/** Clear of the 16 px selection ring, so the connector starts outside it. */
const CONNECTOR_GAP_PX = 18;
/**
 * History dots on an aircraft that is not selected — half of the `TRAIL_LENGTH`
 * the sim retains, so selecting one doubles the trail it shows.
 */
const TRAIL_DOTS_UNSELECTED = TRAIL_LENGTH / 2;

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

/**
 * Strike a string through with U+0336 COMBINING LONG STROKE OVERLAY.
 *
 * A canvas has no text decoration, and the alternative — measuring the tag and
 * stroking a line over it — would need the data block to know where its own
 * words are. The combining mark travels with the character in the same font at
 * the same size, and measures zero width, so the block lays out unchanged.
 */
const STRIKE = '\u0336';
const struckThrough = (text: string): string =>
  [...text].map((character) => character + STRIKE).join('');

export function stateTag(ac: Aircraft): string {
  if (ac.handedOff) return 'TWR';
  // A departure is never ours, so the tag says whose it is rather than where it
  // is on a route the player cannot change (§4.7).
  if (isDeparture(ac)) return 'DEP';
  // Holding outranks the fix name: the aircraft is circling that fix rather
  // than tracking to it, and that is the thing the controller has to see (§4.6).
  // Struck through once the exit has been instructed — still in the pattern,
  // but leaving at the next crossing of the fix. That is a change to what HOLD
  // *means* rather than a different state, so it stays the same word.
  if (ac.star?.hold) {
    return ac.star.hold.exitRequested ? struckThrough('HOLD') : 'HOLD';
  }
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

/**
 * The block's shade, which an alert deliberately does not touch. The block is
 * read for what the aircraft is *doing*; whether it is selected or handed off
 * has to stay legible while it is in conflict, and recolouring the text as well
 * as the blip only spends the alert hue twice for one piece of information.
 * The blip carries the alert alone (`glyphColor`).
 */
function primaryColor(ac: Aircraft, selected: boolean): string {
  if (selected) return THEME.selected;
  if (isDimmed(ac)) return THEME.handedOff;
  return THEME.traffic;
}

/** The blip's own shade, except when something more urgent has claimed the colour. */
function glyphColor(ac: Aircraft, selected: boolean): string {
  // The blip is the only thing an alert recolours, so it outranks everything.
  if (ac.alert === 'violation') return THEME.violation;
  if (ac.alert === 'warning') return THEME.warning;
  // A go-around outranks the selection here. It is the one state the controller
  // has to notice without being told: the aircraft is off the approach and
  // climbing, and the selection ring already says which one is selected.
  if (ac.phase === 'goAround') return THEME.glyphGoAround;
  if (selected) return THEME.selectedGlyph;
  if (isDimmed(ac)) return THEME.handedOff;
  return THEME.glyph;
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
  // Two lines, not three: altitude and speed are read together — "how low and
  // how fast" is one question — and a shorter block collides with fewer others.
  //
  // The speed here is *ground* speed, not the assigned IAS (§7.3): radar
  // measures the target's motion over the ground, and that is also the number
  // the spacing on final actually runs on. The IAS the instruction sets is in
  // the sidebar for the selected aircraft.
  return [
    tag ? `${ac.callsign} ${tag}` : ac.callsign,
    `${vertical}  ${Math.round(ac.radar.groundSpeedKts)}${ac.type.wake}`,
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

/**
 * Half of a top-down airliner silhouette, nose at −y, in glyph units; the other
 * half is mirrored in x. Swept wings and a tailplane are all it takes to read
 * as an aircraft at 13 px, and the asymmetry front-to-back is what makes the
 * heading legible without a leader line.
 */
const GLYPH_HALF: ReadonlyArray<readonly [number, number]> = [
  [0, -8.0], // nose
  [1.15, -5.6],
  [1.35, -1.3], // wing root, leading edge
  [7.8, 1.7], // wing tip, swept back
  [7.8, 2.5],
  [1.35, 2.1], // wing root, trailing edge
  [1.15, 4.7],
  [3.3, 6.7], // tailplane tip
  [3.3, 7.4],
  [0.85, 7.6], // tail
];
const GLYPH_SCALE = 0.8;
/**
 * Wake category sizes the blip. A heavy really does look different on final —
 * it is the slower, longer-spaced one — so carrying that in the symbol saves
 * reading the `H` off every block while judging a sequence.
 */
const GLYPH_WAKE_SCALE: Record<WakeCategory, number> = { H: 1.2, M: 0.8 };

function drawGlyph(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  headingDeg: number,
  scale: number,
): void {
  ctx.save();
  ctx.translate(sx, sy);
  // The silhouette is drawn nose-up, so rotating by the heading points it the
  // right way: screen y is inverted, which is exactly the sense canvas rotates.
  ctx.rotate((headingDeg * Math.PI) / 180);
  ctx.scale(GLYPH_SCALE * scale, GLYPH_SCALE * scale);

  ctx.beginPath();
  ctx.moveTo(GLYPH_HALF[0]![0], GLYPH_HALF[0]![1]);
  for (const [x, y] of GLYPH_HALF.slice(1)) ctx.lineTo(x, y);
  for (let i = GLYPH_HALF.length - 1; i >= 0; i -= 1) {
    const [x, y] = GLYPH_HALF[i]!;
    ctx.lineTo(-x, y);
  }
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

/**
 * A short line from the blip to the nearest point on its data block. Clamping
 * the blip's position into the rect finds that point for any of the eight
 * candidate placements without knowing which one was chosen, and the line is
 * stopped short at both ends so it neither touches the glyph nor underlines
 * the text.
 */
function drawConnector(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  rect: Rect,
  color: string,
): void {
  const tx = Math.max(rect.x, Math.min(sx, rect.x + rect.w));
  const ty = Math.max(rect.y, Math.min(sy, rect.y + rect.h));
  const dx = tx - sx;
  const dy = ty - sy;
  const len = Math.hypot(dx, dy);
  // Inside the selection ring there is nothing to connect: the block is already
  // touching the blip.
  if (len <= CONNECTOR_GAP_PX + 2) return;
  const ux = dx / len;
  const uy = dy / len;

  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.7;
  ctx.beginPath();
  ctx.moveTo(sx + ux * CONNECTOR_GAP_PX, sy + uy * CONNECTOR_GAP_PX);
  ctx.lineTo(tx - ux * 2, ty - uy * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/** Returns where each data block ended up, so clicks can hit the label as well as the blip. */
export function drawTraffic(
  ctx: CanvasRenderingContext2D,
  world: World,
  p: Projection,
  options: RenderOptions,
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

    // History trail — one dot every HISTORY_PERIOD_S, oldest faintest. The
    // newest is drawn too and simply disappears under the glyph for the moment
    // after it is laid down, which keeps the gap behind the blip even instead
    // of doubling.
    //
    // The selected aircraft shows the whole retained trail; everything else
    // shows the newest TRAIL_DOTS_UNSELECTED of it. Twice the history is worth
    // reading on the one aircraft being worked — where it came from, and
    // whether the turn it is in started before or after the last instruction —
    // and would be clutter drawn on all twenty-five at once.
    //
    // Only for traffic that is ours. The trail exists to be read — where an
    // aircraft has come from and how fast — and reading it is a step towards an
    // instruction. On a departure or an aircraft already with Tower there is no
    // instruction to make, so the dots are clutter over the part of the scope
    // that is busiest with it (§11.1).
    if (!isDimmed(ac)) {
      // Sliced from the end, so the dots that drop off an unselected aircraft
      // are the oldest ones and the trail stays anchored to the blip.
      const trail = selected ? ac.trail : ac.trail.slice(-TRAIL_DOTS_UNSELECTED);
      for (let i = 0; i < trail.length; i += 1) {
        const point = trail[i]!;
        ctx.globalAlpha = 0.2 + (i / trail.length) * 0.45;
        ctx.fillStyle = THEME.trafficDim;
        ctx.beginPath();
        ctx.arc(screenX(p, point.x), screenY(p, point.y), 1.7, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // Violation ring. A warning is already carrying a colour of its own; the
    // ring is held back for the violation so the escalation reads across the
    // scope from the blip alone, without the block having to change with it.
    if (ac.alert === 'violation') {
      ctx.strokeStyle = THEME.violation;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(sx, sy, 13, 0, Math.PI * 2);
      ctx.stroke();
    }

    // One minute of flight at the current ground speed — the length of the
    // leader line, and the scale the heading hint is sized against.
    const minuteNm = ac.radar.groundSpeedKts / 60;
    const leaderPx = minuteNm * p.pxPerNm;

    // Assigned-heading vector, for a few seconds after the instruction: where
    // the nose is going, alongside the green leader line showing where it is.
    const assignedDeg = assignedHeadingDeg(ac);
    const hintLeftS = ac.headingHintUntilS - world.timeS;
    if (options.headingHints && hintLeftS > 0 && !isDimmed(ac)) {
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

    // The leader line answers "where will this be in a minute" — a question
    // only a controller with the authority to change the answer needs, so a
    // replay leaves it off (§17.3).
    if (options.leaderLines) {
      const dir = headingVector(ac.headingDeg);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + dir.x * leaderPx, sy - dir.y * leaderPx);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Blip.
    ctx.fillStyle = glyphColor(ac, selected);
    drawGlyph(ctx, sx, sy, ac.headingDeg, GLYPH_WAKE_SCALE[ac.type.wake]);

    if (selected) {
      ctx.strokeStyle = color;
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

    // Connector, for the selected block only. Which blip a block belongs to is
    // proximity alone, and proximity is exactly what stops answering the
    // question once two blocks crowd each other — so the one block the player
    // is reading says which aircraft it is about rather than implying it.
    if (selected) {
      drawConnector(ctx, sx, sy, rect, color);
    }

    ctx.fillStyle = color;
    lines.forEach((line, index) => {
      ctx.fillText(line, rect.x, rect.y + index * LINE_HEIGHT);
    });

    // Assigned heading, shown only while a turn the player asked for is
    // outstanding — an aircraft turning to follow its STAR was not vectored.
    const vectored = !ac.star || isPending(ac, 'heading');
    const turning = headingDiff(ac.headingDeg, assignedDeg) > 1.5;
    if (turning && vectored && !isDimmed(ac)) {
      ctx.fillStyle = THEME.assigned;
      ctx.fillText(displayHeading(assignedDeg), rect.x + rect.w + 6, rect.y);
    }
  }

  return blocks;
}
