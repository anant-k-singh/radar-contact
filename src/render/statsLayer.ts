/**
 * Session stats in the scope's top-right gutter (docs §11.2).
 *
 * These used to sit in the sidebar, a long way from where the eye actually is.
 * Drawn on the canvas rather than as DOM so they share the status line's font,
 * colours and DPR handling — and so the gutter they live in is the same number
 * the projection reserved for them.
 */
import { DEPARTURE_QUEUE_ALERT, DEPARTURE_QUEUE_WARN } from '../sim/constants.js';
import { deliveryWindows } from '../sim/delivery.js';
import type { World } from '../sim/world.js';
import {
  arrivalRatePerHour,
  sinkRatePerHour,
  departureQueueLength,
  departureRatePerHour,
  deliveryRatePerHour,
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

/**
 * The rows every position wants: what went wrong, and how efficiently.
 *
 * Shared rather than repeated because these three are the only statistics that
 * mean the same thing at both positions — a violation is a violation, an exit is
 * an aircraft lost off the edge, and the track-mile ratio is how much extra
 * flying the sequence cost. Everything above them is the job.
 */
function commonRows(world: World): Row[] {
  const stats = world.stats;
  const source = arrivalRatePerHour(world);
  const sink = sinkRatePerHour(world);
  return [
    {
      label: 'VIOLATIONS',
      value:
        stats.violations === 0
          ? '0'
          : `${stats.violations} (${Math.round(stats.violationSeconds)}s)`,
      tone: stats.violations > 0 ? 'bad' : undefined,
    },
    // What the airspace is taking in against what it is getting rid of, in the
    // same units, for both roles (§8.2). Neither is a score — the source is the
    // flow the player asked for and the sink is mostly the field's — but source
    // standing above sink is the airspace filling up, which is the one thing
    // about a session no single counter says.
    { label: 'SOURCE', value: source === null ? '—' : `${Math.round(source)}/h` },
    { label: 'SINK', value: sink === null ? '—' : `${Math.round(sink)}/h` },
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

/**
 * An en-route sector's scoreboard: what it handed on, and whether the receiving
 * controller got what was agreed (§8.3).
 *
 * `SECTOR /h` is the agreement, because the agreement is the sector's — and it is
 * free, since at a center field the sink rate *is* the delivery rate, nothing
 * having landed. It carries the amber: a rate over the total is the one direction
 * that costs the field below something, and the long window's cap is what "over"
 * actually means now that no tolerance is left to borrow from.
 *
 * The per-gate rows stay underneath it, reading achieved against the share each
 * was derived from, because a pooled figure alone would let a sector hide a
 * starved stream behind a flooded one. They carry no tone: a gate running above
 * its share while the sector total holds is the case this model exists to allow,
 * and amber there would contradict it on screen.
 */
function sectorRow(world: World): Row {
  const agreed = world.scenario.agreedRatePerHour;
  const achieved = sinkRatePerHour(world);
  // The strict window's own ceiling — 7 in twelve minutes is 35 an hour against
  // VABBA's 31 — rather than a fraction over the mean. It is the rate the grader
  // will actually refuse, so the amber and the faults agree.
  const strictest = deliveryWindows(agreed).at(-1)!;
  const ceilingPerHour = (strictest.cap * 3600) / strictest.windowS;
  return {
    label: 'SECTOR /h',
    value: `${achieved === null ? '—' : Math.round(achieved)}/${agreed}`,
    tone: achieved !== null && achieved > ceilingPerHour ? 'warn' : undefined,
  };
}

function centerRows(world: World, msaFt: number | null): Row[] {
  const stats = world.stats;
  const fault = (kind: string): number => stats.deliveryFaults.get(kind) ?? 0;
  const crossing = fault('level') + fault('speed');
  return [
    { label: 'MSA @ pointer', value: msaFt === null ? '—' : String(msaFt) },
    { label: 'DELIVERED', value: String(stats.deliveries) },
    sectorRow(world),
    ...world.scenario.delivery.map((gate): Row => {
      const achieved = deliveryRatePerHour(world, gate.fixName);
      return {
        // `/h` in the label rather than the value, so the two figures stay a
        // clean achieved-against-agreed pair in the right-hand column: `13/15`
        // is a comparison, and `13/15/h` reads as a third number.
        label: `${gate.fixName} /h`,
        value: `${achieved === null ? '—' : Math.round(achieved)}/${gate.targetRatePerHour}`,
      };
    }),
    { label: 'TOO CLOSE', value: String(fault('early')), tone: fault('early') > 0 ? 'bad' : undefined },
    {
      label: 'UNSEQUENCED',
      value: String(fault('unsequenced')),
      tone: fault('unsequenced') > 0 ? 'bad' : undefined,
    },
    { label: 'OFF CROSSING', value: String(crossing), tone: crossing > 0 ? 'warn' : undefined },
    ...commonRows(world),
  ];
}

function approachRows(world: World, msaFt: number | null): Row[] {
  const stats = world.stats;
  const rate = landingRatePerHour(world);
  const depRate = departureRatePerHour(world);
  const queued = departureQueueLength(world);
  return [
    // The ground under the cursor, and the only row here that is not a statistic
    // — it answers "how high is that" without the terrain having to carry a
    // figure on every band, which on a field like LSGG is most of the scope.
    // First, because it is the row the eye goes to on purpose rather than the
    // ones it monitors, and it is blank far more often than it is not.
    { label: 'MSA @ pointer', value: msaFt === null ? '—' : String(msaFt) },
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
      label: 'GO-AROUNDS',
      value: String(stats.goArounds),
      tone: stats.goArounds > 0 ? 'warn' : undefined,
    },
    ...commonRows(world),
  ];
}

/** The scoreboard for whichever job this field is (`Scenario.role`). */
function rows(world: World, msaFt: number | null): Row[] {
  return world.scenario.role === 'center'
    ? centerRows(world, msaFt)
    : approachRows(world, msaFt);
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

export function drawStats(
  ctx: CanvasRenderingContext2D,
  world: World,
  p: Projection,
  msaFt: number | null = null,
): void {
  ctx.font = THEME.fontLabel;
  ctx.textBaseline = 'top';

  const right = p.width - MARGIN_PX;
  const left = p.width - STATS_GUTTER_PX + MARGIN_PX;

  rows(world, msaFt).forEach((row, index) => {
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
