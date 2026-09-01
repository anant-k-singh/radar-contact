/**
 * Session stats in the scope's top-right gutter (docs §11.2).
 *
 * These used to sit in the sidebar, a long way from where the eye actually is.
 * Drawn on the canvas rather than as DOM so they share the status line's font,
 * colours and DPR handling — and so the gutter they live in is the same number
 * the projection reserved for them.
 */
import { DEPARTURE_QUEUE_ALERT, DEPARTURE_QUEUE_WARN } from '../sim/constants.js';
import type { World } from '../sim/world.js';
import {
  arrivalRatePerHour,
  departureQueueLength,
  departureRatePerHour,
  landingRatePerHour,
} from '../sim/world.js';
import { STATS_GUTTER_PX, type Projection } from './project.js';
import { THEME } from './theme.js';

/** Clear of the status line's baseline, which shares this edge. */
const TOP_PX = 34;
const LINE_HEIGHT = 15;
/** Matches the status line's inset from the right edge. */
const MARGIN_PX = 14;

interface Row {
  label: string;
  value: string;
  /** Amber for something to notice, red for something already broken. */
  tone?: 'warn' | 'bad';
}

function rows(world: World): Row[] {
  const stats = world.stats;
  const rate = landingRatePerHour(world);
  const depRate = departureRatePerHour(world);
  const arrRate = arrivalRatePerHour(world);
  const queued = departureQueueLength(world);
  return [
    // What Center is delivering. Above RATE it means the stack is growing —
    // the arrival half of what DEP QUEUE says for the runway (§8.2).
    { label: 'ARR RATE', value: arrRate === null ? '—' : `${Math.round(arrRate)}/h` },
    { label: 'LANDINGS', value: String(stats.landings) },
    { label: 'RATE', value: rate === null ? '—' : `${Math.round(rate)}/h` },
    // Departures that got away cleanly, and how fast the runway is releasing
    // them. Neither is a score — the player has no authority over a departure —
    // but the rate against the DEP flow in the status line is how you see a
    // tight final starving them (§4.7).
    { label: 'DEPARTURES', value: String(stats.departures) },
    { label: 'DEP RATE', value: depRate === null ? '—' : `${Math.round(depRate)}/h` },
    // The queue holding short. It is the only stat here that is *caused* by the
    // player without being about them: they cannot move a departure, but the
    // gaps they leave on final are what lets one go, so a queue that keeps
    // growing is arrival spacing read from the runway's side (§8.2).
    {
      label: 'DEP QUEUE',
      value: String(queued),
      tone:
        queued > DEPARTURE_QUEUE_ALERT ? 'bad' : queued > DEPARTURE_QUEUE_WARN ? 'warn' : undefined,
    },
    {
      label: 'VIOLATIONS',
      value:
        stats.violations === 0
          ? '0'
          : `${stats.violations} (${Math.round(stats.violationSeconds)}s)`,
      tone: stats.violations > 0 ? 'bad' : undefined,
    },
    {
      label: 'GO-AROUNDS',
      value: String(stats.goArounds),
      tone: stats.goArounds > 0 ? 'warn' : undefined,
    },
    { label: 'EXITS', value: String(stats.exits), tone: stats.exits > 0 ? 'warn' : undefined },
    {
      label: 'TRACK MILES',
      value:
        stats.trackMileSamples > 0
          ? `${(stats.trackMileRatioSum / stats.trackMileSamples).toFixed(2)}×`
          : '—',
    },
  ];
}

function toneColor(tone: Row['tone']): string {
  switch (tone) {
    case 'bad':
      return THEME.violation;
    case 'warn':
      return THEME.logAlert;
    default:
      return THEME.traffic;
  }
}

export function drawStats(ctx: CanvasRenderingContext2D, world: World, p: Projection): void {
  ctx.font = THEME.fontLabel;
  ctx.textBaseline = 'top';

  const right = p.width - MARGIN_PX;
  const left = p.width - STATS_GUTTER_PX + MARGIN_PX;

  rows(world).forEach((row, index) => {
    const y = TOP_PX + index * LINE_HEIGHT;
    // Label left, value right-aligned against the edge: a fixed column of
    // figures, so a number that changed is spotted without reading the label.
    ctx.textAlign = 'left';
    ctx.fillStyle = THEME.ringLabel;
    ctx.fillText(row.label, left, y);

    ctx.textAlign = 'right';
    ctx.fillStyle = toneColor(row.tone);
    ctx.fillText(row.value, right, y);
  });
}
