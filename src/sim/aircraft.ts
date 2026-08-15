import type { AircraftType } from '../scenario/aircraftTypes.js';
import type { Airline } from '../scenario/airlines.js';
import type { PendingInstruction } from './pilot.js';
import type { StarNav } from './star.js';
import type { Deg, Fpm, Ft, Kts, Nm, Point, Sec } from './units.js';

/**
 * Flight state. `handedOff` is deliberately separate from `phase`: an aircraft
 * handed to Tower keeps flying its approach, it just stops taking our commands.
 */
export type Phase = 'inbound' | 'cleared' | 'loc' | 'gs' | 'goAround';

export type AlertLevel = 'none' | 'warning' | 'violation';

/** What the scope shows. Sampled from live state once per second (§5). */
export interface RadarReturn {
  altitudeFt: Ft;
  iasKts: Kts;
  headingDeg: Deg;
  groundSpeedKts: Kts;
  vsFpm: Fpm;
}

export interface Aircraft {
  id: number;
  callsign: string;
  airline: Airline;
  type: AircraftType;

  // Live kinematic state
  x: Nm;
  y: Nm;
  altitudeFt: Ft;
  headingDeg: Deg;
  iasKts: Kts;
  vsFpm: Fpm;

  // Controller targets. These are what the aircraft is flying *now*; anything
  // transmitted but not yet read back is still in `pending` (§7.2).
  targetHeadingDeg: Deg;
  targetAltitudeFt: Ft;
  targetIasKts: Kts;
  /** Instructions transmitted and not yet acted on. */
  pending: PendingInstruction[];
  /**
   * Forces the direction of the commanded turn when set, instead of turning
   * whichever way is shorter. Only the holding pattern uses it: its 180°
   * reversals are exactly ambiguous, and a standard hold turns right (§4.6).
   */
  turnDirection: -1 | 1 | null;

  /** Route being flown on autopilot, or null once vectored off it (§4.5). */
  star: StarNav | null;

  // Approach state
  phase: Phase;
  handedOff: boolean;
  /** Set when the player assigns a speed after the ILS clearance (IF 6.14.4). */
  speedAssignedAfterClearance: boolean;

  // Bookkeeping
  entryGate: string;
  spawnedAtS: number;
  trackMilesFlown: Nm;
  directDistanceNm: Nm;
  goArounds: number;
  exitWarned: boolean;

  // Display
  /**
   * Sim time until which the scope draws the assigned-heading vector. Set by
   * `adjustHeading` so the player sees where the turn is going; purely visual.
   */
  headingHintUntilS: Sec;
  trail: Point[];
  radar: RadarReturn;
  alert: AlertLevel;
}

export function aircraftPosition(ac: Aircraft): Point {
  return { x: ac.x, y: ac.y };
}

/** True while the player may issue instructions. */
export function isControllable(ac: Aircraft): boolean {
  return !ac.handedOff;
}

export function sampleRadar(ac: Aircraft, groundSpeedKts: Kts): RadarReturn {
  return {
    altitudeFt: ac.altitudeFt,
    iasKts: ac.iasKts,
    headingDeg: ac.headingDeg,
    groundSpeedKts,
    vsFpm: ac.vsFpm,
  };
}
