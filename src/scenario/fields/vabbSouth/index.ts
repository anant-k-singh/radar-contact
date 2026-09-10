/**
 * VABB SOUTH — the en-route sector south of Mumbai, and the first `center` field.
 *
 * The runway, the fleet and the airlines are Mumbai's, because this is Mumbai's
 * traffic one sector earlier. The runway in particular is never landed on here:
 * it anchors the local frame — `Scenario.arp` is the origin and `FixAt` closures
 * resolve against the runway — and it is drawn as a mark on the scope at the far
 * end of the arrivals, which is exactly what it is to an en-route controller.
 */
import { VABB_AIRLINES } from '../vabb/airlines.js';
import { VABB_RUNWAY } from '../vabb/airport.js';
import { AIRCRAFT_TYPES } from '../../aircraftTypes.js';
import type { ScenarioSpec } from '../../types.js';
import { VABB_SOUTH_AIRSPACE, VABB_SOUTH_DELIVERY, VABB_SOUTH_GATES } from './airport.js';
import { VABB_SOUTH_STARS } from './stars.js';

export const VABB_SOUTH: ScenarioSpec = {
  id: 'VABBS',
  name: 'Mumbai South Sector',
  icao: 'VABB',
  role: 'center',
  elevationFt: 40,
  runway: VABB_RUNWAY,
  airspace: VABB_SOUTH_AIRSPACE,
  gates: VABB_SOUTH_GATES,
  delivery: VABB_SOUTH_DELIVERY,
  stars: VABB_SOUTH_STARS,
  /** No departures yet: the sector flies arrivals only (§4.8). */
  sids: [],
  fleet: AIRCRAFT_TYPES,
  airlines: VABB_AIRLINES,
  traffic: {
    /**
     * Twenty an hour across two streams, split 72/28 by the gate weights — 14.4
     * into MOLGO against an agreement of 14, and 5.6 into KETOR against 6. The
     * sector is offered very nearly what it is asked to deliver, so the work is
     * smoothing the stream rather than absorbing a surplus.
     */
    arrivalsPerHour: 20,
    departuresPerHour: 0,
    /**
     * Two minutes, against agreements of four and ten. A merge group shares one
     * cooldown, so this is the interval the six KETOR routes are offered traffic
     * at between them — and the gap between it and the agreement is the delay the
     * player has to find somewhere to put.
     */
    gateCooldownS: 120,
  },
};
