/**
 * The shape of the controlled airspace (§3.1): a 50 NM circle with its northern
 * and southern caps cut off by horizontal chords.
 *
 * Both the exit check and the scope's boundary drawing read the shape from
 * here, so there is one definition of "inside" rather than two that can drift.
 */
import { AIRSPACE_HALF_HEIGHT_NM, AIRSPACE_RADIUS_NM } from './constants.js';
import { headingVector, magnitude, type Deg, type Nm, type Point } from './units.js';

/** Half-width of each chord — where it meets the circle. */
export const AIRSPACE_CHORD_HALF_WIDTH_NM: Nm = Math.sqrt(
  AIRSPACE_RADIUS_NM ** 2 - AIRSPACE_HALF_HEIGHT_NM ** 2,
);

/**
 * Half-angle of each surviving arc, measured from due east/west. The chords
 * meet the circle here, so this is where an arc stops and a chord starts.
 */
export const AIRSPACE_ARC_HALF_ANGLE_RAD = Math.asin(AIRSPACE_HALF_HEIGHT_NM / AIRSPACE_RADIUS_NM);

/**
 * How much room is left before the boundary; negative once outside. Taken as
 * the smaller of the radial and the north–south margin, which is not quite the
 * Euclidean distance to a corner but is monotone and goes through zero in
 * exactly the right place — all the exit check needs.
 */
export function boundaryMarginNm(point: Point): Nm {
  return Math.min(
    AIRSPACE_RADIUS_NM - magnitude(point),
    AIRSPACE_HALF_HEIGHT_NM - Math.abs(point.y),
  );
}

export function isInsideAirspace(point: Point): boolean {
  return boundaryMarginNm(point) >= 0;
}

/**
 * Range from the airport to the boundary along a bearing. Beyond the arcs this
 * is where the ray meets a chord instead, which is what keeps the compass rose
 * on the edge of the shape rather than floating off the top of the screen.
 */
export function boundaryRangeAtBearing(bearingDeg: Deg): Nm {
  const northward = Math.abs(headingVector(bearingDeg).y);
  if (northward <= 0) return AIRSPACE_RADIUS_NM;
  return Math.min(AIRSPACE_RADIUS_NM, AIRSPACE_HALF_HEIGHT_NM / northward);
}
