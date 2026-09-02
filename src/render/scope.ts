/** Canvas plumbing: sizing, DPR, layer order, and hit testing. */
import type { Aircraft } from '../sim/aircraft.js';
import { messagesFor, type World } from '../sim/world.js';
import { mapLayer } from './mapLayer.js';
import { createLogScroll, drawMessages, drawStatusLine, scrollLog } from './messageLog.js';
import { drawTrackPath, type TrackPathView } from './pathLayer.js';
import type { Airspace } from '../scenario/types.js';
import { createProjection, screenX, screenY, type Projection } from './project.js';
import { drawStats } from './statsLayer.js';
import { drawTraffic, type Rect } from './trafficLayer.js';

const HIT_RADIUS_PX = 15;

/**
 * What the scope draws beyond the traffic itself. The defaults are the live
 * session; a replay switches off the two things that only exist because the
 * player is controlling the aircraft, and switches on the selected aircraft's
 * whole path instead (docs §17.3).
 */
export interface RenderOptions {
  /** The one-minute leader line ahead of each blip. */
  leaderLines: boolean;
  /** The dashed vector showing an assigned heading after a turn is given. */
  headingHints: boolean;
  /** Whole recorded path of the selected aircraft, drawn under the traffic. */
  path: TrackPathView | null;
  /** Marks the status line, so a replay is never mistaken for a live scope. */
  mode: 'live' | 'replay';
}

export const LIVE_RENDER: RenderOptions = {
  leaderLines: true,
  headingHints: true,
  path: null,
  mode: 'live',
};

export interface Scope {
  render(world: World, options?: RenderOptions): void;
  /** Aircraft under a click, or null. Blips and data blocks are both clickable. */
  pick(world: World, clientX: number, clientY: number): Aircraft | null;
  /** Whether a point is over the message log, so a wheel can be aimed at it. */
  overMessages(clientX: number, clientY: number): boolean;
  /**
   * Wheel the message log back by whole lines, positive being back in time.
   *
   * The offset is view state and lives here rather than on the world: a replay
   * frame is rebuilt every redraw, so anything written onto it is lost (§17.3)
   * — the same reason playback holds its own selection.
   */
  scrollMessages(world: World, lines: number): void;
}

export function createScope(canvas: HTMLCanvasElement): Scope {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');

  let projection: Projection | null = null;
  let blocks = new Map<number, Rect>();
  const logScroll = createLogScroll();
  /** Selection the log offset was taken against — a new one is a new log. */
  let logScrollSelection: number | null = null;

  const resize = (airspace: Airspace): Projection => {
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const pixelWidth = Math.max(1, Math.round(width * dpr));
    const pixelHeight = Math.max(1, Math.round(height * dpr));
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    projection = createProjection(airspace, width, height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return projection;
  };

  return {
    render(world: World, options: RenderOptions = LIVE_RENDER): void {
      const p = resize(world.scenario.airspace);
      const dpr = window.devicePixelRatio || 1;
      ctx.drawImage(mapLayer(world.scenario, p, dpr), 0, 0, p.width, p.height);
      if (options.path) drawTrackPath(ctx, options.path, p);
      blocks = drawTraffic(ctx, world, p, options);
      drawStatusLine(ctx, world, options.mode);
      drawStats(ctx, world, p);
      // The log is filtered by the selection (§7.1), so changing selection
      // replaces the list under the offset — holding it would leave the new
      // aircraft's exchange scrolled back for no reason the player asked for.
      if (world.selectedId !== logScrollSelection) {
        logScroll.offset = 0;
        logScrollSelection = world.selectedId;
      }
      drawMessages(ctx, world, p, logScroll);
    },

    pick(world: World, clientX: number, clientY: number): Aircraft | null {
      // Hit testing projects forward, so it needs the same frame the last render
      // used. Nothing can be picked before something has been drawn.
      const p = projection ?? resize(world.scenario.airspace);
      const rect = canvas.getBoundingClientRect();
      const px = clientX - rect.left;
      const py = clientY - rect.top;

      let best: Aircraft | null = null;
      let bestDistance = HIT_RADIUS_PX;
      for (const ac of world.aircraft) {
        const distance = Math.hypot(screenX(p, ac.x) - px, screenY(p, ac.y) - py);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = ac;
        }
      }
      if (best) return best;

      for (const ac of world.aircraft) {
        const block = blocks.get(ac.id);
        if (!block) continue;
        if (px >= block.x && px <= block.x + block.w && py >= block.y && py <= block.y + block.h) {
          return ac;
        }
      }
      return null;
    },

    overMessages(clientX: number, clientY: number): boolean {
      // Nothing is over the log before one has been drawn.
      const area = logScroll.area;
      if (!area) return false;
      const rect = canvas.getBoundingClientRect();
      const px = clientX - rect.left;
      const py = clientY - rect.top;
      return px >= area.x && px <= area.x + area.w && py >= area.y && py <= area.y + area.h;
    },

    scrollMessages(world: World, lines: number): void {
      scrollLog(logScroll, lines, messagesFor(world).length);
    },
  };
}
