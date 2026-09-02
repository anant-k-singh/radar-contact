/** Readback log along the bottom of the scope, and the status line along the top. */
import { MESSAGE_LOG_SCROLLBACK, MESSAGE_LOG_VISIBLE } from '../sim/constants.js';
import { messagesFor, type MessageKind, type World } from '../sim/world.js';
import type { Projection } from './project.js';
import { THEME } from './theme.js';

const LINE_HEIGHT = 16;
/** Left edge of every line, and of the scroll strip's hit area. */
const LEFT_PX = 14;
/** Width of the wheel-catching strip. The log is text on the scope, so it has
 *  no box of its own to bound — wide enough to wheel over comfortably, and it
 *  stops well short of the right-hand traffic. */
const HIT_WIDTH_PX = 520;

/** Where the log is on screen, so a wheel event can be aimed at it. */
export interface LogArea {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * How far back the log is scrolled, in lines, and the area to wheel over.
 *
 * View state, not session state: it belongs to the scope for the same reason
 * the replay's selection does — a replay frame is rebuilt every redraw and
 * anything written onto the world is thrown away.
 */
export interface LogScroll {
  offset: number;
  area: LogArea | null;
}

export function createLogScroll(): LogScroll {
  return { offset: 0, area: null };
}

/**
 * The furthest back the log will go: whichever is smaller, the scrollback limit
 * or what there is to scroll. Re-derived per frame because both move — a new
 * line arrives, or the selection filter changes how many lines there are.
 */
function maxOffset(total: number): number {
  return Math.max(0, Math.min(total, MESSAGE_LOG_SCROLLBACK) - MESSAGE_LOG_VISIBLE);
}

/** Wheel a line at a time, clamped. A scroll past the newest line sticks to it. */
export function scrollLog(scroll: LogScroll, lines: number, total: number): void {
  scroll.offset = Math.max(0, Math.min(scroll.offset + lines, maxOffset(total)));
}

function colorFor(kind: MessageKind): string {
  switch (kind) {
    case 'pilot':
      return THEME.logPilot;
    case 'alert':
      return THEME.logAlert;
    default:
      return THEME.logSystem;
  }
}

/** Sim time as a clock, so a session reads like a shift. */
export function clockText(timeS: number): string {
  const total = Math.floor(timeS);
  const hours = Math.floor(total / 3600) % 24;
  const minutes = Math.floor(total / 60) % 60;
  const seconds = total % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function drawMessages(
  ctx: CanvasRenderingContext2D,
  world: World,
  p: Projection,
  scroll: LogScroll,
): void {
  const messages = messagesFor(world);
  // Clamped here rather than at the wheel, because the list grows and shrinks
  // under a held offset: a new line would otherwise walk the view backwards.
  scroll.offset = Math.min(scroll.offset, maxOffset(messages.length));
  const end = messages.length - scroll.offset;
  const visible = messages.slice(Math.max(0, end - MESSAGE_LOG_VISIBLE), end);

  ctx.font = THEME.fontLog;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';

  const baseY = p.height - 12;
  visible.forEach((message, index) => {
    const y = baseY - (visible.length - 1 - index) * LINE_HEIGHT;
    ctx.globalAlpha = index === visible.length - 1 ? 1 : 0.55;
    ctx.fillStyle = colorFor(message.kind);
    ctx.fillText(message.text, LEFT_PX, y);
  });
  ctx.globalAlpha = 1;

  const top = baseY - (MESSAGE_LOG_VISIBLE - 1) * LINE_HEIGHT - LINE_HEIGHT;
  scroll.area = { x: 0, y: top, w: HIT_WIDTH_PX, h: p.height - top };
}

export function drawStatusLine(
  ctx: CanvasRenderingContext2D,
  world: World,
  mode: 'live' | 'replay' = 'live',
): void {
  ctx.font = THEME.fontSmall;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = THEME.logSystem;

  const parts = [
    `${world.scenario.icao} RWY ${world.scenario.runway.id} ILS`,
    `ARR ${world.flowPerHour}/h`,
    `DEP ${world.departureFlowPerHour === 0 ? 'off' : `${world.departureFlowPerHour}/h`}`,
    `${clockText(world.timeS)}`,
    `x${world.timeScale}`,
    `TFC ${world.aircraft.length}`,
  ];
  // In replay the rate and the clock belong to the transport rather than to a
  // running session, so the line has to say which it is.
  if (mode === 'replay') parts.push('— REPLAY');
  if (world.paused) parts.push(mode === 'replay' ? '— HELD' : '— PAUSED');
  ctx.fillText(parts.join('   ·   '), 14, 12);
}
