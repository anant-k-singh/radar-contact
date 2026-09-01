/**
 * ZZZZ's standard arrival routes — one STAR from each entry gate (docs §4.5).
 *
 * A STAR is a chain of waypoints, some carrying a published crossing altitude or
 * speed. Arrivals fly it on autopilot: lateral tracking waypoint to waypoint, and
 * a continuous descent interpolated between the published altitudes, until the
 * controller vectors them off it.
 *
 * Every route publishes 250 kt as far as its first fix, 230 kt at the corner, and
 * its own platform speed at the last — so the speed comes off over the middle
 * legs rather than from the moment of handover: "keep the speed up until close
 * in", expressed as a published constraint.
 *
 * The two shapes, both authored in the runway frame, so neither depends on which
 * way this particular runway happens to point:
 *
 * - **Near gates** run straight in to a corner well abeam the field, then a leg
 *   across the approach descending 7000 → 3000 that stops 2 NM short of the
 *   extended centreline. Turn one onto final; the other has to wait.
 * - **Far gates** run straight in until their track reaches the downwind offset,
 *   then a parallel leg back towards the field descending 7000 → 3000. That leg is
 *   a downwind: turn base when the gap in the sequence is there. The height is
 *   already off by then, so the base turn is a turn rather than a descent as well.
 *
 * No two routes cross. Only the two near routes end pointing at each other, 4 NM
 * apart, which is the sequencing problem the player is here to solve.
 */
import { final, joinsDownwind } from '../../geometry.js';
import type { StarSpec } from '../../types.js';
import { CEILING_FT, NEAR_ENTRY_FT } from './airport.js';

/**
 * Where the near routes' level legs sit, in NM from the threshold along final.
 *
 * The glideslope is 4840 ft here, so a platform at 3000 sits well under it and
 * the intercept captures from below.
 */
const PLATFORM_NM = 15.2;
/** How far out to the side those routes turn inbound. */
const CORNER_NM = 20;
/** How close to the extended centreline they stop. */
const MERGE_NM = 2;
/** Offset of the downwind legs either side of the final approach course. */
const DOWNWIND_NM = 6;
/**
 * Where the downwinds end, in NM from the threshold along final — 5 NM clear of
 * the near routes. 3000 ft is under the 3° path from about 9.4 NM, which is
 * inside any base turn off a downwind this long.
 */
const DOWNWIND_END_NM = 10.2;

/**
 * The published profile of every route, fix by fix.
 *
 * Each crossing stands on its own — nothing here is shared between routes or
 * derived from a common constant, so a single fix can be retuned without dragging
 * the other eleven with it. Republishing 250 kt at the first fix of each route
 * holds the entry speed that far instead of bleeding it off from the gate.
 *
 * `fraction: 0.5` is a reporting point halfway down the leg in from the gate: the
 * compiler places it between its two positioned neighbours, so moving the corner
 * moves it too.
 *
 * The entry crossing lives on the route because it is a property of the route's
 * geometry. KOVAL and VANDA reach the localizer with far fewer track miles in
 * which to lose the height, so their routes are handed over 2000 ft lower — and
 * that is the route's fact to state, not the gate's.
 */
export const ZZZZ_STARS: readonly StarSpec[] = [
  {
    name: 'VANDA1A',
    gate: 'VANDA',
    entryAltitudeFt: NEAR_ENTRY_FT,
    entrySpeedKts: 250,
    fixes: [
      { name: 'OKPUR', fraction: 0.5, altitudeFt: 9000, speedKts: 250 },
      { name: 'ALVOR', at: final(PLATFORM_NM, CORNER_NM), altitudeFt: 7000, speedKts: 230 },
      { name: 'ARDIS', at: final(PLATFORM_NM, MERGE_NM), altitudeFt: 3000, speedKts: 200 },
    ],
  },
  {
    name: 'KOVAL1A',
    gate: 'KOVAL',
    entryAltitudeFt: NEAR_ENTRY_FT,
    entrySpeedKts: 250,
    fixes: [
      { name: 'NIVEL', fraction: 0.5, altitudeFt: 9000, speedKts: 250 },
      { name: 'BELGA', at: final(PLATFORM_NM, -CORNER_NM), altitudeFt: 7000, speedKts: 230 },
      { name: 'BOXAR', at: final(PLATFORM_NM, -MERGE_NM), altitudeFt: 3000, speedKts: 200 },
    ],
  },
  {
    name: 'RIMOL1A',
    gate: 'RIMOL',
    entryAltitudeFt: CEILING_FT,
    entrySpeedKts: 250,
    fixes: [
      { name: 'SUDIX', fraction: 0.5, altitudeFt: 10_000, speedKts: 250 },
      { name: 'LOMSA', at: joinsDownwind(DOWNWIND_NM), altitudeFt: 7000, speedKts: 230 },
      { name: 'PIKON', at: final(DOWNWIND_END_NM, DOWNWIND_NM), altitudeFt: 3000, speedKts: 210 },
    ],
  },
  {
    name: 'TEMBA1A',
    gate: 'TEMBA',
    entryAltitudeFt: CEILING_FT,
    entrySpeedKts: 250,
    fixes: [
      { name: 'TAVIR', fraction: 0.5, altitudeFt: 10_000, speedKts: 250 },
      { name: 'DEMUX', at: joinsDownwind(-DOWNWIND_NM), altitudeFt: 7000, speedKts: 230 },
      { name: 'KETAN', at: final(DOWNWIND_END_NM, -DOWNWIND_NM), altitudeFt: 3000, speedKts: 210 },
    ],
  },
];
