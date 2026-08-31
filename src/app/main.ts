/*!
 * @license AGPL-3.0-or-later
 * Radar Contact — Copyright (C) 2026 Anant Kumar Singh
 * Source: https://github.com/anant-k-singh/radar-contact
 *
 * Free software under the GNU Affero General Public License v3 or later. If you
 * run a modified version of this program for users over a network, AGPL §13
 * requires you to offer those users its complete corresponding source.
 */
/**
 * Wiring and the loop: 20 Hz fixed-timestep physics, 20 fps redraw.
 * The 1 Hz radar sample happens inside step() against sim time, so it scales
 * correctly with time acceleration (docs §5).
 *
 * The loop runs one of two things, never both: the live session, or a replay of
 * what it recorded (§17). Input, the scope and the sidebar are bound once and
 * routed through a `SessionController`, so neither of them has to know which.
 */
import '../style.css';

import type { SessionController } from '../input/controller.js';
import { bindKeyboard } from '../input/keyboard.js';
import { bindPointer } from '../input/pointer.js';
import { createScope, LIVE_RENDER, type RenderOptions } from '../render/scope.js';
import { createSidebar } from '../render/sidebar.js';
import { createPlayback, type Playback } from '../replay/playback.js';
import { createRecording, hasFrames, sample } from '../replay/recorder.js';
import { createReplayBar } from '../replay/replayBar.js';
import {
  DEPARTURE_FLOW_MAX_PER_HOUR,
  DEPARTURE_FLOW_MIN_PER_HOUR,
  FLOW_MAX_PER_HOUR,
  FLOW_MIN_PER_HOUR,
  PHYSICS_DT,
  RENDER_FPS,
} from '../sim/constants.js';
import { clamp } from '../sim/units.js';
import { DEFAULT_SCENARIO } from '../scenario/registry.js';
import { createWorld, log, step, type World } from '../sim/world.js';

/** The field this session is flying. Fixed for the life of the page (§3). */
const SCENARIO = DEFAULT_SCENARIO;

const canvas = document.getElementById('scope') as HTMLCanvasElement | null;
const sidebarRoot = document.getElementById('sidebar');
const replayRoot = document.getElementById('replay');
if (!canvas || !sidebarRoot || !replayRoot) {
  throw new Error('missing #scope, #sidebar or #replay');
}

/** ?seed=123 makes a session reproducible. */
function initialSeed(): number {
  const fromUrl = new URLSearchParams(window.location.search).get('seed');
  const parsed = fromUrl === null ? Number.NaN : Number.parseInt(fromUrl, 10);
  return Number.isFinite(parsed) ? parsed : Math.floor(Math.random() * 2 ** 31);
}

function start(seed: number, flowPerHour?: number, departureFlowPerHour?: number): World {
  const created = createWorld(SCENARIO, seed, flowPerHour, departureFlowPerHour);
  log(created, `Session seed ${seed}. Arrivals inbound — good luck.`, 'system');
  return created;
}

let world = start(initialSeed());
/** The rolling recording of the live session — memory only, lost on refresh. */
let recording = createRecording();
/** Non-null once the session has been stopped and its recording is playing. */
let playback: Playback | null = null;
/** Whatever was last drawn, which is what a click is hit-tested against. */
let viewWorld: World = world;

const scope = createScope(canvas);

const REPLAY_RENDER: RenderOptions = {
  // Both of these exist to show what the controller has just told an aircraft
  // to do. Nothing is being told anything in a replay (§17.3).
  leaderLines: false,
  headingHints: false,
  path: null,
  mode: 'replay',
};

function newSession(): void {
  playback = null;
  recording = createRecording();
  world = start(Math.floor(Math.random() * 2 ** 31), world.flowPerHour, world.departureFlowPerHour);
  viewWorld = world;
}

const sidebar = createSidebar(sidebarRoot, {
  togglePause: () => {
    world.paused = !world.paused;
  },
  setTimeScale: (scale) => {
    world.timeScale = scale;
  },
  adjustFlow: (delta) => {
    world.flowPerHour = clamp(world.flowPerHour + delta, FLOW_MIN_PER_HOUR, FLOW_MAX_PER_HOUR);
  },
  adjustDepartureFlow: (delta) => {
    world.departureFlowPerHour = clamp(
      world.departureFlowPerHour + delta,
      DEPARTURE_FLOW_MIN_PER_HOUR,
      DEPARTURE_FLOW_MAX_PER_HOUR,
    );
  },
  restart: newSession,
});

const replayBar = createReplayBar(replayRoot, {
  startReplay: () => {
    // Nothing recorded yet — the first frame is 0.2 s in, so this only happens
    // on a click in the first instant of a session.
    if (!hasFrames(recording)) return;
    playback = createPlayback(recording);
    // Carry the selection across: whoever was being watched is who the replay
    // opens on.
    playback.selectedId = world.selectedId;
  },
  newSession,
});

const liveController: SessionController = {
  world: () => world,
  select: (id) => {
    world.selectedId = id;
  },
  togglePause: () => {
    world.paused = !world.paused;
  },
  setTimeScale: (scale) => {
    world.timeScale = scale;
  },
  skip: () => {
    // A live session has no recorded future to skip to.
  },
  acceptsInstructions: true,
};

const replayController: SessionController = {
  world: () => viewWorld,
  select: (id) => {
    if (playback) playback.selectedId = id;
  },
  togglePause: () => playback?.togglePause(),
  setTimeScale: (scale) => playback?.setRate(scale),
  skip: (deltaS) => playback?.skip(deltaS),
  acceptsInstructions: false,
};

const controller = (): SessionController => (playback ? replayController : liveController);

bindKeyboard(controller);
bindPointer(canvas, scope, controller);

// Dev-only handle for the console and for automated driving. Stripped from
// production builds; the getter keeps it valid across a restart.
if (import.meta.env.DEV) {
  Object.defineProperty(window, 'atc', { get: () => world });
  Object.defineProperty(window, 'atcRecording', { get: () => recording });
}

const RENDER_INTERVAL_MS = 1000 / RENDER_FPS;
/** Cap catch-up work so a backgrounded tab cannot stall the main thread on return. */
const MAX_STEPS_PER_FRAME = 400;

let lastFrameMs = performance.now();
let accumulatorS = 0;
let lastRenderMs = 0;

function frame(nowMs: number): void {
  const realDtS = Math.min(0.25, (nowMs - lastFrameMs) / 1000);
  lastFrameMs = nowMs;

  if (playback) {
    playback.advance(realDtS);
  } else if (!world.paused) {
    accumulatorS += realDtS * world.timeScale;
    let steps = 0;
    while (accumulatorS >= PHYSICS_DT && steps < MAX_STEPS_PER_FRAME) {
      step(world, PHYSICS_DT);
      // Sampled inside the step loop rather than once a frame, so the recording
      // is paced by sim time: 8× acceleration records eight times as much
      // session, at the same detail, per real second.
      sample(recording, world);
      accumulatorS -= PHYSICS_DT;
      steps += 1;
    }
    if (steps >= MAX_STEPS_PER_FRAME) accumulatorS = 0;
  }

  if (nowMs - lastRenderMs >= RENDER_INTERVAL_MS) {
    if (playback) {
      const view = playback.view();
      viewWorld = view.world;
      scope.render(view.world, { ...REPLAY_RENDER, path: view.path });
      sidebar.update(view.world, 'replay');
    } else {
      viewWorld = world;
      scope.render(world, LIVE_RENDER);
      sidebar.update(world, 'live');
    }
    replayBar.update(recording, playback);
    lastRenderMs = nowMs;
  }

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
