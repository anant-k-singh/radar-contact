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
     * Fourteen an hour, split 72/28 by the gate weights — about 10 into MOLGO
     * and 4 into KETOR, which is what each gate has agreed to take.
     *
     * Set against the strict window's ceiling rather than against the agreement:
     * two gates at 14 an hour cap the sector at 3 deliveries in any twelve
     * minutes, which is 15, so a flow of 15 would have been offered at exactly
     * what could be passed. At parity the mean is met and nothing more — a clump
     * can never be paid back, and the backlog walks away with nothing pulling it
     * home. Ninety flown minutes do not show it, but it is a fail state rather
     * than an exercise, and it was 15 only because the rule it was set against
     * was a gap.
     *
     * The work is not a surplus to absorb either way: arrivals are a Poisson
     * process, so a sector offered its agreed rate still presents a large share
     * of its gaps short. The player can ask for more with the flow control, and
     * that is their choice to make.
     */
    arrivalsPerHour: 14,
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
