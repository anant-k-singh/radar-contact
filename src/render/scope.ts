/** Canvas plumbing: sizing, DPR, layer order, and hit testing. */
import type { Aircraft } from '../sim/aircraft.js';
import type { World } from '../sim/world.js';
import { mapLayer } from './mapLayer.js';
import { drawMessages, drawStatusLine } from './messageLog.js';
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
}

export function createScope(canvas: HTMLCanvasElement): Scope {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');

  let projection: Projection | null = null;
  let blocks = new Map<number, Rect>();

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
      drawMessages(ctx, world, p);
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
  };
}
