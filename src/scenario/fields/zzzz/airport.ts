/**
 * ZZZZ — the default field. Airport, airspace and entry gates.
 *
 * Two of these numbers are referenced by the routes rather than by the sim, and
 * are exported for that: the assignable ceiling, which the far gates are handed
 * over at, and the lower crossing the near gates get.
 */
import type { AirspaceSpec, EntryGateSpec, RunwaySpec } from '../../types.js';

/** The top of what the controller may assign. Twelve levels above the MVA. */
export const CEILING_FT = 13_000;
/**
 * What the routes with a short run to the localizer are handed over at.
 *
 * 2000 ft below the ceiling, because those arrivals reach the localizer with far
 * fewer track miles in which to lose the height. Which routes those are is stated
 * by the routes themselves, in stars.ts.
 */
export const NEAR_ENTRY_FT = 11_000;

export const ZZZZ_RUNWAY: RunwaySpec = { id: '18', courseDeg: 180, lengthNm: 1.6 };

export const ZZZZ_AIRSPACE: AirspaceSpec = {
  radiusNm: 50,
  /**
   * The circle's northern and southern caps are cut off by chords here (§3.1).
   * Those extremities were dead airspace — no gate, no route, nothing but the
   * compass rose — and cutting them lets the scope draw the same 50 NM of usable
   * width at a bigger scale, since the height no longer has to carry 100 NM of it.
   * The four gates sit at |y| = 38.3 NM, so 42 keeps them inside with room for
   * their markers and labels.
   */
  halfHeightNm: 42,
  mvaFt: 2000,
  ceilingFt: CEILING_FT,
  rangeRingsNm: [10, 20, 30, 40, 50],
};

/**
 * Four gates, spaced 90° apart and offset 40° from the cardinals, so nothing
 * enters already aligned with the final approach course.
 *
 * The handover altitude and speed are not here: they belong to each gate's STAR
 * (§4.5), which is what knows how much room its own geometry leaves to lose the
 * height in. A gate with no published arrival would state its own.
 */
export const ZZZZ_GATES: readonly EntryGateSpec[] = [
  { name: 'KOVAL', bearingDeg: 40 },
  { name: 'TEMBA', bearingDeg: 130 },
  { name: 'RIMOL', bearingDeg: 230 },
  { name: 'VANDA', bearingDeg: 320 },
];
