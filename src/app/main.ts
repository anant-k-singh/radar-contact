/*!
 * @license AGPL-3.0-or-later
 * Approach Radar — Copyright (C) 2026 Anant Kumar Singh
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
 */
import '../style.css';

import { bindKeyboard } from '../input/keyboard.js';
import { bindPointer } from '../input/pointer.js';
import { createScope } from '../render/scope.js';
import { createSidebar } from '../render/sidebar.js';
import {
  FLOW_MAX_PER_HOUR,
  FLOW_MIN_PER_HOUR,
  PHYSICS_DT,
  RENDER_FPS,
} from '../sim/constants.js';
import { clamp } from '../sim/units.js';
import { createWorld, log, step, type World } from '../sim/world.js';

const canvas = document.getElementById('scope') as HTMLCanvasElement | null;
const sidebarRoot = document.getElementById('sidebar');
if (!canvas || !sidebarRoot) throw new Error('missing #scope or #sidebar');

/** ?seed=123 makes a session reproducible. */
function initialSeed(): number {
  const fromUrl = new URLSearchParams(window.location.search).get('seed');
  const parsed = fromUrl === null ? Number.NaN : Number.parseInt(fromUrl, 10);
  return Number.isFinite(parsed) ? parsed : Math.floor(Math.random() * 2 ** 31);
}

function start(seed: number, flowPerHour?: number): World {
  const created = createWorld(seed, flowPerHour);
  log(created, `Session seed ${seed}. Arrivals inbound — good luck.`, 'system');
  return created;
}

let world = start(initialSeed());

const scope = createScope(canvas);
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
  restart: () => {
    world = start(Math.floor(Math.random() * 2 ** 31), world.flowPerHour);
  },
});

bindKeyboard({
  world: () => world,
  togglePause: () => {
    world.paused = !world.paused;
  },
  setTimeScale: (scale) => {
    world.timeScale = scale;
  },
});
bindPointer(canvas, scope, () => world);

// Dev-only handle for the console and for automated driving. Stripped from
// production builds; the getter keeps it valid across a restart.
if (import.meta.env.DEV) {
  Object.defineProperty(window, 'atc', { get: () => world });
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

  if (!world.paused) {
    accumulatorS += realDtS * world.timeScale;
    let steps = 0;
    while (accumulatorS >= PHYSICS_DT && steps < MAX_STEPS_PER_FRAME) {
      step(world, PHYSICS_DT);
      accumulatorS -= PHYSICS_DT;
      steps += 1;
    }
    if (steps >= MAX_STEPS_PER_FRAME) accumulatorS = 0;
  }

  if (nowMs - lastRenderMs >= RENDER_INTERVAL_MS) {
    scope.render(world);
    sidebar.update(world);
    lastRenderMs = nowMs;
  }

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
