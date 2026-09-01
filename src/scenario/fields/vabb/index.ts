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
import { VABB_SIDS } from './sids.js';
import { VABB_STARS } from './stars.js';

export const VABB: ScenarioSpec = {
  id: 'VABB',
  name: 'Mumbai',
  icao: 'VABB',
  elevationFt: 40,
  runway: VABB_RUNWAY,
  inactiveRunways: VABB_INACTIVE,
  airspace: VABB_AIRSPACE,
  gates: VABB_GATES,
  stars: VABB_STARS,
  sids: VABB_SIDS,
  fleet: AIRCRAFT_TYPES,
  airlines: VABB_AIRLINES,
  /**
   * The busiest single-runway airport there is: ~46 movements an hour declared,
   * and 1,036 in a day on record. It opens at half of that each way, which is
   * about what the runway can actually turn round given the arrivals own it.
   */
  traffic: { arrivalsPerHour: 22, departuresPerHour: 22 },
};
