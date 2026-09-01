/**
 * How VABB's charts state a position: a bearing and a distance from the fix
 * before it.
 *
 * The AAI RNAV charts in `docs/charts/vabb/` give every leg as a magnetic track
 * and a distance and never once give a fix's bearing and range from the ARP. So a
 * fix's position is a chain, and writing it as a chain is what makes the code
 * checkable against the chart — `from(MB364, 358, 12.8)` is the label printed on
 * that leg, and nothing else has to be trusted.
 *
 * Field-local on purpose. The shared library holds the frames a route can be
 * *authored* in (`final`, `depart`, `radial`); this is one field's way of
 * transcribing a particular publisher's charts.
 */
import { headingVector, type Deg, type Nm } from '../../../sim/units.js';
import type { FixAt } from '../../geometry.js';

/**
 * `distNm` from `origin` on a track of `bearingDeg`.
 *
 * Magnetic == true here to within a degree — the charts state VAR 0.75° W (2010)
 * — so the published magnetic tracks are used unconverted, in line with §3.1 A3.
 */
export const from =
  (origin: FixAt, bearingDeg: Deg, distNm: Nm): FixAt =>
  (ctx) => {
    const at = origin(ctx);
    const v = headingVector(bearingDeg);
    return { x: at.x + v.x * distNm, y: at.y + v.y * distNm };
  };
