/**
 * Session recording (docs §17).
 *
 * A rolling 60 minutes of sim time, sampled at 5 Hz, held in memory only. The
 * recorder is a *reader* of the world: it never writes to it, and the sim knows
 * nothing about it — `main.ts` calls `sample()` after each physics step, so
 * frames are laid down against sim time and a session flown at 8× records the
 * same detail as one flown at 1×.
 *
 * ## Why tracks rather than snapshots
 *
 * The obvious shape is a list of world snapshots, one per frame. This stores
 * the transpose: one **track** per aircraft, each channel a flat array indexed
 * by frame. Two reasons, both of which playback needs anyway:
 *
 * - An aircraft's whole path is one contiguous array, which is exactly what
 *   drawing the selected aircraft's route asks for (§17.3), and what history
 *   dots are reconstructed from instead of being stored per frame.
 * - It is a few numbers per aircraft-frame rather than an object per
 *   aircraft-frame: an hour of a busy session is single-digit MB.
 *
 * The price is that "who was flying at frame f" is a scan of the track list.
 * With at most a few hundred tracks in the window that is nothing.
 *
 * ## What is recorded
 *
 * Only what the scope, the sidebar and the stats gutter actually display —
 * plus the *assigned* targets, since the whole point of the display is the gap
 * between what was told and what is being flown (§7.2). Everything derivable
 * from geometry (final-approach geometry, in-trail spacing, the clearance
 * preview) is recomputed at playback from the real sim functions rather than
 * stored, so a recording cannot disagree with the live readout.
 */
import type { AircraftType } from '../scenario/aircraftTypes.js';
import type { Scenario } from '../scenario/types.js';
import type { Airline } from '../scenario/airlines.js';
import type { Aircraft, AlertLevel, Phase } from '../sim/aircraft.js';
import {
  PHYSICS_DT,
  REPLAY_PRUNE_SLACK_S,
  REPLAY_SAMPLE_PERIOD_S,
  REPLAY_WINDOW_S,
} from '../sim/constants.js';
import { assignedAltitudeFt, assignedHeadingDeg, assignedIasKts, isPending } from '../sim/pilot.js';
import type { Message, Stats, World } from '../sim/world.js';

/** One aircraft's recorded history. Channels are parallel arrays over frames. */
export interface Track {
  id: number;
  callsign: string;
  airline: Airline;
  type: AircraftType;
  entryGate: string;
  /** Chart name of the STAR it was handed over on, for reconstructing the route. */
  starName: string | null;
  /**
   * Chart name of the SID it departed on, or null on an arrival. This is also
   * what marks the track as a departure: `sid` being set is what makes an
   * aircraft one, so the name is enough to rebuild that (§4.7).
   */
  sidName: string | null;
  /** Frame index of `[0]` in every channel below. */
  startFrame: number;

  // Live state — what the glyph and its trail are drawn from.
  x: number[];
  y: number[];
  altitudeFt: number[];
  headingDeg: number[];
  iasKts: number[];
  vsFpm: number[];

  // The 1 Hz radar sample — what the data block and the sidebar digits show.
  radarAltitudeFt: number[];
  radarIasKts: number[];
  radarHeadingDeg: number[];
  radarGroundSpeedKts: number[];
  radarVsFpm: number[];

  // What the controller had assigned, whether or not it was being flown yet.
  assignedAltitudeFt: number[];
  assignedHeadingDeg: number[];
  assignedIasKts: number[];

  /** Index of the STAR waypoint being tracked, or −1 when off the route. */
  starIndex: number[];
  /** Index of the SID waypoint being tracked, or −1 once the route is complete. */
  sidIndex: number[];
  /** Everything boolean or enumerated, packed — see the `F_*` bits below. */
  flags: number[];
}

/**
 * Session-level state, recorded only when it changes. Stats move a handful of
 * times a session; storing them per frame would cost more than every flight
 * track put together.
 */
export interface SessionSnapshot {
  frame: number;
  flowPerHour: number;
  departureFlowPerHour: number;
  /** Departures holding short — a live gauge, not a tally, so it is recorded. */
  departureQueue: number;
  stats: Stats;
}

export interface Recording {
  /**
   * The field the session was flown at.
   *
   * A track stores its route by *chart name*, which only means anything against
   * the scenario it was flown in — so the recording carries that scenario rather
   * than letting playback resolve names against whatever is loaded. Nothing is
   * persisted today, so a mismatch is impossible; carrying it is what makes the
   * recording self-describing if that ever changes (§17.1).
   */
  readonly scenario: Scenario;
  /** Oldest frame still held; frames are `REPLAY_SAMPLE_PERIOD_S` apart. */
  firstFrame: number;
  /** Newest frame held, or `firstFrame − 1` while the recording is empty. */
  lastFrame: number;
  tracks: Track[];
  byId: Map<number, Track>;
  messages: Message[];
  session: SessionSnapshot[];
  /**
   * The last message copied out of the live log, by identity. The live log is
   * capped and spliced from the front, so an index would not survive; the
   * object itself is the only stable handle.
   */
  messageCursor: Message | null;
}

// ── Flag packing ────────────────────────────────────────────────────────────
// Phase and alert are small enumerations and the rest are single bits, so the
// lot fits in one number per frame instead of ten arrays.

const F_HANDED_OFF = 1 << 0;
const F_SPEED_AFTER_CLEARANCE = 1 << 1;
const F_ON_STAR = 1 << 2;
const F_ALT_MANUAL = 1 << 3;
const F_SPEED_MANUAL = 1 << 4;
const F_HOLDING = 1 << 5;
const F_REJOINING = 1 << 6;
const F_PENDING_HEADING = 1 << 7;
const F_PENDING_ALTITUDE = 1 << 8;
const F_PENDING_SPEED = 1 << 9;
const PHASE_SHIFT = 10;
const PHASE_MASK = 0b111 << PHASE_SHIFT;
const ALERT_SHIFT = 13;
const ALERT_MASK = 0b11 << ALERT_SHIFT;
/**
 * The hold has been told to end at the next crossing of the fix. Recorded
 * because the data block strikes the `HOLD` tag through for it (§4.6) — it is
 * displayed state, and nothing in a rebuilt frame could infer it.
 */
const F_HOLD_EXITING = 1 << 15;

// Seven states in three bits, with one spare. The two departure phases are in
// the same enumeration as the approach ones (§4.7).
const PHASES: readonly Phase[] = [
  'inbound',
  'cleared',
  'loc',
  'gs',
  'goAround',
  'roll',
  'climb',
];
const ALERTS: readonly AlertLevel[] = ['none', 'warning', 'violation'];

export interface DecodedFlags {
  phase: Phase;
  alert: AlertLevel;
  handedOff: boolean;
  speedAssignedAfterClearance: boolean;
  onStar: boolean;
  altitudeManual: boolean;
  speedManual: boolean;
  holding: boolean;
  holdExiting: boolean;
  rejoining: boolean;
  pendingHeading: boolean;
  pendingAltitude: boolean;
  pendingSpeed: boolean;
}

function encodeFlags(ac: Aircraft): number {
  const nav = ac.star;
  let bits = 0;
  if (ac.handedOff) bits |= F_HANDED_OFF;
  if (ac.speedAssignedAfterClearance) bits |= F_SPEED_AFTER_CLEARANCE;
  if (nav) bits |= F_ON_STAR;
  if (nav?.altitudeManual) bits |= F_ALT_MANUAL;
  if (nav?.speedManual) bits |= F_SPEED_MANUAL;
  if (nav?.hold) bits |= F_HOLDING;
  if (nav?.hold?.exitRequested) bits |= F_HOLD_EXITING;
  if (nav?.rejoining) bits |= F_REJOINING;
  // Only the three axes are recorded: a pending clearance or hold changes
  // nothing on the display, whereas a pending turn is the difference between
  // "vectored" and "following the route" (§7.3).
  if (isPending(ac, 'heading')) bits |= F_PENDING_HEADING;
  if (isPending(ac, 'altitude')) bits |= F_PENDING_ALTITUDE;
  if (isPending(ac, 'speed')) bits |= F_PENDING_SPEED;
  bits |= PHASES.indexOf(ac.phase) << PHASE_SHIFT;
  bits |= ALERTS.indexOf(ac.alert) << ALERT_SHIFT;
  return bits;
}

export function decodeFlags(bits: number): DecodedFlags {
  return {
    phase: PHASES[(bits & PHASE_MASK) >> PHASE_SHIFT] ?? 'inbound',
    alert: ALERTS[(bits & ALERT_MASK) >> ALERT_SHIFT] ?? 'none',
    handedOff: (bits & F_HANDED_OFF) !== 0,
    speedAssignedAfterClearance: (bits & F_SPEED_AFTER_CLEARANCE) !== 0,
    onStar: (bits & F_ON_STAR) !== 0,
    altitudeManual: (bits & F_ALT_MANUAL) !== 0,
    speedManual: (bits & F_SPEED_MANUAL) !== 0,
    holding: (bits & F_HOLDING) !== 0,
    holdExiting: (bits & F_HOLD_EXITING) !== 0,
    rejoining: (bits & F_REJOINING) !== 0,
    pendingHeading: (bits & F_PENDING_HEADING) !== 0,
    pendingAltitude: (bits & F_PENDING_ALTITUDE) !== 0,
    pendingSpeed: (bits & F_PENDING_SPEED) !== 0,
  };
}

// ── Frames ──────────────────────────────────────────────────────────────────

/** Sim time a frame index stands for. */
export function frameTimeS(frame: number): number {
  return frame * REPLAY_SAMPLE_PERIOD_S;
}

/** Nearest frame index to a sim time. */
export function frameAtTimeS(timeS: number): number {
  return Math.round(timeS / REPLAY_SAMPLE_PERIOD_S);
}

const WINDOW_FRAMES = Math.round(REPLAY_WINDOW_S / REPLAY_SAMPLE_PERIOD_S);
const SLACK_FRAMES = Math.round(REPLAY_PRUNE_SLACK_S / REPLAY_SAMPLE_PERIOD_S);

/** True once at least one frame has been taken. */
export function hasFrames(rec: Recording): boolean {
  return rec.lastFrame >= rec.firstFrame;
}

/** Length of the recording in sim seconds. */
export function recordingSpanS(rec: Recording): number {
  return hasFrames(rec) ? frameTimeS(rec.lastFrame - rec.firstFrame) : 0;
}

/** True while a frame holds a sample of this track. */
export function trackCoversFrame(track: Track, frame: number): boolean {
  return frame >= track.startFrame && frame < track.startFrame + track.x.length;
}

export function createRecording(scenario: Scenario): Recording {
  return {
    scenario,
    firstFrame: 0,
    lastFrame: -1,
    tracks: [],
    byId: new Map(),
    messages: [],
    session: [],
    messageCursor: null,
  };
}

function newTrack(ac: Aircraft, frame: number): Track {
  return {
    id: ac.id,
    callsign: ac.callsign,
    airline: ac.airline,
    type: ac.type,
    entryGate: ac.entryGate,
    starName: ac.star?.route.name ?? null,
    sidName: ac.sid?.route.name ?? null,
    startFrame: frame,
    x: [],
    y: [],
    altitudeFt: [],
    headingDeg: [],
    iasKts: [],
    vsFpm: [],
    radarAltitudeFt: [],
    radarIasKts: [],
    radarHeadingDeg: [],
    radarGroundSpeedKts: [],
    radarVsFpm: [],
    assignedAltitudeFt: [],
    assignedHeadingDeg: [],
    assignedIasKts: [],
    starIndex: [],
    sidIndex: [],
    flags: [],
  };
}

function appendSample(track: Track, ac: Aircraft): void {
  track.x.push(ac.x);
  track.y.push(ac.y);
  track.altitudeFt.push(ac.altitudeFt);
  track.headingDeg.push(ac.headingDeg);
  track.iasKts.push(ac.iasKts);
  track.vsFpm.push(ac.vsFpm);
  track.radarAltitudeFt.push(ac.radar.altitudeFt);
  track.radarIasKts.push(ac.radar.iasKts);
  track.radarHeadingDeg.push(ac.radar.headingDeg);
  track.radarGroundSpeedKts.push(ac.radar.groundSpeedKts);
  track.radarVsFpm.push(ac.radar.vsFpm);
  track.assignedAltitudeFt.push(assignedAltitudeFt(ac));
  track.assignedHeadingDeg.push(assignedHeadingDeg(ac));
  track.assignedIasKts.push(assignedIasKts(ac));
  track.starIndex.push(ac.star ? ac.star.index : -1);
  // −1 once the route is complete, which is what tells playback the aircraft is
  // flying its exit heading rather than tracking a fix.
  track.sidIndex.push(ac.sid && !ac.sid.complete ? ac.sid.index : -1);
  track.flags.push(encodeFlags(ac));
}

const CHANNELS: ReadonlyArray<keyof Track> = [
  'x',
  'y',
  'altitudeFt',
  'headingDeg',
  'iasKts',
  'vsFpm',
  'radarAltitudeFt',
  'radarIasKts',
  'radarHeadingDeg',
  'radarGroundSpeedKts',
  'radarVsFpm',
  'assignedAltitudeFt',
  'assignedHeadingDeg',
  'assignedIasKts',
  'starIndex',
  'sidIndex',
  'flags',
];

function cloneStats(stats: Stats): Stats {
  return {
    ...stats,
    landingTimesS: [...stats.landingTimesS],
    departureTimesS: [...stats.departureTimesS],
    rejections: new Map(stats.rejections),
    missedIntercepts: new Map(stats.missedIntercepts),
  };
}

function sumCounts(counts: Map<string, number>): number {
  let total = 0;
  for (const count of counts.values()) total += count;
  return total;
}

/**
 * Whether anything a snapshot carries has moved.
 *
 * `landingTimesS` is not compared: the landing counter moves at the same instant
 * a landing time is stamped, so nothing is missed.
 *
 * `departureTimesS` has to be compared, because nothing else moves with it:
 * `departures` counts airspace exits while a departure time is stamped at the
 * take-off roll, minutes earlier (§8.2). It is compared by its *last* entry
 * rather than its length, because the list saturates at the few timestamps the
 * rate reads and then stops growing.
 */
function sessionChanged(last: SessionSnapshot, world: World): boolean {
  const a = last.stats;
  const b = world.stats;
  return (
    last.flowPerHour !== world.flowPerHour ||
    last.departureFlowPerHour !== world.departureFlowPerHour ||
    last.departureQueue !== world.traffic.departureQueue ||
    a.landings !== b.landings ||
    a.departures !== b.departures ||
    a.departureTimesS[a.departureTimesS.length - 1] !==
      b.departureTimesS[b.departureTimesS.length - 1] ||
    a.handoffs !== b.handoffs ||
    a.violations !== b.violations ||
    a.goArounds !== b.goArounds ||
    a.exits !== b.exits ||
    a.trackMileSamples !== b.trackMileSamples ||
    // Violation seconds tick up continuously while a violation stands, so this
    // is the one field that makes a snapshot per frame — which is exactly when
    // the extra detail is wanted.
    a.violationSeconds !== b.violationSeconds ||
    a.rejections.size !== b.rejections.size ||
    a.missedIntercepts.size !== b.missedIntercepts.size ||
    sumCounts(a.rejections) !== sumCounts(b.rejections) ||
    sumCounts(a.missedIntercepts) !== sumCounts(b.missedIntercepts)
  );
}

function recordSession(rec: Recording, world: World, frame: number): void {
  const last = rec.session[rec.session.length - 1];
  if (last && !sessionChanged(last, world)) return;
  rec.session.push({
    frame,
    flowPerHour: world.flowPerHour,
    departureFlowPerHour: world.departureFlowPerHour,
    departureQueue: world.traffic.departureQueue,
    stats: cloneStats(world.stats),
  });
}

function recordMessages(rec: Recording, world: World): void {
  const cursor = rec.messageCursor;
  let start = 0;
  if (cursor) {
    const index = world.messages.indexOf(cursor);
    if (index >= 0) {
      start = index + 1;
    } else {
      // The cursor aged out of the capped live log between samples, which needs
      // MESSAGE_LOG_MAX messages inside one sample period. Fall back to time,
      // which can only misfire on messages sharing the cursor's exact instant.
      start = world.messages.findIndex((message) => message.timeS > cursor.timeS);
      if (start < 0) return;
    }
  }
  for (let i = start; i < world.messages.length; i += 1) rec.messages.push(world.messages[i]!);
  rec.messageCursor = world.messages[world.messages.length - 1] ?? cursor;
}

/** Drop everything before `firstFrame`, in one batch. */
function prune(rec: Recording): void {
  const keep: Track[] = [];
  for (const track of rec.tracks) {
    const drop = rec.firstFrame - track.startFrame;
    if (drop >= track.x.length) {
      rec.byId.delete(track.id);
      continue;
    }
    if (drop > 0) {
      for (const channel of CHANNELS) (track[channel] as number[]).splice(0, drop);
      track.startFrame += drop;
    }
    keep.push(track);
  }
  rec.tracks = keep;

  const cutoffS = frameTimeS(rec.firstFrame);
  const staleMessages = rec.messages.findIndex((message) => message.timeS >= cutoffS);
  if (staleMessages > 0) rec.messages.splice(0, staleMessages);
  else if (staleMessages < 0) rec.messages.length = 0;

  // Keep the last snapshot at or before the cutoff: it is the state still in
  // force at the new start of the recording, not history.
  let stale = -1;
  for (let i = 0; i < rec.session.length; i += 1) {
    if (rec.session[i]!.frame <= rec.firstFrame) stale = i;
    else break;
  }
  if (stale > 0) rec.session.splice(0, stale);
}

/**
 * Take a frame if one is due. Called after every physics step, so the check is
 * against sim time — half a physics tick of slack keeps frames on the exact
 * 0.2 s grid despite the accumulated float error in `world.timeS`, which is
 * what lets playback reconstruct history dots on the same grid the live scope
 * laid them down on.
 */
export function sample(rec: Recording, world: World): void {
  const dueAtS = frameTimeS(rec.lastFrame + 1) - PHYSICS_DT / 2;
  if (world.timeS < dueAtS) return;

  // A loop rather than an `if`, so a sample period shorter than the physics
  // step could never leave a gap in the frame indexing.
  while (world.timeS >= frameTimeS(rec.lastFrame + 1) - PHYSICS_DT / 2) {
    const frame = rec.lastFrame + 1;
    for (const ac of world.aircraft) {
      let track = rec.byId.get(ac.id);
      if (!track) {
        track = newTrack(ac, frame);
        rec.byId.set(ac.id, track);
        rec.tracks.push(track);
      }
      appendSample(track, ac);
    }
    recordSession(rec, world, frame);
    rec.lastFrame = frame;
  }

  recordMessages(rec, world);

  if (rec.lastFrame - rec.firstFrame > WINDOW_FRAMES + SLACK_FRAMES) {
    rec.firstFrame = rec.lastFrame - WINDOW_FRAMES;
    prune(rec);
  }
}
