export interface Airline {
  icao: string;
  /** Spoken callsign used in the readback log. */
  callsign: string;
}

export const AIRLINES: readonly Airline[] = [
  { icao: 'KLM', callsign: 'KLM' },
  { icao: 'BAW', callsign: 'Speedbird' },
  { icao: 'DLH', callsign: 'Lufthansa' },
  { icao: 'AFR', callsign: 'Air France' },
  { icao: 'UAE', callsign: 'Emirates' },
  { icao: 'SIA', callsign: 'Singapore' },
  { icao: 'IGO', callsign: 'IndiGo' },
  { icao: 'AIC', callsign: 'Air India' },
  { icao: 'QTR', callsign: 'Qatari' },
  { icao: 'THY', callsign: 'Turkish' },
];
