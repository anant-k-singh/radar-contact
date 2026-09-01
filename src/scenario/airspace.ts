/**
 * The shape of the controlled airspace (§3.1): a circle centred on the airport
 * with its caps cut off by two chords.
 *
 * This lives beside the airport data rather than in `src/sim/` because the shape
 * *is* part of the field — a second airport gets its own radius and its own
 * cuts. Both the exit check and the scope's boundary drawing read it from here,
 * so there is one definition of "inside" rather than two that can drift.
 *
 * The chords are horizontal in the local frame, i.e. they cut the north and
 * south caps. That is an assumption rather than a law: they exist to reclaim
 * canvas height, so they follow the screen, not the runway.
 */
import { headingVector, magnitude, type Deg, type Nm, type Point } from '../sim/units.js';
import type { Airspace, AirspaceSpec } from './types.js';

/** Fill in the two derived figures the boundary drawing needs. */
export function compileAirspace(spec: AirspaceSpec): Airspace {
  const halfHeightNm = Math.min(spec.halfHeightNm, spec.radiusNm);
  return {
    ...spec,
    halfHeightNm,
    chordHalfWidthNm: Math.sqrt(Math.max(0, spec.radiusNm ** 2 - halfHeightNm ** 2)),
    arcHalfAngleRad: Math.asin(halfHeightNm / spec.radiusNm),
  };
}

/**
 * How much room is left before the boundary; negative once outside. Taken as the
 * smaller of the radial and the north–south margin, which is not quite the
 * Euclidean distance to a corner but is monotone and goes through zero in exactly
 * the right place — all the exit check needs.
 */
export function boundaryMarginNm(airspace: Airspace, point: Point): Nm {
  return Math.min(
    airspace.radiusNm - magnitude(point),
    airspace.halfHeightNm - Math.abs(point.y),
  );
}

export function isInsideAirspace(airspace: Airspace, point: Point): boolean {
  return boundaryMarginNm(airspace, point) >= 0;
}

/**
 * Range from the airport to the boundary along a bearing. Beyond the arcs this is
 * where the ray meets a chord instead, which is what keeps the compass rose on
 * the edge of the shape rather than floating off the top of the screen — and what
 * puts an entry gate on the boundary rather than 6 NM outside it.
 */
export function boundaryRangeAtBearing(airspace: Airspace, bearingDeg: Deg): Nm {
  const northward = Math.abs(headingVector(bearingDeg).y);
  if (northward <= 0) return airspace.radiusNm;
  return Math.min(airspace.radiusNm, airspace.halfHeightNm / northward);
}
