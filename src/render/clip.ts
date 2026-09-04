/**
 * The one rule the scope's clipping rests on: **the clip bounds geometry, never a
 * label.**
 *
 * Zoom made the two kinds different. Content is positioned in the world and
 * magnifies inside a boundary that stays put, so it has to be clipped or it spills
 * across the scope. A label is pixel-sized furniture pinned near something — a fix,
 * a blip, a ring — and its offset is measured in pixels that never consult the
 * zoom. Clip a label and it is sliced mid-glyph at the edge, which is where the
 * labels matter most: the traffic closest to handover, the fixes on the boundary.
 *
 * The distinction lives here rather than in a convention because convention is what
 * failed. `clipToAirspace` was introduced wrapped around draw calls containing both
 * kinds, and at 1x nothing was cut, so the six labels it silently ate at 2x — ring
 * figures, every compass bearing, STAR fix names and crossing altitudes — were
 * invisible until someone zoomed and looked closely. Each one found by eye was
 * fixed by hand with a `restore()`, which is a patch per symptom and no protection
 * for the next label anyone adds.
 *
 * So the clip is *self-suspending for text*: `clipped()` scopes a region and
 * `unclipped()` lifts it for one draw. Every label goes through `unclipped`, so it
 * is drawn whole no matter where the call site sits — adding a label to a clipped
 * routine cannot reintroduce the bug, because the label never sees the clip.
 *
 * [tests/architecture.test.ts](../../tests/architecture.test.ts) asserts it: no
 * text-drawing call may sit inside a clipped region except through `unclipped`.
 */

/**
 * The region currently in force per context, so `unclipped` can put back exactly
 * what it lifted. Keyed by the context rather than a module variable because the
 * map layer draws to its own offscreen canvas while the scope draws to the visible
 * one, and the two must not see each other's state.
 */
type Region = (ctx: CanvasRenderingContext2D) => void;

/**
 * The region in force per context, and how many `save` frames deep the lift has to
 * unwind. Keyed by the context rather than a module variable because the map layer
 * draws to its own offscreen canvas while the scope draws to the visible one, and
 * the two must not see each other's state.
 */
const active = new WeakMap<CanvasRenderingContext2D, { region: Region; depth: number }>();

/**
 * Frames pushed since the enclosing `clipped`, so `unclipped` knows how far to
 * unwind. Bumped by `nested`, which is how a routine that needs its own `save`
 * stays compatible with the lift.
 */
export function nested(ctx: CanvasRenderingContext2D, body: () => void): void {
  const state = active.get(ctx);
  ctx.save();
  if (state) active.set(ctx, { ...state, depth: state.depth + 1 });
  try {
    body();
  } finally {
    ctx.restore();
    if (state) active.set(ctx, state);
  }
}

/**
 * Run `body` with `region` clipping everything it draws.
 *
 * Owns the `save`/`restore` pair, so a caller cannot leak the clip into the next
 * frame — the failure a hand-written pair invites, and which an early `return` out
 * of a draw loop causes silently.
 */
export function clipped(ctx: CanvasRenderingContext2D, region: Region, body: () => void): void {
  const outer = active.get(ctx);
  ctx.save();
  region(ctx);
  active.set(ctx, { region, depth: 1 });
  try {
    body();
  } finally {
    ctx.restore();
    if (outer === undefined) active.delete(ctx);
    else active.set(ctx, outer);
  }
}

/**
 * Run `body` with any clip lifted — the escape hatch for labels, and the only one.
 *
 * Canvas cannot narrow a clip and then widen it again, so the lift is a `restore`
 * to the state `clipped` saved and a `save`/re-clip to put it back. That depends on
 * the stack being exactly where `clipped` left it, and it is not: `drawSids` pushes
 * its own frame for the SID alpha, so a naive single `restore` undid *that* and left
 * the clip in force — which is precisely how the last ten labels stayed cut.
 *
 * So the depth is measured rather than assumed. `clipped` records how deep it was,
 * and this unwinds to that depth, draws, and rebuilds — preserving the styles the
 * intervening frames carry, since a label that lost the SID alpha would be drawn at
 * full strength.
 */
/**
 * The drawing state a lift has to carry across the `restore`/`save` pair.
 *
 * Every field the layers actually set, stroke included. Listing them is what makes
 * the set reviewable — the alternative is a `restore` that silently resets whatever
 * nobody thought to name.
 */
interface DrawState {
  globalAlpha: number;
  font: string;
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
}

const snapshot = (ctx: CanvasRenderingContext2D): DrawState => ({
  globalAlpha: ctx.globalAlpha,
  font: ctx.font,
  fillStyle: ctx.fillStyle,
  strokeStyle: ctx.strokeStyle,
  lineWidth: ctx.lineWidth,
  lineCap: ctx.lineCap,
  lineJoin: ctx.lineJoin,
  textAlign: ctx.textAlign,
  textBaseline: ctx.textBaseline,
});

function apply(ctx: CanvasRenderingContext2D, state: DrawState): void {
  ctx.globalAlpha = state.globalAlpha;
  ctx.font = state.font;
  ctx.fillStyle = state.fillStyle;
  ctx.strokeStyle = state.strokeStyle;
  ctx.lineWidth = state.lineWidth;
  ctx.lineCap = state.lineCap;
  ctx.lineJoin = state.lineJoin;
  ctx.textAlign = state.textAlign;
  ctx.textBaseline = state.textBaseline;
}

export function unclipped(ctx: CanvasRenderingContext2D, body: () => void): void {
  const state = active.get(ctx);
  if (state === undefined) {
    body();
    return;
  }
  // Styles set since `clipped` are carried across by hand, because `restore` drops
  // them along with the clip. Both directions matter, and for different reasons:
  // going *in*, these are what the label is meant to be drawn in; coming back
  // *out*, the caller is often mid-sequence and expects the state it set to still
  // be there. The centreline tick loop is the case that proves it — it sets the
  // tick colour once and then strokes a tick per 2 NM, printing a figure at every
  // major one, so a lift that restored the stroke state to whatever `clipped` had
  // saved left every tick past the first label drawn in the default black.
  const { region, depth } = state;
  const saved = snapshot(ctx);
  for (let i = 0; i < depth; i += 1) ctx.restore();
  apply(ctx, saved);
  try {
    body();
  } finally {
    for (let i = 0; i < depth; i += 1) ctx.save();
    region(ctx);
    apply(ctx, saved);
  }
}
