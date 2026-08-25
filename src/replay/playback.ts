/**
 * Playback (docs §17.2).
 *
 * Rebuilds a `World` from a `Recording` at a chosen instant, so every existing
 * renderer draws a replay without knowing it is one: the scope, the sidebar and
 * the stats gutter are handed a world of the same shape they always get.
 *
 * Two things are deliberately *not* stored by the recorder and are rebuilt here
 * instead:
 *
 * - **History dots**, from the track itself. The live scope lays a dot every
 *   10 s of sim time on a grid anchored at zero (§5), and the recorder samples
 *   on a 0.2 s grid anchored at the same zero, so every dot the live scope drew
 *   has a frame — within one physics tick — sitting under it.
 * - **Separation**, by running the real `analyzeSeparation` over the rebuilt
 *   traffic. That is what gives the sidebar its in-trail figures, and it cannot
 *   drift from the live rules because it *is* the live rules. The per-aircraft
 *   alert level still comes from the recording: on the scope that colour is a
 *   1 Hz radar sample, not an instantaneous truth (§5).
 */
import { sidByName } from '../scenario/sids.js';
import { STARS } from '../scenario/stars.js';
import type { Aircraft } from '../sim/aircraft.js';
import type { SidNav } from '../sim/departure.js';
import {
  HISTORY_PERIOD_S,
  MESSAGE_LOG_MAX,
  PHYSICS_DT,
  REPLAY_PATH_STRIDE,
  REPLAY_SAMPLE_PERIOD_S,
  TRAIL_LENGTH,
} from '../sim/constants.js';
import type { HoldNav } from '../sim/hold.js';
import type { PendingInstruction } from '../sim/pilot.js';
import { createRng } from '../sim/rng.js';
import { analyzeSeparation } from '../sim/separation.js';
import { activeFix, type StarNav } from '../sim/star.js';
import { clamp, type Point, type Sec } from '../sim/units.js';
import type { Message, Stats, World } from '../sim/world.js';
import {
  decodeFlags,
  frameAtTimeS,
  frameTimeS,
  hasFrames,
  trackCoversFrame,
  type Recording,
  type Track,
} from './recorder.js';

/** How many frames apart the history dots are. */
const TRAIL_STRIDE = Math.round(HISTORY_PERIOD_S / REPLAY_SAMPLE_PERIOD_S);

const EMPTY_STATS: Stats = {
  landings: 0,
  landingTimesS: [],
  departures: 0,
  departureTimesS: [],
  handoffs: 0,
  violations: 0,
  violationSeconds: 0,
  goArounds: 0,
  exits: 0,
  rejections: new Map(),
  missedIntercepts: new Map(),
  trackMileRatioSum: 0,
  trackMileSamples: 0,
};

/** The selected aircraft's whole recorded route, split at the instant shown. */
export interface TrackPath {
  flown: Point[];
  /** Where it went after the instant being shown — the part not yet replayed. */
  remaining: Point[];
}

/**
 * History dots, rebuilt from the track.
 *
 * The live scope lays the dot for period *k* one physics tick *after* the
 * 10 s mark, since `step` advances the clock before testing it — so at a frame
 * landing exactly on a multiple of 10 s that dot does not exist yet, and
 * counting dots off the frame alone would draw one too many. `dots` is
 * therefore how many marks have gone by at this frame, and each one's position
 * is read from the frame sitting on its mark: a tick early, which is 0.007 NM
 * at 250 kt.
 */
function trailAt(track: Track, frame: number): Point[] {
  const trail: Point[] = [];
  const dots = Math.max(0, Math.floor((frame - PHYSICS_DT / REPLAY_SAMPLE_PERIOD_S) / TRAIL_STRIDE));
  for (let k = TRAIL_LENGTH - 1; k >= 0; k -= 1) {
    const at = (dots - k) * TRAIL_STRIDE;
    if (at < 0 || !trackCoversFrame(track, at)) continue;
    const index = at - track.startFrame;
    trail.push({ x: track.x[index]!, y: track.y[index]! });
  }
  return trail;
}

/**
 * A hold reconstructed for display only. `ac.star.hold` being non-null is what
 * puts `HOLD` on the data block and `(alt assigned)` in the sidebar; nothing in
 * playback ever flies the pattern, so the leg geometry is inert.
 */
function displayHold(nav: StarNav, altitudeFt: number): HoldNav {
  return {
    fix: activeFix(nav).name,
    leg: 'inbound',
    altitudeFt,
    outboundHeadingDeg: 0,
    legEndsAtS: 0,
    turningRight: true,
    altitudeWasManual: nav.altitudeManual,
    established: true,
    exitRequested: false,
  };
}

function aircraftAt(track: Track, frame: number): Aircraft {
  const i = frame - track.startFrame;
  const flags = decodeFlags(track.flags[i]!);

  const route = track.starName === null ? undefined : STARS.find((s) => s.name === track.starName);
  let star: StarNav | null = null;
  if (flags.onStar && route) {
    star = {
      route,
      index: Math.max(0, track.starIndex[i]!),
      altitudeManual: flags.altitudeManual,
      speedManual: flags.speedManual,
      hold: null,
      rejoining: flags.rejoining,
      // A stacked delivery raises the profile the *live* aircraft flies, but
      // nothing displays that profile — only the altitude it produced, which is
      // recorded — so a rebuilt frame flies the chart and reads identically.
      altitudes: route.altitudes,
    };
    if (flags.holding) star.hold = displayHold(star, track.altitudeFt[i]!);
  }

  // A departure is rebuilt from its chart name and the fix it was tracking.
  // Nothing in playback flies a SID, but `sid` being non-null is what makes the
  // aircraft read as a departure everywhere else — muted on the scope,
  // uncontrollable, tagged DEP (§4.7).
  const sidRoute = track.sidName === null ? undefined : sidByName(track.sidName);
  let sid: SidNav | null = null;
  if (sidRoute) {
    const index = track.sidIndex[i]!;
    sid = {
      route: sidRoute,
      index: index < 0 ? sidRoute.waypoints.length - 1 : index,
      complete: index < 0,
    };
  }

  const assignedAltitudeFt = track.assignedAltitudeFt[i]!;
  const assignedHeadingDeg = track.assignedHeadingDeg[i]!;
  const assignedIasKts = track.assignedIasKts[i]!;

  /**
   * The targets carry the *assigned* values, and a pending entry is rebuilt
   * alongside for each axis that had one outstanding. Nothing on the display
   * distinguishes "assigned" from "being flown" except by asking `isPending`,
   * so this reproduces both readings from three numbers and three bits — the
   * live target is not separately recorded because it is never shown.
   */
  const pending: PendingInstruction[] = [];
  if (flags.pendingHeading) {
    pending.push({ atS: Infinity, instruction: { kind: 'heading', headingDeg: assignedHeadingDeg } });
  }
  if (flags.pendingAltitude) {
    pending.push({ atS: Infinity, instruction: { kind: 'altitude', altitudeFt: assignedAltitudeFt } });
  }
  if (flags.pendingSpeed) {
    pending.push({ atS: Infinity, instruction: { kind: 'speed', iasKts: assignedIasKts } });
  }

  return {
    id: track.id,
    callsign: track.callsign,
    airline: track.airline,
    type: track.type,
    x: track.x[i]!,
    y: track.y[i]!,
    altitudeFt: track.altitudeFt[i]!,
    headingDeg: track.headingDeg[i]!,
    iasKts: track.iasKts[i]!,
    vsFpm: track.vsFpm[i]!,
    targetHeadingDeg: assignedHeadingDeg,
    targetAltitudeFt: assignedAltitudeFt,
    targetIasKts: assignedIasKts,
    pending,
    turnDirection: null,
    star,
    sid,
    phase: flags.phase,
    handedOff: flags.handedOff,
    speedAssignedAfterClearance: flags.speedAssignedAfterClearance,
    entryGate: track.entryGate,
    spawnedAtS: frameTimeS(track.startFrame),
    // Track miles and the direct distance only feed the end-of-flight
    // efficiency ratio, which is already in the recorded stats.
    trackMilesFlown: 0,
    directDistanceNm: 0,
    goArounds: 0,
    exitWarned: false,
    // The assigned-heading vector is an instruction artefact and is not drawn
    // in replay (§17.3), so there is no hint window to reproduce.
    headingHintUntilS: 0,
    trail: trailAt(track, frame),
    radar: {
      altitudeFt: track.radarAltitudeFt[i]!,
      iasKts: track.radarIasKts[i]!,
      headingDeg: track.radarHeadingDeg[i]!,
      groundSpeedKts: track.radarGroundSpeedKts[i]!,
      vsFpm: track.radarVsFpm[i]!,
    },
    alert: flags.alert,
  };
}

/** The last session snapshot taken at or before `frame`. */
function sessionAt(
  rec: Recording,
  frame: number,
): { flowPerHour: number; departureFlowPerHour: number; departureQueue: number; stats: Stats } {
  let lo = 0;
  let hi = rec.session.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (rec.session[mid]!.frame <= frame) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  const snapshot = found >= 0 ? rec.session[found] : rec.session[0];
  if (!snapshot) {
    return { flowPerHour: 0, departureFlowPerHour: 0, departureQueue: 0, stats: EMPTY_STATS };
  }
  return {
    flowPerHour: snapshot.flowPerHour,
    departureFlowPerHour: snapshot.departureFlowPerHour,
    departureQueue: snapshot.departureQueue,
    stats: snapshot.stats,
  };
}

/** Everything said up to this instant, trimmed the way the live log trims. */
function messagesAt(rec: Recording, timeS: Sec): Message[] {
  let lo = 0;
  let hi = rec.messages.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (rec.messages[mid]!.timeS <= timeS) lo = mid + 1;
    else hi = mid;
  }
  return rec.messages.slice(Math.max(0, lo - MESSAGE_LOG_MAX), lo);
}

/** Rebuild the world as it was at a frame. */
export function worldAtFrame(
  rec: Recording,
  frame: number,
  view: { selectedId: number | null; paused: boolean; timeScale: number },
): World {
  const aircraft: Aircraft[] = [];
  for (const track of rec.tracks) {
    if (trackCoversFrame(track, frame)) aircraft.push(aircraftAt(track, frame));
  }
  const timeS = frameTimeS(frame);
  const { flowPerHour, departureFlowPerHour, departureQueue, stats } = sessionAt(rec, frame);

  return {
    timeS,
    aircraft,
    messages: messagesAt(rec, timeS),
    stats,
    flowPerHour,
    departureFlowPerHour,
    // A replay has no future to generate: the streams and the spawner exist
    // only to satisfy the type, and `step` is never called on this world.
    rng: createRng(0),
    pilotRng: createRng(0),
    departureRng: createRng(0),
    traffic: {
      nextSpawnAtS: Infinity,
      gateLastSpawnS: new Map(),
      nextId: 0,
      nextDepartureAtS: Infinity,
      departureQueue,
      lastDepartureS: null,
      lastLandingS: null,
    },
    separation: analyzeSeparation(aircraft),
    selectedId: aircraft.some((ac) => ac.id === view.selectedId) ? view.selectedId : null,
    paused: view.paused,
    timeScale: view.timeScale,
    nextRadarAtS: Infinity,
    nextHistoryAtS: Infinity,
    activeViolations: new Map(),
  };
}

/** The selected aircraft's whole route through the recording, split at `frame`. */
export function pathFor(rec: Recording, id: number | null, frame: number): TrackPath | null {
  if (id === null) return null;
  const track = rec.byId.get(id);
  if (!track || !trackCoversFrame(track, frame)) return null;

  const flown: Point[] = [];
  const remaining: Point[] = [];
  const current = frame - track.startFrame;
  const last = track.x.length - 1;
  for (let i = 0; i < track.x.length; i += REPLAY_PATH_STRIDE) {
    (i <= current ? flown : remaining).push({ x: track.x[i]!, y: track.y[i]! });
  }
  // Both halves meet at the blip, so the join is not a gap of up to a second,
  // and the far end is the aircraft's last recorded position rather than the
  // last whole second before it — that end is a touchdown or a boundary exit.
  const here = { x: track.x[current]!, y: track.y[current]! };
  flown.push(here);
  remaining.unshift(here);
  if (last > current && last % REPLAY_PATH_STRIDE !== 0) {
    remaining.push({ x: track.x[last]!, y: track.y[last]! });
  }
  return { flown, remaining };
}

// ── Transport ───────────────────────────────────────────────────────────────

export interface Playback {
  readonly recording: Recording;
  /** Sim time being shown. */
  timeS: Sec;
  paused: boolean;
  rate: number;
  selectedId: number | null;
  /** Sim time of the first and last recorded frame. */
  readonly startS: Sec;
  readonly endS: Sec;
  /** True once playback has run to the end of the recording. */
  readonly atEnd: boolean;
  /** Advance by real elapsed time, scaled by the rate. Stops at the end. */
  advance(realDtS: number): void;
  seekTo(timeS: Sec): void;
  skip(deltaS: number): void;
  setRate(rate: number): void;
  togglePause(): void;
  /** The world as it looks now, ready to hand to the renderers. */
  view(): { world: World; path: TrackPath | null };
}

export function createPlayback(recording: Recording): Playback {
  const startS = hasFrames(recording) ? frameTimeS(recording.firstFrame) : 0;
  const endS = hasFrames(recording) ? frameTimeS(recording.lastFrame) : 0;

  const playback: Playback = {
    recording,
    timeS: startS,
    paused: false,
    rate: 1,
    selectedId: null,
    startS,
    endS,
    get atEnd(): boolean {
      return playback.timeS >= endS - REPLAY_SAMPLE_PERIOD_S / 2;
    },

    advance(realDtS: number): void {
      if (playback.paused) return;
      playback.timeS = clamp(playback.timeS + realDtS * playback.rate, startS, endS);
      // Sitting at the end playing nothing reads as a stall; pausing says the
      // recording is over and leaves the transport ready to rewind.
      if (playback.atEnd) playback.paused = true;
    },

    seekTo(timeS: Sec): void {
      playback.timeS = clamp(timeS, startS, endS);
    },

    skip(deltaS: number): void {
      playback.seekTo(playback.timeS + deltaS);
    },

    setRate(rate: number): void {
      playback.rate = rate;
      // Choosing a speed is an instruction to play; otherwise the first thing
      // every rate button needs is a second click on play.
      if (playback.paused && !playback.atEnd) playback.paused = false;
    },

    togglePause(): void {
      // Play from the start again once the recording has run out.
      if (playback.paused && playback.atEnd) playback.timeS = startS;
      playback.paused = !playback.paused;
    },

    view() {
      const frame = clamp(
        frameAtTimeS(playback.timeS),
        recording.firstFrame,
        Math.max(recording.firstFrame, recording.lastFrame),
      );
      const world = worldAtFrame(recording, frame, {
        selectedId: playback.selectedId,
        paused: playback.paused,
        timeScale: playback.rate,
      });
      // `selectedId` is kept as the *intent* and deliberately not overwritten by
      // what the frame resolved to. An aircraft only exists for part of the
      // recording, so scrubbing outside its life would otherwise deselect it for
      // good — including the moment playback opens, which is before almost
      // everything was handed over. The world carries the resolved answer, so
      // the sidebar and the path go quiet meanwhile and come back with it.
      return { world, path: pathFor(recording, world.selectedId, frame) };
    },
  };
  return playback;
}
