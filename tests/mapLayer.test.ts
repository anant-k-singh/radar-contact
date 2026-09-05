/**
 * The map layer draws to a canvas, so what is testable about it is *where* it puts
 * things — recorded off a stub context — rather than the pixels that come out.
 *
 * The one invariant here carries a real bug: a gate sits on the boundary and its
 * label is offset outward from the marker, so anything that clips the gates to the
 * airspace circle erases the label while leaving the diamond visible.
 */
import { describe, expect, it } from 'vitest';
import { draw, sidFixLabels } from '../src/render/mapLayer.js';
import { drawSidHover, sidUnderPointer } from '../src/render/sidHover.js';
import { drawTraffic } from '../src/render/trafficLayer.js';
import { LIVE_RENDER } from '../src/render/scope.js';
import {
  createProjection,
  DEFAULT_VIEWPORT,
  toScreen,
  MAX_ZOOM,
  STATS_GUTTER_PX,
  type Viewport,
} from '../src/render/project.js';
import { SCENARIOS } from '../src/scenario/registry.js';
import type { Scenario } from '../src/scenario/types.js';
import { makeAircraft, quietWorld } from './helpers.js';

const W = 1200;
const H = 800;

interface TextDraw {
  text: string;
  x: number;
  y: number;
  /** Whether a clip was in force when this was drawn, and to what. */
  clip: Clip | null;
}

/** The airspace clip: the circle intersected with the chord band. */
interface Clip {
  cx: number;
  cy: number;
  radiusPx: number;
  halfHeightPx: number;
}

/**
 * Enough of a 2D context to record what `draw` asks for.
 *
 * `clipToAirspace` states the region as an arc followed by a rect, so the stub
 * reads exactly that pair back out and tracks it across save/restore — which is
 * what lets a text draw be attributed to the clip that was in force for it.
 */
function recordingContext(): {
  ctx: CanvasRenderingContext2D;
  texts: TextDraw[];
  clips: Clip[];
} {
  const texts: TextDraw[] = [];
  const clips: Clip[] = [];
  let arc: { cx: number; cy: number; r: number } | null = null;
  let rect: { y: number; halfHeight: number } | null = null;
  let clip: Clip | null = null;
  const stack: (Clip | null)[] = [];

  const api: Record<string, unknown> = {
    save: () => stack.push(clip),
    restore: () => {
      clip = stack.length > 0 ? stack.pop()! : null;
    },
    arc: (cx: number, cy: number, r: number) => {
      arc = { cx, cy, r };
    },
    rect: (_x: number, y: number, _w: number, h: number) => {
      rect = { y, halfHeight: h / 2 };
    },
    clip: () => {
      // The circle arrives first and the chord band second; the band refines a
      // clip already set rather than replacing it.
      if (arc) clip = { cx: arc.cx, cy: arc.cy, radiusPx: arc.r, halfHeightPx: Infinity };
      if (rect && clip) clip = { ...clip, halfHeightPx: rect.halfHeight };
      if (clip) clips.push(clip);
    },
    fillText: (text: string, x: number, y: number) => texts.push({ text, x, y, clip }),
    measureText: (text: string) => ({ width: text.length * 6 }),
    canvas: { width: W, height: H },
  };

  const ctx = new Proxy(api, {
    get(target, key: string) {
      if (key in target) return target[key];
      return () => {};
    },
    set(target, key: string, value: unknown) {
      target[key] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;

  return { ctx, texts, clips };
}

/** Whether a point survives the clip that was in force — the visibility test. */
function visible(t: TextDraw): boolean {
  if (t.clip === null) return true;
  const dx = t.x - t.clip.cx;
  const dy = t.y - t.clip.cy;
  return Math.hypot(dx, dy) <= t.clip.radiusPx && Math.abs(dy) <= t.clip.halfHeightPx;
}

const render = (scenario: Scenario, viewport: Viewport = DEFAULT_VIEWPORT): TextDraw[] => {
  const { ctx, texts } = recordingContext();
  draw(ctx, scenario, createProjection(scenario.airspace, W, H, viewport));
  return texts;
};

describe.each(SCENARIOS.map((s) => [s.id, s] as const))('the %s chart', (_id, scenario) => {
  // The rule, swept rather than sampled: no label anywhere on the layer may be
  // cut by the clip, at any zoom. This is what the three hand-fixed symptoms had
  // in common, and at 1x it passes trivially — the bug only exists magnified,
  // which is why 61 clipped labels across the two fields went unnoticed.
  it.each([1, MAX_ZOOM])('never lets the clip cut a label at %sx', (zoom) => {
    const cut = render(scenario, { zoom, focus: { x: 0, y: 0 } })
      .filter((t) => !visible(t))
      .map((t) => t.text);
    expect(cut, `clipped away: ${cut.join(', ')}`).toEqual([]);
  });

  // Every field's gates sit on the boundary by construction, so this is the
  // conformance form of the bug rather than one field's snapshot.
  it.each(scenario.gates.map((g) => g.name))('labels the %s gate where it can be seen', (name) => {
    const label = render(scenario).find((t) => t.text === name);
    expect(label, `no label drawn for gate ${name}`).toBeDefined();
    expect(visible(label!), `gate ${name} is labelled outside the clip`).toBe(true);
  });


  it('draws the gates clear of the stats panel', () => {
    // Unclipped means nothing else is keeping them off the panel the projection
    // reserves down the right-hand edge.
    for (const gate of scenario.gates) {
      const label = render(scenario).find((t) => t.text === gate.name)!;
      expect(label.x).toBeLessThan(W - STATS_GUTTER_PX);
    }
  });

  it('withholds the gates once the scope is zoomed', () => {
    // A gate has to sit on the boundary *and* on the end of its route, and zoom
    // separates the two: the circle is fixed while the route magnifies inside it.
    // There is no frame left in which the marker is telling the truth, so it is
    // withheld rather than drawn in the wrong place.
    const zoomed = render(scenario, { zoom: MAX_ZOOM, focus: { x: 0, y: 0 } });
    for (const gate of scenario.gates) {
      expect(
        zoomed.find((t) => t.text === gate.name),
        `gate ${gate.name} is still drawn at ${MAX_ZOOM}x`,
      ).toBeUndefined();
    }
  });
});

/**
 * A data block is a label, not content: it is pixel-sized furniture pinned to a
 * blip and offset far enough that an aircraft near the edge has its block hanging
 * over the boundary. Clipping the traffic layer wholesale slices it down the
 * middle of the callsign, and does it to exactly the traffic closest to handover.
 */
describe('the data block', () => {
  /** An aircraft just inside the boundary, where its block overhangs the edge. */
  const atTheEdge = () => {
    const world = quietWorld();
    const airspace = world.scenario.airspace;
    // On the boundary's own radius, out to the east so the block is pushed at
    // the arc rather than at a chord.
    const ac = makeAircraft({ x: airspace.radiusNm - 1, y: 0, headingDeg: 90 });
    world.aircraft.push(ac);
    return world;
  };

  const blockTexts = (viewport: Viewport): TextDraw[] => {
    const world = atTheEdge();
    const { ctx, texts } = recordingContext();
    drawTraffic(ctx, world, createProjection(world.scenario.airspace, W, H, viewport), LIVE_RENDER);
    return texts;
  };

  it('is drawn in full for an aircraft against the boundary', () => {
    const texts = blockTexts(DEFAULT_VIEWPORT);
    expect(texts.length).toBeGreaterThan(0);
    for (const t of texts) {
      expect(visible(t), `block line "${t.text}" is clipped at the boundary`).toBe(true);
    }
  });

  it('leaves the blip itself clipped, so picking still matches what is drawn', () => {
    // Only the label escapes. `scope.pick` refuses an aircraft outside the drawn
    // circle, and that stays honest only while the glyph is still bounded by it.
    const world = atTheEdge();
    const { ctx, clips } = recordingContext();
    const p = createProjection(world.scenario.airspace, W, H, DEFAULT_VIEWPORT);
    drawTraffic(ctx, world, p, LIVE_RENDER);
    expect(clips.length, 'the traffic layer set no clip at all').toBeGreaterThan(0);
  });

  it('stays whole when the scope is zoomed', () => {
    // Zoom pushes the aircraft further out through a circle that stays put, so a
    // block clipped at rest is clipped worse here.
    const texts = blockTexts({ zoom: MAX_ZOOM, focus: { x: 0, y: 0 } });
    for (const t of texts) {
      expect(visible(t), `block line "${t.text}" is clipped at the boundary`).toBe(true);
    }
  });
});

/**
 * A label lifts the clip to draw itself, and everything the caller had set has to
 * survive the round trip.
 *
 * The centreline tick loop is what proves it: it sets the tick colour once and then
 * strokes a tick every 2 NM, printing a figure at each major one. `unclipped`
 * carried the fill and text state across but not the stroke, so the first `10`
 * printed reset `strokeStyle` and every tick beyond it was stroked in the canvas
 * default — the ILS ticks simply vanished from the scope past the first label, at
 * every zoom including 1x.
 */
describe('drawing state across a clip lift', () => {
  /** Every `stroke()` the layer issues, with the state in force at the time. */
  function strokes(scenario: Scenario) {
    const recorded: { strokeStyle: string; lineWidth: number }[] = [];
    const stack: Record<string, unknown>[] = [];
    let state: Record<string, unknown> = {
      strokeStyle: '#000000',
      lineWidth: 1,
      fillStyle: '#000000',
      globalAlpha: 1,
      font: '',
      lineCap: 'butt',
      lineJoin: 'miter',
      textAlign: 'start',
      textBaseline: 'alphabetic',
    };
    const ctx = new Proxy({} as Record<string, unknown>, {
      get(_target, key: string) {
        if (key === 'canvas') return { width: W, height: H };
        if (key === 'measureText') return () => ({ width: 20 });
        if (key === 'save') return () => void stack.push({ ...state });
        if (key === 'restore')
          return () => {
            const popped = stack.pop();
            if (popped) state = popped;
          };
        if (key === 'stroke')
          return () =>
            void recorded.push({
              strokeStyle: String(state.strokeStyle),
              lineWidth: Number(state.lineWidth),
            });
        if (key in state) return state[key];
        return () => {};
      },
      set(_target, key: string, value: unknown) {
        state[key] = value;
        return true;
      },
    }) as unknown as CanvasRenderingContext2D;

    draw(ctx, scenario, createProjection(scenario.airspace, W, H, DEFAULT_VIEWPORT));
    return recorded;
  }

  for (const scenario of SCENARIOS) {
    it(`${scenario.id} strokes nothing in the default colour`, () => {
      // Every line this layer draws is themed, so a stroke left in the canvas
      // default is one whose colour was dropped — invisible on a dark scope.
      const drawn = strokes(scenario);
      expect(drawn.length).toBeGreaterThan(0);
      const lost = drawn.filter((s) => s.strokeStyle === '#000000');
      expect(lost.length, `${lost.length} strokes lost their colour across a clip lift`).toBe(0);
    });
  }
});

describe('hovering a SID', () => {
  // The chart layer thins a SID's floors down to the turns and the ends. The
  // levels are still in `scenario.sids` — the thinning is a rendering choice, not
  // a data one — and hovering is how a player asks for the rest of them.
  const LSGG = SCENARIOS.find((s) => s.id === 'LSGG')!;

  const project = (scenario: Scenario): ReturnType<typeof createProjection> =>
    createProjection(scenario.airspace, W - STATS_GUTTER_PX, H, DEFAULT_VIEWPORT);

  it('picks the SID whose track the pointer is nearest', () => {
    const p = project(LSGG);
    for (const sid of LSGG.sids) {
      // The midpoint of the route's *last* leg, which is the one place every LSGG
      // SID is on its own rather than in the shared fan out of the field.
      const a = sid.waypoints[sid.waypoints.length - 2]!.position;
      const b = sid.waypoints[sid.waypoints.length - 1]!.position;
      const mid = toScreen(p, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      expect(sidUnderPointer(LSGG, p, mid.x, mid.y)?.name, sid.name).toBe(sid.name);
    }
  });

  it('resolves a shared leg by which track is nearer', () => {
    // Four of LSGG's five SIDs run out to PAS together, so a pointer in that fan
    // is near several tracks at once. Nearest has to win: taking the first match
    // in registration order would make the other three unhoverable near the field.
    const p = project(LSGG);
    const shared = LSGG.sids.filter((s) => s.waypoints[1]!.name === 'PAS');
    expect(shared.length, 'LSGG should still have a shared departure fan').toBeGreaterThan(1);

    for (const sid of shared) {
      // Just past the shared fix, on this route's own second leg, where the
      // tracks have begun to diverge but are still within a hover of each other.
      const from = sid.waypoints[1]!.position;
      const to = sid.waypoints[2]!.position;
      const near = { x: from.x + (to.x - from.x) * 0.15, y: from.y + (to.y - from.y) * 0.15 };
      const screen = toScreen(p, near);
      expect(sidUnderPointer(LSGG, p, screen.x, screen.y)?.name, sid.name).toBe(sid.name);
    }
  });

  it('picks nothing out in open airspace', () => {
    const p = project(LSGG);
    const centre = toScreen(p, { x: 0, y: 0 });
    // Well off any track, but still on the scope.
    expect(sidUnderPointer(LSGG, p, centre.x + 200, centre.y)).toBeNull();
  });

  it('prints every fix name, and the levels the chart thinned away', () => {
    const p = project(LSGG);
    // MEDAM 1A is the case the thinning exists for: five ascending floors down a
    // line that never turns, of which the chart prints only the ends.
    const sid = LSGG.sids.find((s) => s.name === 'MEDAM1A')!;

    const chart = recordingContext();
    draw(chart.ctx, LSGG, p);
    const chartTexts = new Set(chart.texts.map((t) => t.text));

    const hover = recordingContext();
    drawSidHover(hover.ctx, p, sid);
    const hoverTexts = new Set(hover.texts.map((t) => t.text));

    // Every fix on the route is named, which the chart layer never does at all.
    for (const wpt of sid.waypoints.slice(1)) {
      expect(hoverTexts, `${wpt.name} was not named on hover`).toContain(wpt.name);
      expect(chartTexts, `${wpt.name} should not be named by the chart`).not.toContain(wpt.name);
    }

    // And every published level, all of which are new — the chart draws none.
    const levels = sidFixLabels(sid).filter((l) => l.index > 0 && l.crossing !== undefined);
    expect(levels.length, 'MEDAM1A should have levels worth revealing').toBeGreaterThan(0);
    for (const { wpt, crossing } of levels) {
      expect(hoverTexts, `${wpt.name}'s ${crossing} was not revealed`).toContain(crossing!);
    }
  });

  it('prints no SID figure on the chart itself, at any field', () => {
    // A SID is rings and a track; its levels are read by hovering it. This is the
    // invariant that replaced the thinning rule — floors at a turn and the ends,
    // ceilings always — and it is stated over every field rather than one, since
    // the old rule was per-fix and this one is not a rule at all.
    for (const scenario of SCENARIOS) {
      const chart = recordingContext();
      draw(chart.ctx, scenario, project(scenario));
      const printed = new Set(chart.texts.map((t) => t.text));

      for (const sid of scenario.sids) {
        for (const { index, wpt, crossing } of sidFixLabels(sid)) {
          if (index === 0) continue;
          expect(printed, `${scenario.id} ${sid.name}: ${wpt.name} was named`).not.toContain(
            wpt.name,
          );
          // The figure may legitimately collide with a STAR's — VABB crosses 9000
          // both ways — so this asks whether the SID's *own* fix printed one, by
          // checking the position rather than the string.
          if (crossing === undefined) continue;
          const at = toScreen(project(scenario), wpt.position);
          const near = chart.texts.filter(
            (t) => t.text === crossing && Math.hypot(t.x - at.x, t.y - at.y) < 20,
          );
          expect(near, `${scenario.id} ${sid.name}: ${wpt.name} printed ${crossing}`).toEqual([]);
        }
      }
    }
  });
});
