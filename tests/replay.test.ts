import { describe, expect, it } from 'vitest';
import {
  HISTORY_PERIOD_S,
  MESSAGE_LOG_MAX,
  PHYSICS_DT,
  REPLAY_PRUNE_SLACK_S,
  REPLAY_SAMPLE_PERIOD_S,
  REPLAY_WINDOW_S,
  TRAIL_LENGTH,
} from '../src/sim/constants.js';
import { adjustAltitude, toggleHold } from '../src/sim/commands.js';
import { assignedAltitudeFt, assignedHeadingDeg, isPending } from '../src/sim/pilot.js';
import { isDeparture } from '../src/sim/aircraft.js';
import { activeSidFix } from '../src/sim/departure.js';
import { createDeparture, createTrafficState } from '../src/sim/traffic.js';
import { createRng } from '../src/sim/rng.js';
import { activeFix } from '../src/sim/star.js';
import {
  createWorld,
  departureQueueLength,
  log,
  messagesFor,
  step,
  type World,
} from '../src/sim/world.js';
import { createPlayback, pathFor, worldAtFrame } from '../src/replay/playback.js';
import {
  createRecording,
  frameAtTimeS,
  frameTimeS,
  recordingSpanS,
  sample,
  type Recording,
} from '../src/replay/recorder.js';
import { makeAircraft, onFinal, quietWorld, SCENARIO } from './helpers.js';

/** Run the world forward, recording it exactly as `main.ts` does. */
function runRecorded(world: World, rec: Recording, seconds: number): void {
  const steps = Math.round(seconds / PHYSICS_DT);
  for (let i = 0; i < steps; i += 1) {
    step(world, PHYSICS_DT);
    sample(rec, world);
  }
}

function recorded(world: World, seconds: number): Recording {
  const rec = createRecording();
  runRecorded(world, rec, seconds);
  return rec;
}

/** A busy session, flown by nobody, with a fixed seed. */
function session(seconds: number): { world: World; rec: Recording } {
  const world = createWorld(SCENARIO, 7);
  const rec = recorded(world, seconds);
  return { world, rec };
}

describe('recording', () => {
  it('samples at the replay rate against sim time', () => {
    const { rec } = session(60);
    expect(rec.firstFrame).toBe(0);
    expect(rec.lastFrame).toBe(60 / REPLAY_SAMPLE_PERIOD_S);
    expect(recordingSpanS(rec)).toBeCloseTo(60, 6);
  });

  it('samples the same amount of session under time acceleration', () => {
    // Acceleration is a property of the *loop*, not of `step`, so the recorder
    // must not see it at all: the same sim seconds give the same frames.
    const slow = session(30).rec;
    const fast = session(30).rec;
    expect(fast.lastFrame).toBe(slow.lastFrame);
  });

  it('gives every aircraft a contiguous track over its life', () => {
    const { world, rec } = session(120);
    expect(rec.tracks.length).toBeGreaterThan(0);
    for (const track of rec.tracks) {
      expect(track.x.length).toBe(track.flags.length);
      expect(track.x.length).toBeGreaterThan(0);
      // Nothing spawns before the recording, and nothing outlives its end.
      expect(track.startFrame).toBeGreaterThanOrEqual(rec.firstFrame);
      expect(track.startFrame + track.x.length - 1).toBeLessThanOrEqual(rec.lastFrame);
    }
    // Everything still flying was sampled on the final frame.
    const alive = rec.tracks.filter(
      (track) => track.startFrame + track.x.length - 1 === rec.lastFrame,
    );
    expect(alive.length).toBe(world.aircraft.length);
  });
});

describe('rebuilding a frame', () => {
  it('reproduces the live display state exactly', () => {
    const { world, rec } = session(180);
    const replayed = worldAtFrame(rec, rec.lastFrame, {
      selectedId: null,
      paused: true,
      timeScale: 1,
    });

    expect(replayed.aircraft.length).toBe(world.aircraft.length);
    expect(replayed.timeS).toBeCloseTo(world.timeS, 1);

    for (const live of world.aircraft) {
      const copy = replayed.aircraft.find((ac) => ac.id === live.id);
      expect(copy, live.callsign).toBeDefined();
      if (!copy) continue;
      expect(copy.callsign).toBe(live.callsign);
      expect(copy.type.code).toBe(live.type.code);
      expect(copy.x).toBeCloseTo(live.x, 9);
      expect(copy.y).toBeCloseTo(live.y, 9);
      expect(copy.altitudeFt).toBeCloseTo(live.altitudeFt, 9);
      expect(copy.headingDeg).toBeCloseTo(live.headingDeg, 9);
      expect(copy.iasKts).toBeCloseTo(live.iasKts, 9);
      // The data block and the sidebar digits come off the radar sample, so
      // that has to survive as its own set of numbers (§5).
      expect(copy.radar).toEqual(live.radar);
      expect(copy.phase).toBe(live.phase);
      expect(copy.alert).toBe(live.alert);
      expect(copy.handedOff).toBe(live.handedOff);
      expect(assignedAltitudeFt(copy)).toBeCloseTo(assignedAltitudeFt(live), 9);
      expect(assignedHeadingDeg(copy)).toBeCloseTo(assignedHeadingDeg(live), 9);
    }
  });

  it('keeps the route, the active fix and the manual overrides', () => {
    const { world, rec } = session(200);
    const onStar = world.aircraft.filter((ac) => ac.star !== null);
    expect(onStar.length).toBeGreaterThan(0);

    const replayed = worldAtFrame(rec, rec.lastFrame, {
      selectedId: null,
      paused: true,
      timeScale: 1,
    });
    for (const live of onStar) {
      const copy = replayed.aircraft.find((ac) => ac.id === live.id)!;
      expect(copy.star).not.toBeNull();
      expect(copy.star!.route.name).toBe(live.star!.route.name);
      expect(activeFix(copy.star!).name).toBe(activeFix(live.star!).name);
      expect(copy.star!.altitudeManual).toBe(live.star!.altitudeManual);
      expect(copy.star!.speedManual).toBe(live.star!.speedManual);
    }
    // Routes are looked up by chart name, so the recording only holds the name.
    expect(SCENARIO.stars.some((star) => star.name === rec.tracks[0]!.starName)).toBe(true);
  });

  it('separates an assigned target from the one being flown', () => {
    const world = createWorld(SCENARIO, 3);
    const rec = createRecording();
    runRecorded(world, rec, 20);
    const ac = world.aircraft[0]!;
    const before = ac.targetAltitudeFt;

    world.selectedId = ac.id;
    adjustAltitude(world, ac, -1);
    const assignedFt = assignedAltitudeFt(ac);
    expect(assignedFt).not.toBe(before);
    // Half a second: the crew has not acted yet, so the instruction is still
    // outstanding and the display is showing the gap (§7.2).
    runRecorded(world, rec, 0.5);
    expect(isPending(ac, 'altitude')).toBe(true);

    const copy = worldAtFrame(rec, rec.lastFrame, {
      selectedId: null,
      paused: true,
      timeScale: 1,
    }).aircraft.find((other) => other.id === ac.id)!;
    expect(isPending(copy, 'altitude')).toBe(true);
    expect(assignedAltitudeFt(copy)).toBeCloseTo(assignedFt, 9);
  });

  it('shows an aircraft in the pattern as holding', () => {
    const world = createWorld(SCENARIO, 11);
    const rec = createRecording();
    runRecorded(world, rec, 30);
    const ac = world.aircraft.find((other) => other.star !== null)!;
    world.selectedId = ac.id;
    toggleHold(world, ac);
    runRecorded(world, rec, 240);
    expect(ac.star?.hold).toBeTruthy();

    const copy = worldAtFrame(rec, rec.lastFrame, {
      selectedId: null,
      paused: true,
      timeScale: 1,
    }).aircraft.find((other) => other.id === ac.id)!;
    expect(copy.star?.hold).toBeTruthy();
    expect(copy.star!.hold!.fix).toBe(ac.star!.hold!.fix);
  });

  it('rebuilds the history trail on the grid the live scope used', () => {
    // Long enough for a trail to have filled: a dot every HISTORY_PERIOD_S,
    // plus a margin for the aircraft that spawned a little after t=0.
    const { world, rec } = session(TRAIL_LENGTH * HISTORY_PERIOD_S + 50);
    const live = world.aircraft.find((ac) => ac.trail.length === TRAIL_LENGTH);
    expect(live, 'an aircraft with a full trail').toBeDefined();
    if (!live) return;

    const copy = worldAtFrame(rec, rec.lastFrame, {
      selectedId: null,
      paused: true,
      timeScale: 1,
    }).aircraft.find((ac) => ac.id === live.id)!;
    expect(copy.trail.length).toBe(live.trail.length);
    // Dots are reconstructed from the frame grid rather than stored, so they
    // land within one physics tick of where the live scope drew them: at 250 kt
    // that is 0.007 NM, well inside a pixel on a 50 NM scope.
    copy.trail.forEach((point, index) => {
      expect(point.x).toBeCloseTo(live.trail[index]!.x, 1);
      expect(point.y).toBeCloseTo(live.trail[index]!.y, 1);
    });
    expect(HISTORY_PERIOD_S / REPLAY_SAMPLE_PERIOD_S).toBe(50);
  });

  it('recomputes in-trail spacing from the rebuilt traffic', () => {
    const leader = makeAircraft({ ...onFinal(6), altitudeFt: 2000, phase: 'gs' });
    const follower = makeAircraft({ ...onFinal(11), altitudeFt: 3400, phase: 'gs' });
    follower.id = leader.id + 1;
    const world = quietWorld(leader, follower);
    const rec = recorded(world, 1);

    const replayed = worldAtFrame(rec, rec.lastFrame, {
      selectedId: null,
      paused: true,
      timeScale: 1,
    });
    expect(replayed.separation.inTrail.get(follower.id)).toBeCloseTo(
      world.separation.inTrail.get(follower.id)!,
      1,
    );
  });
});

describe('the session timeline', () => {
  it('replays only what had been said by that instant', () => {
    const world = quietWorld();
    const rec = createRecording();
    runRecorded(world, rec, 5);
    log(world, 'first', 'system');
    runRecorded(world, rec, 5);
    log(world, 'second', 'system');
    runRecorded(world, rec, 5);

    const at = (timeS: number): string[] =>
      worldAtFrame(rec, frameAtTimeS(timeS), {
        selectedId: null,
        paused: true,
        timeScale: 1,
      }).messages.map((message) => message.text);

    expect(at(2)).toEqual([]);
    expect(at(7)).toEqual(['first']);
    expect(at(14)).toEqual(['first', 'second']);
  });

  it('filters the replayed log to the aircraft being reviewed', () => {
    const ac = makeAircraft({ ...onFinal(12) });
    const world = quietWorld(ac);
    const rec = createRecording();
    log(world, 'about it', 'pilot', [ac.id]);
    log(world, 'about nobody', 'system');
    runRecorded(world, rec, 5);

    const frame = frameAtTimeS(3);
    const view = { paused: true, timeScale: 1 };
    const at = (selectedId: number | null): string[] =>
      messagesFor(worldAtFrame(rec, frame, { ...view, selectedId })).map((m) => m.text);

    expect(at(null)).toEqual(['about it', 'about nobody']);
    expect(at(ac.id)).toEqual(['about it']);
  });

  it('trims the replayed log the way the live log is capped', () => {
    const world = quietWorld();
    const rec = createRecording();
    for (let i = 0; i < MESSAGE_LOG_MAX + 20; i += 1) {
      log(world, `line ${i}`, 'system');
      runRecorded(world, rec, 0.4);
    }
    const replayed = worldAtFrame(rec, rec.lastFrame, {
      selectedId: null,
      paused: true,
      timeScale: 1,
    });
    expect(replayed.messages.length).toBe(MESSAGE_LOG_MAX);
    expect(replayed.messages[replayed.messages.length - 1]!.text).toBe(
      `line ${MESSAGE_LOG_MAX + 19}`,
    );
  });

  it('holds the stats as they stood at that instant', () => {
    const world = quietWorld();
    const rec = createRecording();
    runRecorded(world, rec, 4);
    world.stats.landings = 1;
    runRecorded(world, rec, 4);
    world.stats.landings = 2;
    runRecorded(world, rec, 4);

    const landingsAt = (timeS: number): number =>
      worldAtFrame(rec, frameAtTimeS(timeS), { selectedId: null, paused: true, timeScale: 1 })
        .stats.landings;
    expect(landingsAt(2)).toBe(0);
    expect(landingsAt(6)).toBe(1);
    expect(landingsAt(11)).toBe(2);
  });

  it('carries the arrival flow it was flown at', () => {
    const world = createWorld(SCENARIO, 5);
    world.flowPerHour = 25;
    const rec = recorded(world, 3);
    const replayed = worldAtFrame(rec, rec.lastFrame, {
      selectedId: null,
      paused: true,
      timeScale: 1,
    });
    expect(replayed.flowPerHour).toBe(25);
  });
});

describe('the rolling window', () => {
  /**
   * An hour of sim time is 72,000 physics steps, which is not worth flying to
   * test bookkeeping: the recorder only reads the clock, the traffic and the
   * log off the world, so the clock can simply be advanced.
   */
  function fastForward(world: World, rec: Recording, seconds: number): void {
    const frames = Math.round(seconds / REPLAY_SAMPLE_PERIOD_S);
    for (let i = 0; i < frames; i += 1) {
      world.timeS += REPLAY_SAMPLE_PERIOD_S;
      sample(rec, world);
    }
  }

  it('keeps the last hour of sim time and drops what is older', () => {
    const ac = makeAircraft({ ...onFinal(30), altitudeFt: 8000 });
    const world = quietWorld(ac);
    const rec = createRecording();
    log(world, 'the very first thing said', 'system');
    fastForward(world, rec, REPLAY_WINDOW_S + 300);

    // At least the window, and at most the window plus the prune slack: old
    // frames are dropped in batches rather than one at a time.
    const windowFrames = Math.round(REPLAY_WINDOW_S / REPLAY_SAMPLE_PERIOD_S);
    const slackFrames = Math.round(REPLAY_PRUNE_SLACK_S / REPLAY_SAMPLE_PERIOD_S);
    expect(rec.lastFrame - rec.firstFrame).toBeGreaterThanOrEqual(windowFrames);
    expect(rec.lastFrame - rec.firstFrame).toBeLessThanOrEqual(windowFrames + slackFrames);
    // The track was trimmed from the front rather than restarted.
    const track = rec.tracks[0]!;
    expect(track.startFrame).toBe(rec.firstFrame);
    expect(track.x.length).toBe(rec.lastFrame - rec.firstFrame + 1);
    // And the opening line has aged out with the frames it belonged to.
    expect(rec.messages).toEqual([]);
  });

  it('keeps the stats that were still in force when the window slid', () => {
    const world = quietWorld();
    const rec = createRecording();
    world.stats.landings = 4;
    fastForward(world, rec, 60);
    fastForward(world, rec, REPLAY_WINDOW_S + 300);
    const replayed = worldAtFrame(rec, rec.firstFrame, {
      selectedId: null,
      paused: true,
      timeScale: 1,
    });
    // The snapshot recording those landings is older than the window, but it is
    // the state the recording opens in, so it is kept rather than pruned.
    expect(replayed.stats.landings).toBe(4);
  });
});

describe('the transport', () => {
  it('plays from the start of the recording and stops at its end', () => {
    const { rec } = session(20);
    const playback = createPlayback(rec);
    expect(playback.timeS).toBeCloseTo(0, 6);
    expect(playback.paused).toBe(false);

    playback.advance(30);
    expect(playback.timeS).toBeCloseTo(playback.endS, 6);
    expect(playback.atEnd).toBe(true);
    // Sitting at the end still playing reads as a stall.
    expect(playback.paused).toBe(true);
  });

  it('skips and scrubs within the recording, never past it', () => {
    const { rec } = session(40);
    const playback = createPlayback(rec);
    playback.seekTo(30);
    playback.skip(10);
    expect(playback.timeS).toBeCloseTo(playback.endS, 6);
    playback.skip(-1000);
    expect(playback.timeS).toBeCloseTo(playback.startS, 6);
  });

  it('scales the clock by the chosen rate, and choosing one plays', () => {
    const { rec } = session(60);
    const playback = createPlayback(rec);
    playback.togglePause();
    expect(playback.paused).toBe(true);

    playback.setRate(4);
    expect(playback.paused).toBe(false);
    playback.advance(2);
    expect(playback.timeS).toBeCloseTo(8, 6);
  });

  it('starts over when play is pressed at the end', () => {
    const { rec } = session(20);
    const playback = createPlayback(rec);
    playback.advance(60);
    playback.togglePause();
    expect(playback.timeS).toBeCloseTo(playback.startS, 6);
    expect(playback.paused).toBe(false);
  });

  it("shows no selection outside the aircraft's life, and gets it back inside", () => {
    const world = createWorld(SCENARIO, 7);
    const rec = createRecording();
    runRecorded(world, rec, 30);
    const ac = world.aircraft[0]!;
    runRecorded(world, rec, 30);

    const playback = createPlayback(rec);
    playback.selectedId = ac.id;
    playback.seekTo(2); // before that aircraft was handed over
    const early = playback.view();
    expect(early.world.selectedId).toBeNull();
    expect(early.path).toBeNull();

    // The choice survives the scrub: a replay opens before almost everything
    // was handed over, so dropping it there would deselect on the first frame.
    playback.seekTo(55);
    const later = playback.view();
    expect(later.world.selectedId).toBe(ac.id);
    expect(later.path).not.toBeNull();
  });
});

describe('the selected aircraft path', () => {
  it('splits the whole track at the instant being watched', () => {
    const { rec } = session(120);
    const track = rec.tracks.find((candidate) => candidate.x.length > 300)!;
    const frame = track.startFrame + 100;
    const path = pathFor(rec, track.id, frame)!;

    expect(path.flown.length).toBeGreaterThan(1);
    expect(path.remaining.length).toBeGreaterThan(1);
    // The two halves meet at the blip, so the join is not a visible gap.
    expect(path.flown[path.flown.length - 1]).toEqual(path.remaining[0]);
    expect(path.flown[0]!.x).toBeCloseTo(track.x[0]!, 9);
    expect(path.remaining[path.remaining.length - 1]!.x).toBeCloseTo(
      track.x[track.x.length - 1]!,
      9,
    );
  });

  it('has no path for an aircraft that is not in the frame', () => {
    const { rec } = session(60);
    expect(pathFor(rec, null, rec.lastFrame)).toBeNull();
    expect(pathFor(rec, 9999, rec.lastFrame)).toBeNull();
    const first = rec.tracks[0]!;
    expect(pathFor(rec, first.id, first.startFrame - 1)).toBeNull();
  });
});

describe('frame arithmetic', () => {
  it('maps sim time to frames and back on the sample grid', () => {
    expect(frameTimeS(5)).toBeCloseTo(1, 9);
    expect(frameAtTimeS(1)).toBe(5);
    // The nearest frame, so a scrub lands on a sample rather than between two.
    expect(frameAtTimeS(1.09)).toBe(5);
    expect(frameAtTimeS(1.11)).toBe(6);
  });
});

describe('replaying a departure', () => {
  /** A world holding exactly one departure, rolling from the threshold. */
  function departingWorld() {
    const world = quietWorld();
    const ac = createDeparture(SCENARIO, createRng(3), createTrafficState(), SCENARIO.sids[0]!, [], 0);
    world.aircraft = [ac];
    return { world, ac };
  }

  it('rebuilds it as a departure, on its SID, at the fix it was tracking', () => {
    const { world, ac } = departingWorld();
    const rec = recorded(world, 240);

    const frame = frameAtTimeS(240);
    const rebuilt = worldAtFrame(rec, frame, { selectedId: null, paused: true, timeScale: 1 });
    const copy = rebuilt.aircraft.find((other) => other.id === ac.id)!;

    // A departure has to come back *as* a departure: `sid` is what makes it
    // uncontrollable, muted and tagged DEP everywhere downstream (§4.7).
    expect(isDeparture(copy)).toBe(true);
    expect(copy.sid!.route.name).toBe(ac.sid!.route.name);
    expect(activeSidFix(copy.sid!).name).toBe(activeSidFix(ac.sid!).name);
    expect(copy.sid!.complete).toBe(ac.sid!.complete);
    expect(copy.phase).toBe(ac.phase);
    expect(copy.altitudeFt).toBeCloseTo(ac.altitudeFt, 6);
    expect(copy.x).toBeCloseTo(ac.x, 6);
    expect(copy.y).toBeCloseTo(ac.y, 6);
  });

  it('rebuilds the take-off roll, ground speed and all', () => {
    const { world, ac } = departingWorld();
    const rec = recorded(world, 10);
    const rebuilt = worldAtFrame(rec, frameAtTimeS(10), {
      selectedId: null,
      paused: true,
      timeScale: 1,
    });
    const copy = rebuilt.aircraft[0]!;

    expect(ac.phase).toBe('roll');
    expect(copy.phase).toBe('roll');
    expect(copy.altitudeFt).toBe(0);
    expect(copy.iasKts).toBeCloseTo(ac.iasKts, 6);
  });

  it('carries the departure flow through the session snapshots', () => {
    const world = createWorld(SCENARIO, 11, 25, 15);
    const rec = recorded(world, 30);
    world.departureFlowPerHour = 5;
    runRecorded(world, rec, 30);

    const early = worldAtFrame(rec, frameAtTimeS(20), {
      selectedId: null,
      paused: true,
      timeScale: 1,
    });
    const late = worldAtFrame(rec, frameAtTimeS(55), {
      selectedId: null,
      paused: true,
      timeScale: 1,
    });
    expect(early.departureFlowPerHour).toBe(15);
    expect(late.departureFlowPerHour).toBe(5);
  });

  it('carries the hold-short queue, which has no aircraft to rebuild it from', () => {
    // The queue is a live gauge rather than a tally, and the aircraft in it are
    // not on the scope, so nothing in a rebuilt frame could recompute it — it
    // has to be in the snapshot or the replay's stats gutter reads zero (§4.7).
    const world = createWorld(SCENARIO, 11, 25, 20);
    const rec = recorded(world, 10);
    world.traffic.departureQueue = 4;
    // Hold the runway so the queue is still four deep when the frame is taken.
    world.traffic.lastLandingS = world.timeS;
    runRecorded(world, rec, 10);

    const view = { selectedId: null, paused: true, timeScale: 1 };
    expect(departureQueueLength(worldAtFrame(rec, frameAtTimeS(5), view))).toBe(0);
    expect(departureQueueLength(worldAtFrame(rec, frameAtTimeS(19), view))).toBe(4);
  });
});
