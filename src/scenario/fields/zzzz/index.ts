/**
 * ZZZZ, "Approach Trainer" — the field the simulator ships with.
 *
 * Everything specific to it is in this folder. A second airport is another folder
 * beside this one plus a line in the registry: no code outside `src/scenario/`
 * knows this field's runway, gates, routes or airspace.
 */
import { AIRCRAFT_TYPES } from '../../aircraftTypes.js';
import { AIRLINES } from '../../airlines.js';
import type { ScenarioSpec } from '../../types.js';
import { ZZZZ_AIRSPACE, ZZZZ_GATES, ZZZZ_RUNWAY } from './airport.js';
import { ZZZZ_SIDS } from './sids.js';
import { ZZZZ_STARS } from './stars.js';

export const ZZZZ: ScenarioSpec = {
  id: 'ZZZZ',
  name: 'Approach Trainer',
  icao: 'ZZZZ',
  elevationFt: 0,
  runway: ZZZZ_RUNWAY,
  airspace: ZZZZ_AIRSPACE,
  gates: ZZZZ_GATES,
  stars: ZZZZ_STARS,
  sids: ZZZZ_SIDS,
  fleet: AIRCRAFT_TYPES,
  airlines: AIRLINES,
};
