/**
 * What a scenario is, in two families.
 *
 * `XxxSpec` is what an author writes; `Xxx` is what the simulation consumes, and
 * `compileScenario` is the only thing that turns one into the other. The split
 * is what lets a field declare its routes in the terms a chart uses — this far
 * out on final, that far abeam — while the sim still gets plain positions and
 * precomputed distances.
 *
 * This file imports nothing but units. Everything a field needs is declared
 * here or defaulted in `defaults.ts`, so the data layer never reaches back into
 * `src/sim/constants.ts` for a number that is really a property of the field.
 */
import type { Deg, Ft, Kts, Nm, Point } from '../sim/units.js';
import type { AircraftType } from './aircraftTypes.js';
import type { Airline } from './airlines.js';
import type { FixAt } from './geometry.js';

// ── Authored ────────────────────────────────────────────────────────────────

export interface ScenarioSpec {
  /** Registry key, the `?airport=` value, and the map layer's cache key. */
  id: string;
  name: string;
  icao: string;
  elevationFt: Ft;
  /** Airport reference point. Defaults to the origin of the local frame. */
  arp?: Point;
  runway: RunwaySpec;
  airspace: AirspaceSpec;
  gates: readonly EntryGateSpec[];
  stars: readonly StarSpec[];
  sids: readonly SidSpec[];
  fleet: readonly AircraftType[];
  airlines: readonly Airline[];
}

export interface RunwaySpec {
  /** `18`, `27L`. The number is expected to agree with `courseDeg`. */
  id: string;
  /** Final approach course, i.e. the runway's own heading. Magnetic == true (§3.1 A3). */
  courseDeg: Deg;
  lengthNm: Nm;
}

export interface AirspaceSpec {
  radiusNm: Nm;
  /**
   * The circle's caps are cut off by chords this far either side of the airport,
   * measured across the final approach course. Equal to `radiusNm` for an uncut
   * circle.
   */
  halfHeightNm: Nm;
  /** Minimum vectoring altitude, everywhere inside the boundary. */
  mvaFt: Ft;
  /** The top of what the controller may assign. */
  ceilingFt: Ft;
  rangeRingsNm: readonly Nm[];
}

export interface EntryGateSpec {
  name: string;
  /** Bearing from the ARP. The gate is placed on the boundary along it. */
  bearingDeg: Deg;
  /**
   * How Center delivers to a gate with **no** published STAR. Declare these only
   * for such a gate: when a STAR names this gate, its own entry crossing is used
   * instead, and declaring both is a validation error.
   */
  entryAltitudeFt?: Ft;
  entrySpeedKts?: Kts;
}

export interface StarSpec {
  /** Chart name, e.g. `VANDA1A`. */
  name: string;
  /** Entry gate. Its position becomes waypoint 0; at most one STAR per gate. */
  gate: string;
  /**
   * The crossing published at the gate — what Center hands the arrival over at.
   *
   * This lives on the route rather than on the gate because it is a property of
   * the arrival's geometry: a route with a short run to the localizer has to be
   * given the height off lower, and it is the route that knows that.
   */
  entryAltitudeFt: Ft;
  entrySpeedKts: Kts;
  fixes: readonly StarFixSpec[];
}

export interface StarFixSpec {
  name: string;
  /** Where the fix is. Omit when `fraction` places it on the leg instead. */
  at?: FixAt;
  /**
   * A reporting point that simply sits this far along the straight leg between
   * its two positioned neighbours — 0.5 is the midpoint. Resolved in a second
   * pass, so it needs no forward reference to the fix after it.
   */
  fraction?: number;
  altitudeFt?: Ft;
  speedKts?: Kts;
}

export interface SidSpec {
  name: string;
  /** Top of the departure climb. Defaults to `airspace.ceilingFt + 1000`. */
  topFt?: Ft;
  fixes: readonly SidFixSpec[];
}

export interface SidFixSpec {
  name: string;
  at: FixAt;
  /** Published "at or below", in force from the start of the route until here. */
  maxAltitudeFt?: Ft;
  /**
   * Published "at or above". Nothing reads this to fly the aircraft — a departure
   * is always climbing as hard as it can — so it is documentation on the chart
   * and what the performance tests assert against. Defaults to `topFt` on the
   * last fix, which is the label a chart carries there anyway.
   */
  minAltitudeFt?: Ft;
}

// ── Compiled ────────────────────────────────────────────────────────────────

export interface Scenario {
  id: string;
  name: string;
  icao: string;
  elevationFt: Ft;
  arp: Point;
  runway: Runway;
  airspace: Airspace;
  gates: readonly EntryGate[];
  stars: readonly Star[];
  sids: readonly Sid[];
  fleet: readonly AircraftType[];
  airlines: readonly Airline[];
}

export interface Runway {
  id: string;
  /** Final approach course, i.e. the runway's own heading. */
  courseDeg: Deg;
  lengthNm: Nm;
  /**
   * Threshold elevation, i.e. the field's. Carried here so that everything doing
   * approach geometry — the glideslope, the runway environment, a departure's AGL
   * — needs the runway and nothing else.
   */
  elevationFt: Ft;
  /** Landing threshold — the point the glideslope aims at. */
  threshold: Point;
  /** Unit vector along the landing direction. */
  direction: Point;
  /** Departure end: where every SID starts, and the far end for drawing. */
  farEnd: Point;
}

export interface Airspace extends AirspaceSpec {
  /** Half-width of each chord — where it meets the circle. */
  chordHalfWidthNm: Nm;
  /** Half-angle of each surviving arc, measured from due east/west. */
  arcHalfAngleRad: number;
}

export interface EntryGate {
  name: string;
  /** Bearing of the gate from the airport reference point. */
  bearingDeg: Deg;
  /** On the boundary along `bearingDeg` — the chord where the arc has been cut. */
  position: Point;
  /** Handover heading: direct to the airport reference point. */
  inboundHeadingDeg: Deg;
  /** Altitude Center hands the arrival over at (§4.4). Taken from the STAR. */
  entryAltitudeFt: Ft;
  /** Speed Center hands the arrival over at. Taken from the STAR. */
  entrySpeedKts: Kts;
}

export interface StarWaypoint {
  name: string;
  position: Point;
  /** Published crossing altitude, if the fix has one. */
  altitudeFt?: Ft;
  /** Published crossing speed, if the fix has one. */
  speedKts?: Kts;
  /** Route distance from this fix to the end of the STAR ("distance to go"). */
  dtgNm: Nm;
}

/** A published value pinned to a point on the route, keyed by distance to go. */
export interface StarConstraint {
  dtgNm: Nm;
  value: number;
}

export interface Star {
  /** Chart name, e.g. `VANDA1A`. */
  name: string;
  gate: string;
  waypoints: readonly StarWaypoint[];
  lengthNm: Nm;
  /** Both lists run from the gate inwards, i.e. by decreasing distance to go. */
  altitudes: readonly StarConstraint[];
  speeds: readonly StarConstraint[];
}

export interface SidWaypoint {
  name: string;
  position: Point;
  maxAltitudeFt?: Ft;
  minAltitudeFt?: Ft;
  /** Route distance from the departure end of the runway to this fix. */
  alongNm: Nm;
}

export interface Sid {
  /** Chart name, e.g. `SABAR1A`. */
  name: string;
  /**
   * Which way it turns off the runway — what the chart and the log line say.
   * Derived from the geometry, never declared, so it cannot disagree with it.
   */
  turn: 'left' | 'right' | 'straight';
  /** Top of the climb once every restriction is behind it. */
  topFt: Ft;
  waypoints: readonly SidWaypoint[];
  lengthNm: Nm;
}
