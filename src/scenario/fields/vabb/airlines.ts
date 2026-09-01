/**
 * Who actually flies into Mumbai.
 *
 * `Scenario.airlines` is per-field, and this is most of what it is for: a scope
 * full of IndiGo and Air India reads as VABB in a way no amount of correct
 * geometry does. Ordered roughly by share, though nothing reads the order — the
 * generator picks uniformly, so this is the list, not the weighting.
 */
import type { Airline } from '../../airlines.js';

export const VABB_AIRLINES: readonly Airline[] = [
  { icao: 'IGO', callsign: 'IndiGo' },
  { icao: 'AIC', callsign: 'Air India' },
  { icao: 'AXB', callsign: 'Express India' },
  { icao: 'AKJ', callsign: 'Akasa Air' },
  { icao: 'SEJ', callsign: 'Spicejet' },
  { icao: 'UAE', callsign: 'Emirates' },
  { icao: 'QTR', callsign: 'Qatari' },
  { icao: 'ETD', callsign: 'Etihad' },
  { icao: 'SIA', callsign: 'Singapore' },
  { icao: 'BAW', callsign: 'Speedbird' },
];
