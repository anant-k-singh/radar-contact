/**
 * The zoom is a property of the projection, and the projection is pure — so the
 * invariants the feature rests on are testable without a canvas.
 *
 * Two of them carry the whole design: the anchored point does not move under a
 * pinch, and the circle does not move at any zoom.
 */
import { describe, expect, it } from 'vitest';
import {
  clampZoom,
  createProjection,
  DEFAULT_VIEWPORT,
  focusHolding,
  MAX_ZOOM,
  toScreen,
  toWorld,
  type Viewport,
} from '../src/render/project.js';
import { LIVE_RENDER } from '../src/render/scope.js';
import { drawTraffic } from '../src/render/trafficLayer.js';
import { makeAircraft, quietWorld, SCENARIO } from './helpers.js';

const AIRSPACE = SCENARIO.airspace;
const W = 1200;
const H = 800;

const project = (viewport: Viewport = DEFAULT_VIEWPORT) =>
  createProjection(AIRSPACE, W, H, viewport);

/** Pinch about a screen point, the way `Scope.zoomAt` does. */
function pinch(viewport: Viewport, sx: number, sy: number, factor: number): Viewport {
  const p = createProjection(AIRSPACE, W, H, viewport);
  const zoom = clampZoom(viewport.zoom * factor);
  return { zoom, focus: focusHolding(p, sx, sy, zoom) };
}

describe('zooming the scope', () => {
  it('is the identity at rest', () => {
    const p = project();
    expect(p.pxPerNm).toBe(p.base.pxPerNm);
    expect(p.cx).toBe(p.base.cx);
    expect(p.cy).toBe(p.base.cy);
  });

  it('holds the pinched point still, which is what makes it feel anchored', () => {
    // A point well off centre, so a zoom about the airport would visibly move it.
    const sx = 400;
    const sy = 250;
    const before = toWorld(project(), sx, sy);

    const zoomed = project(pinch(DEFAULT_VIEWPORT, sx, sy, 1.7));
    const after = toWorld(zoomed, sx, sy);

    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it('leaves the circle where it is at every zoom — only the content moves', () => {
    const rest = project();
    for (const zoom of [1, 1.3, MAX_ZOOM]) {
      const p = project(pinch(DEFAULT_VIEWPORT, 300, 300, zoom));
      expect(p.base.cx).toBe(rest.base.cx);
      expect(p.base.cy).toBe(rest.base.cy);
      expect(p.base.pxPerNm).toBe(rest.base.pxPerNm);
    }
  });

  it('magnifies the content: two fixes drawn further apart, by the zoom', () => {
    const a = { x: 3, y: 4 };
    const b = { x: -2, y: 6 };
    const gap = (v: Viewport) => {
      const p = project(v);
      const sa = toScreen(p, a);
      const sb = toScreen(p, b);
      return Math.hypot(sa.x - sb.x, sa.y - sb.y);
    };
    expect(gap(pinch(DEFAULT_VIEWPORT, 300, 300, 2))).toBeCloseTo(gap(DEFAULT_VIEWPORT) * 2, 6);
  });

  it('will not zoom out past the fitted view, or in past the stop', () => {
    expect(clampZoom(0.4)).toBe(1);
    expect(clampZoom(99)).toBe(MAX_ZOOM);
  });

  it('does not creep sideways once the gesture is pushing past the stop', () => {
    // Pinching out hard, then further, must not walk the view: the clamp is
    // applied before the focus is derived, so the second gesture is a no-op.
    let v = pinch(DEFAULT_VIEWPORT, 500, 300, 4);
    expect(v.zoom).toBe(MAX_ZOOM);
    const focus = v.focus;
    v = pinch(v, 500, 300, 4);
    expect(v.focus.x).toBeCloseTo(focus.x, 9);
    expect(v.focus.y).toBeCloseTo(focus.y, 9);
  });

  it('reverses exactly, so a pinch out and back lands where it started', () => {
    const v = pinch(pinch(DEFAULT_VIEWPORT, 420, 380, 1.9), 420, 380, 1 / 1.9);
    expect(v.zoom).toBeCloseTo(1, 9);
    const p = project(v);
    expect(p.cx).toBeCloseTo(p.base.cx, 6);
    expect(p.cy).toBeCloseTo(p.base.cy, 6);
  });

  it('keeps the airspace clear of the stats gutter when magnified', () => {
    // The gutter is reserved before the zoom is folded in, so the fixed circle
    // still clears the panel — the content magnifies inside it, not under it.
    const p = project(pinch(DEFAULT_VIEWPORT, 300, 300, MAX_ZOOM));
    const rightEdge = p.base.cx + AIRSPACE.radiusNm * p.base.pxPerNm;
    expect(rightEdge).toBeLessThanOrEqual(W - 190);
  });
});

/**
 * The requirement the zoom exists to satisfy: the content spreads out, and
 * nothing *drawn* gets bigger. Positions come from `pxPerNm`; glyphs, fonts and
 * line widths are pixel constants that never consult it. That is the seam, so
 * this asserts it against the real traffic layer rather than trusting it.
 */
describe('what zooming does not scale', () => {
  it('draws every line width and font identically at 1x and 2x', () => {
    const world = quietWorld();
    world.aircraft.push(makeAircraft({ x: 5, y: 6 }), makeAircraft({ x: 7, y: 9 }));

    const styling = (viewport: Viewport): string[] => {
      const calls: string[] = [];
      const ctx = new Proxy({} as Record<string, unknown>, {
        get(target, key: string) {
          if (key === 'canvas') return { width: W, height: H };
          if (key === 'measureText') return () => ({ width: 30 });
          if (key in target) return target[key];
          return () => {};
        },
        set(target, key: string, value: unknown) {
          target[key] = value;
          if (key === 'lineWidth' || key === 'font') calls.push(`${key}=${String(value)}`);
          return true;
        },
      }) as unknown as CanvasRenderingContext2D;
      drawTraffic(ctx, world, createProjection(AIRSPACE, W, H, viewport), LIVE_RENDER);
      return calls;
    };

    const flat = styling(DEFAULT_VIEWPORT);
    expect(flat.length).toBeGreaterThan(0);
    expect(styling({ zoom: MAX_ZOOM, focus: { x: 0, y: 0 } })).toEqual(flat);
  });
});
