/**
 * Units and geometry primitives.
 *
 * Unit-suffixed type aliases are documentation, not enforcement — TypeScript
 * branding on numbers makes ordinary arithmetic unusable. The discipline is in
 * the naming: every variable carries its unit (`altFt`, `distNm`, `iasKts`).
 * Every conversion lives here so there is exactly one place to check.
 */

export type Nm = number;
export type Ft = number;
export type Kts = number;
export type Deg = number;
export type Sec = number;
export type Fpm = number;

export const FT_PER_NM = 6076.12;
export const KTS_TO_FT_PER_SEC = 1.68781;
export const G_FT_PER_SEC2 = 32.174;

export const DEG = Math.PI / 180;

/** Local flat-earth frame: x = east, y = north, both in NM from the airport reference point. */
export interface Point {
  x: Nm;
  y: Nm;
}

export const toRad = (deg: Deg): number => deg * DEG;
export const toDeg = (rad: number): Deg => rad / DEG;

/** Normalise to [0, 360). */
export function normalizeHeading(deg: Deg): Deg {
  const h = deg % 360;
  return h < 0 ? h + 360 : h;
}

/** Shortest signed turn from `from` to `to`, in (-180, 180]. Positive = right/clockwise. */
export function headingDelta(from: Deg, to: Deg): Deg {
  let d = normalizeHeading(to) - normalizeHeading(from);
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/** Absolute angular difference between two headings, 0..180. */
export function headingDiff(a: Deg, b: Deg): Deg {
  return Math.abs(headingDelta(a, b));
}

/** Unit vector for a compass heading (0 = north, 90 = east). */
export function headingVector(deg: Deg): Point {
  const r = toRad(deg);
  return { x: Math.sin(r), y: Math.cos(r) };
}

/** Compass bearing from `a` to `b`. */
export function bearing(a: Point, b: Point): Deg {
  return normalizeHeading(toDeg(Math.atan2(b.x - a.x, b.y - a.y)));
}

export function distance(a: Point, b: Point): Nm {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function magnitude(p: Point): Nm {
  return Math.hypot(p.x, p.y);
}

/**
 * True airspeed from indicated airspeed: ~2% per 1000 ft.
 * Reproduces IF ATC manual 6.15.3 (250 KIAS at 9000 ft ≈ 290 kt GS).
 */
export function trueAirspeed(iasKts: Kts, altFt: Ft): Kts {
  return iasKts * (1 + 0.02 * (altFt / 1000));
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Round to the nearest multiple of `step`. */
export function quantize(v: number, step: number): number {
  return Math.round(v / step) * step;
}
