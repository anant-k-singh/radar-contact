/**
 * VABB, Chhatrapati Shivaji Maharaj International, Mumbai — runway 27.
 *
 * The second field, and the one that made the scenario layer worth building.
 * Everything specific to it is in this folder. `airport.ts` cites the published
 * charts this is transcribed from — they are the publisher's copyright and are
 * deliberately not distributed with this repository — and documents what is taken
 * from them and what is designed.
 */
import { AIRCRAFT_TYPES } from '../../aircraftTypes.js';
import type { ScenarioSpec } from '../../types.js';
import { VABB_AIRLINES } from './airlines.js';
import { VABB_AIRSPACE, VABB_GATES, VABB_INACTIVE, VABB_RUNWAY } from './airport.js';
import { VABB_COASTLINE } from './coastline.js';
import { VABB_SIDS } from './sids.js';
import { VABB_STARS } from './stars.js';

export const VABB: ScenarioSpec = {
  id: 'VABB',
  name: 'Mumbai',
  icao: 'VABB',
  elevationFt: 40,
  runway: VABB_RUNWAY,
  inactiveRunways: VABB_INACTIVE,
  coastline: VABB_COASTLINE,
  airspace: VABB_AIRSPACE,
  gates: VABB_GATES,
  stars: VABB_STARS,
  sids: VABB_SIDS,
  fleet: AIRCRAFT_TYPES,
  airlines: VABB_AIRLINES,
  /**
   * Mumbai is hot and humid, and a departure out of it does not make book climb
   * rate: 35 °C at sea level in May is a density altitude around 2500 ft, and the
   * fleet's figures are quoted for a temperate day. 0.88 is the fraction of book
   * kept here — a B738 climbs away at 2640 fpm rather than 3000, and an A332 at
   * 1760 rather than 2000.
   *
   * It is on the climb and not on the energy budget deliberately: thin air costs
   * gradient, and what a departure does not spend climbing is left over to
   * accelerate with (§4.3), which is the right way round.
   */
  performance: { departureClimbScale: 0.88 },
  /**
   * The busiest single-runway airport there is: ~46 movements an hour declared,
   * and 1,036 in a day on record. It opens at half of that each way, which is
   * about what the runway can actually turn round given the arrivals own it.
   */
  traffic: { arrivalsPerHour: 22, departuresPerHour: 22 },
};
