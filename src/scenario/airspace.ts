/**
 * The shape of the controlled airspace (§3.1), in two kinds.
 *
 * A `chordedCircle` is a circle centred on the airport with its caps cut off by
 * two chords — what a terminal area looks like on a screen, and what every
 * approach field is. A `sector` is an annular wedge: an inner arc, an outer arc
 * and two radials, which is what one en-route sector actually is.
 *
 * This lives beside the airport data rather than in `src/sim/` because the shape
 * *is* part of the field. Both the exit check and the scope's boundary drawing
 * read it from here, so there is one definition of "inside" rather than two that
 * can drift.
 *
 * The chords are horizontal in the local frame, i.e. they cut the north and
 * south caps. That is an assumption rather than a law: they exist to reclaim
 * canvas height, so they follow the screen, not the runway. A sector has no
 * caps and ignores them.
 *
 * **Both shapes are measured from the ARP**, which is what keeps `Scenario.arp`
 * the origin of the frame and every `FixAt` closure working. A sector field
 * moves where the scope is *centred* (`Scenario.scopeCentre`), never where the
 * geometry is measured from.
 */
import {
  bearing,
  headingVector,
  magnitude,
  normalizeHeading,
  toRad,
  type Deg,
  type Nm,
  type Point,
} from '../sim/units.js';
import type { Airspace, AirspaceShape, AirspaceSpec, ViewBox } from './types.js';

const ORIGIN: Point = { x: 0, y: 0 };

/** Room left around a sector for the gate labels that sit outside its boundary. */
const SECTOR_LABEL_MARGIN = 0.06;

const at = (bearingDeg: Deg, rangeNm: Nm): Point => {
  const v = headingVector(bearingDeg);
  return { x: v.x * rangeNm, y: v.y * rangeNm };
};

/**
 * The smallest box containing the shape (`ViewBox`).
 *
 * A wedge's extremes are its four corners plus, on each arc, whichever of the
 * four cardinal bearings the wedge actually covers — those are the only points
 * where an arc's tangent is axis-aligned, so nothing else can be further out.
 * Both arcs are sampled rather than just the outer one: a wedge lying across due
 * north is widest at its corners but tallest on the arc between them, and which
 * arc supplies an extreme depends on where the wedge sits.
 */
function viewBoxOf(shape: AirspaceShape, radiusNm: Nm, halfHeightNm: Nm): ViewBox {
  if (shape.kind !== 'sector') {
    return { centre: ORIGIN, halfWidthNm: radiusNm, halfHeightNm };
  }
  const spanDeg = normalizeHeading(shape.toDeg - shape.fromDeg);
  const ranges = [shape.innerNm, radiusNm];
  const points = ranges.flatMap((rangeNm) => [
    at(shape.fromDeg, rangeNm),
    at(shape.toDeg, rangeNm),
    ...[0, 90, 180, 270]
      .filter((cardinal) => normalizeHeading(cardinal - shape.fromDeg) <= spanDeg)
      .map((cardinal) => at(cardinal, rangeNm)),
  ]);
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  // A little wider than the wedge itself. A sector's gates sit *on* its outer
  // arc, including the two at the ends of it, and their labels are drawn outside
  // the boundary — so a box fitted to the geometry alone slices the first letter
  // off whichever gate lands nearest the edge of the canvas.
  const pad = 1 + SECTOR_LABEL_MARGIN;
  return {
    centre: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
    halfWidthNm: Math.max(((maxX - minX) / 2) * pad, 1),
    halfHeightNm: Math.max(((maxY - minY) / 2) * pad, 1),
  };
}

/** Fill in the derived figures the boundary drawing needs. */
export function compileAirspace(spec: AirspaceSpec): Airspace {
  const halfHeightNm = Math.min(spec.halfHeightNm ?? spec.radiusNm, spec.radiusNm);
  const shape = spec.shape ?? { kind: 'chordedCircle' as const };
  return {
    ...spec,
    halfHeightNm,
    shape,
    view: viewBoxOf(shape, spec.radiusNm, halfHeightNm),
    chordHalfWidthNm: Math.sqrt(Math.max(0, spec.radiusNm ** 2 - halfHeightNm ** 2)),
    arcHalfAngleRad: Math.asin(halfHeightNm / spec.radiusNm),
  };
}

/**
 * How far inside the wedge's two radials a point is, as a distance rather than
 * an angle; negative outside either of them.
 *
 * The angle is converted at the point's own range, because that is what makes it
 * comparable with the two radial margins the caller is taking a minimum against:
 * 5° off a radial is a mile at 12 NM and nine miles at 100. Clamped to 90°
 * before the sine so the result stays monotone in the angle — past a quarter
 * turn the sine turns back on itself, and a point deep inside a wide sector
 * would read as closer to the edge than one merely well inside a narrow one.
 */
function radialMarginNm(fromDeg: Deg, toDeg: Deg, point: Point): Nm {
  const spanDeg = normalizeHeading(toDeg - fromDeg);
  const offDeg = normalizeHeading(bearing(ORIGIN, point) - fromDeg);
  const insideDeg =
    offDeg <= spanDeg
      ? Math.min(offDeg, spanDeg - offDeg)
      : -Math.min(offDeg - spanDeg, 360 - offDeg);
  const reach = magnitude(point) * Math.sin(toRad(Math.min(90, Math.abs(insideDeg))));
  return insideDeg < 0 ? -reach : reach;
}

/**
 * How much room is left before the boundary; negative once outside. Taken as the
 * smallest of the margins to each edge the shape has, which is not quite the
 * Euclidean distance to a corner but is monotone and goes through zero in exactly
 * the right place — all the exit check needs.
 *
 * A sector has four edges rather than two, and the inner arc is one of them: an
 * aircraft that reaches it has been *delivered*, not lost, but that is the exit
 * check's distinction to draw and not this function's.
 */
export function boundaryMarginNm(airspace: Airspace, point: Point): Nm {
  const rangeNm = magnitude(point);
  if (airspace.shape.kind === 'sector') {
    const { innerNm, fromDeg, toDeg } = airspace.shape;
    return Math.min(
      airspace.radiusNm - rangeNm,
      rangeNm - innerNm,
      radialMarginNm(fromDeg, toDeg, point),
    );
  }
  return Math.min(airspace.radiusNm - rangeNm, airspace.halfHeightNm - Math.abs(point.y));
}

export function isInsideAirspace(airspace: Airspace, point: Point): boolean {
  return boundaryMarginNm(airspace, point) >= 0;
}

/**
 * Range from the airport to the *outer* boundary along a bearing. On a chorded
 * circle, beyond the arcs this is where the ray meets a chord instead, which is
 * what keeps the compass rose on the edge of the shape rather than floating off
 * the top of the screen — and what puts an entry gate on the boundary rather
 * than 6 NM outside it.
 *
 * A sector's outer edge is a plain arc, so its answer is the radius everywhere,
 * including on bearings the wedge does not cover: the compass rose is drawn all
 * the way round whatever the shape, and a gate is only ever placed on a bearing
 * the sector actually owns.
 */
export function boundaryRangeAtBearing(airspace: Airspace, bearingDeg: Deg): Nm {
  if (airspace.shape.kind === 'sector') return airspace.radiusNm;
  const northward = Math.abs(headingVector(bearingDeg).y);
  if (northward <= 0) return airspace.radiusNm;
  return Math.min(airspace.radiusNm, airspace.halfHeightNm / northward);
}
