/**
 * Session stats in the scope's top-right gutter (docs §11.2).
 *
 * These used to sit in the sidebar, a long way from where the eye actually is.
 * Drawn on the canvas rather than as DOM so they share the status line's font,
 * colours and DPR handling — and so the gutter they live in is the same number
 * the projection reserved for them.
 */
import type { World } from '../sim/world.js';
import { landingRatePerHour } from '../sim/world.js';
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

/** `AIC 2, QTR 1` — the same tally the sidebar prints. */
function tally(counts: Map<string, number>): string {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([code, count]) => `${code} ${count}`)
    .join(', ');
}

function rows(world: World): Row[] {
  const stats = world.stats;
  const rate = landingRatePerHour(world);
  const missed = tally(stats.missedIntercepts);
  // On final is a live sequence count rather than a session tally, but it is the
  // number looked at most often, so it leads the block instead of sitting alone
  // on the far side of the status line.
  const onFinal = world.aircraft.filter((ac) => ac.phase === 'loc' || ac.phase === 'gs').length;
  return [
    { label: 'ON FINAL', value: String(onFinal) },
    { label: 'LANDINGS', value: String(stats.landings) },
    { label: 'RATE', value: rate === null ? '—' : `${rate.toFixed(1)}/h` },
    // Departures that got away cleanly. Not a score — the player has no
    // authority over them — but it says whether the runway is keeping up (§4.7).
    { label: 'DEPARTURES', value: String(stats.departures) },
    { label: 'HANDED OFF', value: String(stats.handoffs) },
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
    { label: 'REFUSED ILS', value: tally(stats.rejections) || '0' },
    { label: 'MISSED INT', value: missed || '0', tone: missed ? 'warn' : undefined },
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
