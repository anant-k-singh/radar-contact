/**
 * LSGG, Genève Aéroport — runway 22.
 *
 * The third field, and the first that is not at sea level. Everything specific to
 * it is in this folder; `airport.ts` cites the published charts it is transcribed
 * from, which are the publisher's copyright and are deliberately not distributed
 * with this repository.
 *
 * What it adds over the first two: a field elevation that matters (1411 ft),
 * terrain that is the problem rather than the scenery, nine arrival routes that
 * merge into three streams, two published downwinds exactly 6 NM either side of the
 * final, and a magnetic variation big enough that true and magnetic have to be told
 * apart.
 */
import { AIRCRAFT_TYPES } from '../../aircraftTypes.js';
import type { ScenarioSpec } from '../../types.js';
import { LSGG_AIRLINES } from './airlines.js';
import { LSGG_AIRSPACE, LSGG_GATES, LSGG_RUNWAY } from './airport.js';
import { LSGG_SIDS } from './sids.js';
import { LSGG_STARS } from './stars.js';
import { LSGG_TERRAIN } from './terrain.js';

export const LSGG: ScenarioSpec = {
  id: 'LSGG',
  name: 'Geneva',
  icao: 'LSGG',
  /**
   * AD ELEV, printed on every sheet. The first field where this is not
   * approximately zero, and it reaches further than it looks: the glideslope, the
   * runway-separation exemption, a departure's AGL datum and the spawn altitude
   * all measure from it.
   */
  elevationFt: 1411,
  runway: LSGG_RUNWAY,
  terrain: LSGG_TERRAIN,
  airspace: LSGG_AIRSPACE,
  gates: LSGG_GATES,
  stars: LSGG_STARS,
  sids: LSGG_SIDS,
  fleet: AIRCRAFT_TYPES,
  airlines: LSGG_AIRLINES,
  /**
   * 0.87, and fitted rather than assumed. Geneva is temperate, but the field is
   * 1411 ft up — a warm afternoon is a density altitude near 3500 ft, so this
   * lands next to Mumbai's 0.88 by a different route.
   *
   * What pins it is the observed traffic: a B738 off DIPIR 1A is at 15,000 by
   * GG617 and 18,000 by KELUK, 22 and 32 NM into the climb. Book rate overshoots
   * both by 400 and 2400 ft; 0.87 brings them to −615 and +1079. It cannot be made
   * exact, and the residual says why — the model climbs continuously while real
   * departures level off, so no single scale fits both ends of a profile.
   *
   * As at VABB it scales the *climb* and not the energy budget: what a departure
   * does not spend climbing is left to accelerate with (§4.3), which is the right
   * way round when it is the air that is thin.
   */
  performance: { departureClimbScale: 0.87 },
  /**
   * ~17 million passengers and around 186,000 movements a year on one runway,
   * which is a little over 500 a day and peaks near 38 an hour. It opens at about
   * half of that each way.
   */
  traffic: { arrivalsPerHour: 18, departuresPerHour: 18 },
};
