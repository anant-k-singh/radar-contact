/**
 * Who actually flies into Geneva.
 *
 * A base rather than a hub, and an unusually lopsided one: easyJet Switzerland
 * alone is nearly half the movements, Swiss another eighth, and the rest is the
 * European flag carriers plus the leisure traffic that gives this field its winter
 * shape. Ordered roughly by share, though nothing reads the order — the generator
 * picks uniformly, so this is the list, not the weighting.
 */
import type { Airline } from '../../airlines.js';

export const LSGG_AIRLINES: readonly Airline[] = [
  { icao: 'EZS', callsign: 'Topswiss' },
  { icao: 'SWR', callsign: 'Swiss' },
  { icao: 'BAW', callsign: 'Speedbird' },
  { icao: 'AFR', callsign: 'Airfrans' },
  { icao: 'TAP', callsign: 'Air Portugal' },
  { icao: 'KLM', callsign: 'KLM' },
  { icao: 'DLH', callsign: 'Lufthansa' },
  { icao: 'VLG', callsign: 'Vueling' },
  { icao: 'BEL', callsign: 'Beeline' },
  { icao: 'EWG', callsign: 'Eurowings' },
];
