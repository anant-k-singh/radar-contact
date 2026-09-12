/**
 * VABB AREA — the whole en-route sector around Mumbai, and the second `center`
 * field.
 *
 * The runway, the fleet and the airlines are Mumbai's, for VABB South's reason:
 * this is Mumbai's traffic one sector earlier. The runway is never landed on —
 * it anchors the local frame, and it is drawn 50 NM inside the ring's inner arc,
 * which is what the field is to an en-route controller: the place everything is
 * pointed at and nobody's to work.
 *
 * What this position is that the southern one is not: **all five gates**, and so
 * the whole of VABB's arrival flow. The five delivery agreements sum to 31 an
 * hour against Mumbai's ~30 capacity, where VABB South's two sum to 14.
 */
import { VABB_AIRLINES } from '../vabb/airlines.js';
import { VABB_RUNWAY } from '../vabb/airport.js';
import { AIRCRAFT_TYPES } from '../../aircraftTypes.js';
import type { ScenarioSpec } from '../../types.js';
import { VABB_AREA_AIRSPACE, VABB_AREA_DELIVERY, VABB_AREA_GATES } from './airport.js';
import { VABB_AREA_STARS } from './stars.js';

export const VABB_AREA: ScenarioSpec = {
  id: 'VABBA',
  name: 'Mumbai Area Control',
  icao: 'VABB',
  role: 'center',
  elevationFt: 40,
  runway: VABB_RUNWAY,
  airspace: VABB_AREA_AIRSPACE,
  gates: VABB_AREA_GATES,
  delivery: VABB_AREA_DELIVERY,
  stars: VABB_AREA_STARS,
  /** No departures yet: the sector flies arrivals only (§4.8). */
  sids: [],
  fleet: AIRCRAFT_TYPES,
  airlines: VABB_AIRLINES,
  traffic: {
    /**
     * Thirty-three an hour against 31 agreed — a few percent over, and
     * deliberately no more, for the reason VABB South's 15 is set against its 14.
     * The work is not a surplus to absorb but the fact that arrivals are a
     * Poisson process, so a stream offered exactly its agreed rate still delivers
     * a large share of its gaps short of the interval. Feeding a sector well
     * above what the field below accepts puts it irrecoverably behind, which is a
     * fail state rather than an exercise; the flow control is where the player
     * asks for that.
     */
    arrivalsPerHour: 33,
    departuresPerHour: 0,
    /**
     * Two minutes, as VABB South. A merge group shares one cooldown, so this is
     * the interval the six KETOR entries are offered traffic at between them —
     * in-trail spacing at the boundary rather than metering, since it delays a
     * handover rather than moving it to another stream.
     */
    gateCooldownS: 120,
  },
};
