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
export function unclipped(ctx: CanvasRenderingContext2D, body: () => void): void {
  const state = active.get(ctx);
  if (state === undefined) {
    body();
    return;
  }
  // Styles set since `clipped` are re-applied by hand: `restore` would drop them
  // along with the clip, and they are what the label is meant to be drawn in.
  const { region, depth } = state;
  const alpha = ctx.globalAlpha;
  const font = ctx.font;
  const fill = ctx.fillStyle;
  const align = ctx.textAlign;
  const baseline = ctx.textBaseline;
  for (let i = 0; i < depth; i += 1) ctx.restore();
  ctx.globalAlpha = alpha;
  ctx.font = font;
  ctx.fillStyle = fill;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  try {
    body();
  } finally {
    for (let i = 0; i < depth; i += 1) ctx.save();
    region(ctx);
  }
}
