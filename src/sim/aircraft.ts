import type { AircraftType } from '../scenario/aircraftTypes.js';
import type { Airline } from '../scenario/airlines.js';
import type { SidNav } from './departure.js';
import type { PendingInstruction } from './pilot.js';
import type { StarNav } from './star.js';
import { trueAirspeed, type Deg, type Fpm, type Ft, type Kts, type Nm, type Point, type Sec } from './units.js';

/**
 * Flight state. `handedOff` is deliberately separate from `phase`: an aircraft
 * handed to Tower keeps flying its approach, it just stops taking our commands.
 *
 * `roll` and `climb` are the two departure states (§4.7). A departure is never
 * in any of the arrival states and vice versa, but they share one enumeration
 * because everything that reads a phase — the data block, the recorder's packed
 * flags — wants one field to switch on rather than two to combine.
 */
export type Phase = 'inbound' | 'cleared' | 'loc' | 'gs' | 'goAround' | 'roll' | 'climb';

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
  /**
   * The SID being flown, on a departure, and null on every arrival (§4.7).
   * It is also what makes an aircraft a departure: it is set at the take-off
   * roll and never cleared, since a departure is on Departure's frequency for
   * the whole time it is on our scope and can never be vectored off its route.
   */
  sid: SidNav | null;

  // Approach state
  phase: Phase;
  handedOff: boolean;
  /** Set when the player assigns a speed after the ILS clearance (§6.2). */
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

/**
 * Everything that differs between the two ways an aircraft comes into being.
 * Everything that does not is filled in by `newAircraft`, which is the point:
 * a new field on `Aircraft` is added in one place instead of three.
 */
export interface AircraftSeed {
  id: number;
  callsign: string;
  airline: Airline;
  type: AircraftType;
  position: Point;
  altitudeFt: Ft;
  headingDeg: Deg;
  iasKts: Kts;
  /** What it is flying towards. Defaults to the speed it is doing. */
  targetIasKts?: Kts;
  star?: StarNav | null;
  sid?: SidNav | null;
  phase: Phase;
  /** Entry gate for an arrival, the runway for a departure — where its track starts. */
  entryGate: string;
  spawnedAtS: Sec;
  /**
   * Shortest route anyone could reasonably fly, for the track-mile ratio. Zero
   * on a departure: that ratio is an arrival efficiency measure and a departure
   * never lands, so it has nothing to be compared against.
   */
  directDistanceNm?: Nm;
}

/**
 * A new aircraft, level and steady on what it is doing.
 *
 * The targets start on the live state — an aircraft is flying its assignment the
 * moment it appears — and the first radar return is sampled from that state
 * rather than approximated, so the ground speed on the block agrees with the
 * one the next tick computes.
 */
export function newAircraft(seed: AircraftSeed): Aircraft {
  const { position, altitudeFt, headingDeg, iasKts } = seed;
  return {
    id: seed.id,
    callsign: seed.callsign,
    airline: seed.airline,
    type: seed.type,
    x: position.x,
    y: position.y,
    altitudeFt,
    headingDeg,
    iasKts,
    vsFpm: 0,
    targetHeadingDeg: headingDeg,
    targetAltitudeFt: altitudeFt,
    targetIasKts: seed.targetIasKts ?? iasKts,
    pending: [],
    turnDirection: null,
    star: seed.star ?? null,
    sid: seed.sid ?? null,
    phase: seed.phase,
    handedOff: false,
    speedAssignedAfterClearance: false,
    entryGate: seed.entryGate,
    spawnedAtS: seed.spawnedAtS,
    trackMilesFlown: 0,
    directDistanceNm: seed.directDistanceNm ?? 0,
    goArounds: 0,
    exitWarned: false,
    headingHintUntilS: 0,
    // Starts empty: a freshly handed-over target has no history behind it.
    trail: [],
    radar: {
      altitudeFt,
      iasKts,
      headingDeg,
      groundSpeedKts: trueAirspeed(iasKts, altitudeFt),
      vsFpm: 0,
    },
    alert: 'none',
  };
}

export function aircraftPosition(ac: Aircraft): Point {
  return { x: ac.x, y: ac.y };
}

/**
 * True on a departure. Departures are with Departure Control, not with us: they
 * fly their SID and leave, and the only thing the player can do about one is
 * keep the arrivals away from it (§4.7).
 */
export function isDeparture(ac: Aircraft): boolean {
  return ac.sid !== null;
}

/** True while the player may issue instructions. */
export function isControllable(ac: Aircraft): boolean {
  return !ac.handedOff && !isDeparture(ac);
}

/**
 * True while the aircraft is drawn in the muted shade reserved for traffic the
 * player has no authority over — handed to Tower, or never theirs to begin with.
 */
export function isDimmed(ac: Aircraft): boolean {
  return ac.handedOff || isDeparture(ac);
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
