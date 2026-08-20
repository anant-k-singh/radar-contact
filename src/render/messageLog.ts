/** Readback log along the bottom of the scope, and the status line along the top. */
import { AIRPORT } from '../scenario/airport.js';
import { MESSAGE_LOG_VISIBLE } from '../sim/constants.js';
import { messagesFor, type MessageKind, type World } from '../sim/world.js';
import type { Projection } from './project.js';
import { THEME } from './theme.js';

const LINE_HEIGHT = 16;

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

export function drawMessages(ctx: CanvasRenderingContext2D, world: World, p: Projection): void {
  const visible = messagesFor(world).slice(-MESSAGE_LOG_VISIBLE);
  ctx.font = THEME.fontLog;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';

  const baseY = p.height - 12;
  visible.forEach((message, index) => {
    const y = baseY - (visible.length - 1 - index) * LINE_HEIGHT;
    ctx.globalAlpha = index === visible.length - 1 ? 1 : 0.55;
    ctx.fillStyle = colorFor(message.kind);
    ctx.fillText(message.text, 14, y);
  });
  ctx.globalAlpha = 1;
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
    `${AIRPORT.icao} RWY ${AIRPORT.runway.id} ILS`,
    `FLOW ${world.flowPerHour}/h`,
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
