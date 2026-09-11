/**
 * VABB SOUTH — the en-route sector south of Mumbai, and the first `center` field.
 *
 * The runway, the fleet and the airlines are Mumbai's, because this is Mumbai's
 * traffic one sector earlier. The runway in particular is never landed on here:
 * it anchors the local frame — `Scenario.arp` is the origin and `FixAt` closures
 * resolve against the runway — and it is drawn with its final track 50 NM inside
 * the sector's inner arc, which is exactly what the field is to an en-route
 * controller: the place everything is pointed at and nobody's to work. That it is
 * outside the airspace is why `mapLayer` draws the airport outside the clip.
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
     * Fifteen an hour, split 72/28 by the gate weights — about 10.7 into MOLGO
     * against an agreement of 10, and 4.1 into KETOR against 4.
     *
     * A few percent over what Approach will take, and deliberately no more. The
     * work is not a surplus to absorb: it is that arrivals are a Poisson process,
     * so a stream offered its agreed rate still delivers 40 % of its gaps short
     * of the interval. Feeding it well above the agreement instead would put the
     * sector permanently and irrecoverably behind, which is a fail state rather
     * than an exercise — the player can ask for that with the flow control, and
     * it is their choice to make.
     */
    arrivalsPerHour: 15,
    departuresPerHour: 0,
    /**
     * Two minutes, against agreements of six and fifteen. A merge group shares
     * one cooldown, so this is the interval the six KETOR routes are offered
     * traffic at between them — it is in-trail spacing at the boundary rather
     * than metering, and it delays a handover rather than moving it to the other
     * stream, so the flow the player asks for arrives in the ratio the gates
     * declare.
     */
    gateCooldownS: 120,
  },
};
