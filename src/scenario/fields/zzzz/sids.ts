/**
 * ZZZZ's standard instrument departures — three SIDs off its single runway
 * (docs §4.7).
 *
 * A SID is the mirror of a STAR and is deliberately *not* the same shape. A STAR
 * publishes a continuous descent profile that the autopilot is flown onto; a SID
 * publishes **restrictions**, and between them the aircraft climbs at whatever its
 * own performance gives. So a fix here carries an "at or below" or an "at or
 * above", never a level to sit on, and the climb comes out of `departure.ts`
 * reading the type's performance rather than out of this file.
 *
 * All three are authored in the departure frame — NM past the departure end, NM
 * right of the runway heading — so which compass direction they run in is a
 * consequence of the runway rather than something restated here. Which way each
 * one turns is derived from that geometry too, so the chart label and the track
 * cannot disagree.
 *
 * Geometry, all three routes:
 *
 * Every SID starts on runway heading to NORVU, 3.2 NM off the departure end — far
 * enough that the turn happens at a realistic thousand feet or so rather than at
 * the wheels-up point. NORVU sits on the turning leg, which the two turning routes
 * then follow out to either side.
 *
 * - **Turning SIDs** cross the far gates' downwind legs 6 NM abeam, where the
 *   arrival above is descending 7000 → 3000 on its way in. At the crossing it is
 *   still at about 6700 ft, so a departure held at or below **4000** passes some
 *   2700 ft underneath it.
 * - **The restriction ends two miles beyond the crossing, not at it.** Release the
 *   climb where the tracks cross and the departure is still inside 3 NM of the
 *   arrival route as it goes, so the "at or below" has to be carried past the
 *   conflict — which is what a real SID does. The crossing itself is left
 *   unlabelled: it is visible where the amber line passes under the blue one.
 * - **The straight SID** runs down the extended departure centreline, the one
 *   direction with no arrival traffic in it at all: the nearest STAR fix is 6 NM
 *   abeam. It is an unrestricted climb the whole way.
 *
 * All three finish above the airspace ceiling the player is held to, and therefore
 * above the highest arrival, and leave through the middle of the gaps between the
 * arrival gates. No SID crosses a STAR anywhere except underneath a downwind.
 *
 * The exit fixes sit inside the boundary rather than on it, so the aircraft
 * finishes the route and flies the last few miles on its exit heading — the same
 * thing a STAR does at its last fix, and what the airspace exit check expects.
 */
import { depart } from '../../geometry.js';
import type { SidSpec } from '../../types.js';

/**
 * How far past the departure end the turning leg runs, and therefore where NORVU
 * sits. 3.2 NM is far enough that the turn is flown at a realistic height, while
 * keeping the leg clear of LOMSA and DEMUX at the corner of the downwinds.
 */
const TURN_LEG_NM = 3.2;
/**
 * Where the crossing restriction ends, in NM abeam. The downwinds are 6 NM abeam,
 * so this is two miles past the crossing — the whole reason the fix is past the
 * crossing rather than on it is that a departure released at the crossing climbs
 * straight back into the gap it was just held under.
 *
 * Two miles is as close in as the geometry allows and deliberately no further:
 * every extra mile is another 20 seconds of a departure cruising level at 4000 ft
 * in plain view, which reads as an aircraft that has forgotten to climb.
 */
const RESTRICTION_NM = 8;
/**
 * How far past the restriction fix the exit fix sits. A heavy leaving 4000 ft
 * needs about 22 NM to make the top of climb (docs §4.7), so 28 NM is the
 * requirement plus a margin that holds for every type in the fleet, and still
 * leaves the exit fix inside the boundary with a leg to fly out on.
 */
const EXIT_LEG_NM = 28;
/** Where the straight SID's exit fix sits, in NM past the departure end. */
const STRAIGHT_EXIT_NM = 35.2;

/** Published ceiling across the arrival downwind. */
const CROSSING_MAX_FT = 4000;

/**
 * A turning departure. `rightNm` is which side it leaves on, and the compiler
 * reads the turn direction back out of the resulting track — real SIDs off one
 * runway share their first fix, and two departures are never closer together than
 * the release interval anyway.
 */
function turning(name: string, rightNm: number, restriction: string, exit: string): SidSpec {
  return {
    name,
    fixes: [
      { name: 'NORVU', at: depart(TURN_LEG_NM, 0) },
      {
        name: restriction,
        at: depart(TURN_LEG_NM, rightNm),
        maxAltitudeFt: CROSSING_MAX_FT,
      },
      {
        name: exit,
        at: depart(TURN_LEG_NM, rightNm + Math.sign(rightNm) * EXIT_LEG_NM),
      },
    ],
  };
}

export const ZZZZ_SIDS: readonly SidSpec[] = [
  turning('SABAR1A', RESTRICTION_NM, 'MORVA', 'SABAR'),
  turning('KIROS1A', -RESTRICTION_NM, 'TELMU', 'KIROS'),
  {
    name: 'RAMOX1A',
    fixes: [
      { name: 'NORVU', at: depart(TURN_LEG_NM, 0) },
      { name: 'RAMOX', at: depart(STRAIGHT_EXIT_NM, 0) },
    ],
  },
];
