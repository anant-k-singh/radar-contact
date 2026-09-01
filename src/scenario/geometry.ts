/**
 * Where a fix is, expressed the way a chart expresses it.
 *
 * Every route in a scenario used to be authored as absolute `x/y`, which only
 * reads correctly for one particular runway: the arrival platforms were positive
 * `y` because runway 18 lands southbound, and the SID fixes negative `y` for the
 * same reason. Rotate the runway and every literal is silently wrong.
 *
 * So a fix declares its position as a small closure, resolved once against the
 * runway frame at compile time. `final(15.2, 2)` is "15.2 NM out on final, 2 NM
 * right of the centreline" on any runway at any airport, and it is also the pair
 * of numbers `finalGeometry` reports back — so an intercept platform is authored
 * as the along-track distance whose glideslope height it has to stay under,
 * rather than as coordinates that happen to work out with the figure recovered
 * in a comment.
 *
 * Closures rather than a tagged union: no interpreter, no resolve() switch, and a
 * field can add a constructor of its own. The cost is that a scenario is not
 * JSON-serialisable, which costs nothing — the registry is a static import.
 */
import { bearing, headingVector, magnitude, rightOf, type Deg, type Nm, type Point } from '../sim/units.js';
import type { EntryGate, Runway } from './types.js';

/** What a fix declaration is resolved against, once, at compile time. */
export interface FixContext {
  runway: Runway;
  arp: Point;
  /** The gate a STAR starts from. Undefined on a SID. */
  gate?: EntryGate;
}

/** A fix position, deferred until the runway frame exists. */
export type FixAt = (ctx: FixContext) => Point;

/** `aheadNm` along the landing direction from `origin`, `rightNm` to its right. */
function offset(origin: Point, runway: Runway, aheadNm: Nm, rightNm: Nm): Point {
  const right = rightOf(runway.direction);
  return {
    x: origin.x + runway.direction.x * aheadNm + right.x * rightNm,
    y: origin.y + runway.direction.y * aheadNm + right.y * rightNm,
  };
}

/** Absolute local frame: x east, y north, NM from the origin. */
export const xy =
  (x: Nm, y: Nm): FixAt =>
  () => ({ x, y });

/** Bearing and range from the ARP — how a chart names a fix off a navaid. */
export const radial =
  (bearingDeg: Deg, rangeNm: Nm): FixAt =>
  (ctx) => {
    const v = headingVector(bearingDeg);
    return { x: ctx.arp.x + v.x * rangeNm, y: ctx.arp.y + v.y * rangeNm };
  };

/**
 * `alongNm` **before** the threshold on the final approach course, `rightNm` to
 * the right of it facing the landing direction. The arrival frame.
 */
export const final =
  (alongNm: Nm, rightNm: Nm): FixAt =>
  (ctx) => offset(ctx.runway.threshold, ctx.runway, -alongNm, rightNm);

/**
 * `alongNm` past the departure end on runway heading, `rightNm` to its right.
 * The departure frame — a SID's own natural coordinates.
 */
export const depart =
  (alongNm: Nm, rightNm: Nm): FixAt =>
  (ctx) => offset(ctx.runway.farEnd, ctx.runway, alongNm, rightNm);

/**
 * Where the straight-in track from the gate first reaches the line `rightNm` to
 * the right of the final approach course — the turn onto a downwind.
 *
 * Derived rather than declared, because what it is *for* is keeping the leg in
 * from the handover dead straight: move the gate and the corner moves with it.
 * Replaces a version that divided by the track's east component, and so had a
 * silent divide-by-zero for any gate due north or south of the field; a track
 * parallel to the runway is now a named error at compile time.
 */
export const joinsDownwind =
  (rightNm: Nm): FixAt =>
  (ctx) => {
    const gate = ctx.gate;
    if (!gate) throw new Error('joinsDownwind is only meaningful on a STAR');
    const hit = rayMeetsLine(
      gate.position,
      headingVector(gate.inboundHeadingDeg),
      offset(ctx.runway.threshold, ctx.runway, 0, rightNm),
      ctx.runway.direction,
    );
    if (!hit) {
      throw new Error(
        `${gate.name}: the inbound track never reaches the ${rightNm} NM downwind`,
      );
    }
    return hit;
  };

/** Where a ray meets a line, or null when they are parallel or it lies behind. */
function rayMeetsLine(from: Point, dir: Point, on: Point, along: Point): Point | null {
  const denom = dir.x * along.y - dir.y * along.x;
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((on.x - from.x) * along.y - (on.y - from.y) * along.x) / denom;
  return t > 0 ? { x: from.x + dir.x * t, y: from.y + dir.y * t } : null;
}

/**
 * `to`, or where the leg from `from` to it crosses `rangeNm` from the reference
 * point — whichever comes first.
 *
 * For a field transcribing published procedures whose fixes do not all fit. A real
 * TMA's entry fixes sit a mile or two outside a round number and its SID exits a
 * mile or two inside, and a route has to start on the boundary and end inside it.
 * Clipping along the published leg keeps the **track** exactly, and moves only how
 * far along it the route begins or ends — which is what truncating a route means.
 *
 * The fix's own coordinate stays the input, so nothing is lost: the leg is still
 * aimed at the real place, and the real place is still written down.
 */
export const clipToRange =
  (rangeNm: Nm, from: FixAt, to: FixAt): FixAt =>
  (ctx) => {
    const a = from(ctx);
    const b = to(ctx);
    if (magnitude(b) <= rangeNm) return b;
    // |a + t(b - a)| = rangeNm, for the first t in (0, 1].
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const quadratic = dx * dx + dy * dy;
    if (quadratic < 1e-12) return b;
    const linear = a.x * dx + a.y * dy;
    const constant = a.x * a.x + a.y * a.y - rangeNm * rangeNm;
    const discriminant = linear * linear - quadratic * constant;
    if (discriminant < 0) return b;
    const t = (-linear + Math.sqrt(discriminant)) / quadratic;
    if (!(t > 0 && t <= 1)) return b;
    return { x: a.x + dx * t, y: a.y + dy * t };
  };

export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** A point `t` of the way from `a` to `b`. */
export function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/**
 * Which way a route turns off the runway: the first leg that departs the runway
 * course by more than this is the turn, and its sign is the direction.
 */
export const STRAIGHT_OUT_DEG = 15;

export function turnOf(
  runway: Runway,
  waypoints: readonly { position: Point }[],
): 'left' | 'right' | 'straight' {
  for (let i = 0; i < waypoints.length - 1; i += 1) {
    const legDeg = bearing(waypoints[i]!.position, waypoints[i + 1]!.position);
    let delta = legDeg - runway.courseDeg;
    while (delta > 180) delta -= 360;
    while (delta <= -180) delta += 360;
    if (Math.abs(delta) >= STRAIGHT_OUT_DEG) return delta > 0 ? 'right' : 'left';
  }
  return 'straight';
}
