/** Canvas plumbing: sizing, DPR, layer order, and hit testing. */
import type { Aircraft } from '../sim/aircraft.js';
import { messagesFor, type World } from '../sim/world.js';
import { clipped } from './clip.js';
import { clipToAirspace, mapLayer } from './mapLayer.js';
import { createLogScroll, drawMessages, drawStatusLine, scrollLog } from './messageLog.js';
import { drawTrackPath, type TrackPathView } from './pathLayer.js';
import type { Airspace } from '../scenario/types.js';
import {
  clampZoom,
  createProjection,
  DEFAULT_VIEWPORT,
  focusHolding,
  screenX,
  screenY,
  type Projection,
  type Viewport,
} from './project.js';
import { drawStats } from './statsLayer.js';
import { drawTraffic, type Rect } from './trafficLayer.js';

const HIT_RADIUS_PX = 15;

/**
 * Whether a screen point falls inside the drawn boundary — the circle cut by its
 * two chords (§3.1), measured in the fixed base frame.
 *
 * The mirror of `clipToAirspace`: that decides what is painted, this decides what
 * can be clicked, and they have to agree or the controller can select a blip that
 * is not on the scope.
 */
function isOnScope(airspace: Airspace, p: Projection, sx: number, sy: number): boolean {
  const radiusPx = airspace.radiusNm * p.base.pxPerNm;
  const dx = sx - p.base.cx;
  const dy = sy - p.base.cy;
  return (
    dx * dx + dy * dy <= radiusPx * radiusPx &&
    Math.abs(dy) <= airspace.halfHeightNm * p.base.pxPerNm
  );
}

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
   * Magnify about a screen point, holding whatever is under it in place — a pinch
   * on a trackpad, which is how the controller pulls apart a pair that has become
   * one smear. The circle does not move; only the content inside it.
   */
  zoomAt(world: World, clientX: number, clientY: number, factor: number): void;
  /** Back to the fitted view. The excursion is meant to be temporary. */
  resetZoom(): void;
  /** Whether the scope is magnified, so a reset can be offered only when it does something. */
  isZoomed(): boolean;
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
  /**
   * View state, like the log offset below it and for the same reason: a replay
   * frame is rebuilt every redraw, so this cannot live on the world (§17.3). It
   * is deliberately not recorded — where the controller looked is not what the
   * aircraft did.
   */
  let viewport: Viewport = DEFAULT_VIEWPORT;
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
    projection = createProjection(airspace, width, height, viewport);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return projection;
  };

  return {
    render(world: World, options: RenderOptions = LIVE_RENDER): void {
      const p = resize(world.scenario.airspace);
      const dpr = window.devicePixelRatio || 1;
      ctx.drawImage(mapLayer(world.scenario, p, dpr), 0, 0, p.width, p.height);
      // The track path is content, so it is clipped to the same fixed circle the
      // map layer clips to. An aircraft magnified outside the boundary stops
      // being drawn; it is still flying, still logging and still recorded —
      // clipping is a rendering bound, and `src/sim/` cannot see it.
      if (options.path) {
        clipped(ctx, (c) => clipToAirspace(c, world.scenario, p), () =>
          drawTrackPath(ctx, options.path!, p),
        );
      }
      // Clips itself, because its labels have to lift that clip (`clip.ts`).
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

      // Only what is drawn can be clicked. The bound is the *drawn* circle at the
      // current zoom, not the airspace: those coincide at 1x and come apart the
      // moment the content is magnified inside a fixed frame.
      const visible = (ac: Aircraft): boolean =>
        isOnScope(world.scenario.airspace, p, screenX(p, ac.x), screenY(p, ac.y));

      let best: Aircraft | null = null;
      let bestDistance = HIT_RADIUS_PX;
      for (const ac of world.aircraft) {
        if (!visible(ac)) continue;
        const distance = Math.hypot(screenX(p, ac.x) - px, screenY(p, ac.y) - py);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = ac;
        }
      }
      if (best) return best;

      for (const ac of world.aircraft) {
        if (!visible(ac)) continue;
        const block = blocks.get(ac.id);
        if (!block) continue;
        if (px >= block.x && px <= block.x + block.w && py >= block.y && py <= block.y + block.h) {
          return ac;
        }
      }
      return null;
    },

    zoomAt(world: World, clientX: number, clientY: number, factor: number): void {
      const p = projection ?? resize(world.scenario.airspace);
      const rect = canvas.getBoundingClientRect();
      const zoom = clampZoom(viewport.zoom * factor);
      // Clamping first and deriving the focus from the clamped zoom is what stops
      // the view creeping sideways once the gesture is pushing past the stop.
      if (zoom === viewport.zoom) return;
      const focus =
        zoom === 1
          ? DEFAULT_VIEWPORT.focus
          : focusHolding(p, clientX - rect.left, clientY - rect.top, zoom);
      viewport = { zoom, focus };
    },

    resetZoom(): void {
      viewport = DEFAULT_VIEWPORT;
    },

    isZoomed(): boolean {
      return viewport.zoom !== 1;
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
