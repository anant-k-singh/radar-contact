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
import type { Deg, Ft, Kts, Nm, Point, Sec } from '../sim/units.js';
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
  runway: RunwaySpec;
  /**
   * Other runways on the field. Drawn on the scope and nothing else — see
   * `InactiveRunwaySpec`.
   */
  inactiveRunways?: readonly InactiveRunwaySpec[];
  /** Scenery: the coast, if the field is anywhere near one. */
  coastline?: CoastlineSpec;
  airspace: AirspaceSpec;
  gates: readonly EntryGateSpec[];
  stars: readonly StarSpec[];
  sids: readonly SidSpec[];
  fleet: readonly AircraftType[];
  airlines: readonly Airline[];
  traffic?: Partial<TrafficSpec>;
  runwayOps?: Partial<RunwayOpsSpec>;
  facility?: Partial<FacilitySpec>;
}

export interface RunwaySpec {
  /** `18`, `27L`. The number is expected to agree with `courseDeg`. */
  id: string;
  /** Final approach course, i.e. the runway's own heading. Magnetic == true (§3.1 A3). */
  courseDeg: Deg;
  lengthNm: Nm;
  /** Published missed approach altitude. Between the MVA and the ceiling. */
  missedApproachAltitudeFt?: Ft;
  /** How far the extended centreline is drawn, and how often it is ticked. */
  centerlineLengthNm?: Nm;
  centerlineTickNm?: Nm;
}

/**
 * A runway that exists on the field but is not in use.
 *
 * Exactly one runway is ever active (§3.1 A2), and this is not it: nothing under
 * `src/sim/` reads it, so it cannot quietly grow into two-runway logic — the
 * layering test already forbids the sim importing a scenario value. It is here so
 * a field that has more than one strip looks like itself.
 *
 * Stated as its two ends rather than a course and a length: it is never flown, so
 * there is no frame to stay consistent with and no derivation to get wrong.
 */
export interface InactiveRunwaySpec {
  /** Both ends as the chart names them, e.g. `14/32`. */
  id: string;
  /** The two thresholds, in the order the id names them. */
  ends: readonly [FixAt, FixAt];
}

export interface TrafficSpec {
  /** What Center offers by default; the player can turn it up or down. */
  arrivalsPerHour: number;
  departuresPerHour: number;
  /** How long a gate stays quiet after taking one, so a route is not doubled up. */
  gateCooldownS: Sec;
}

/**
 * Everything about sharing one runway between the arrivals and the departures
 * (§4.7). Per-field because it is set by the runway's length and how quickly it
 * can be turned round; a second field inherits the defaults unless it differs.
 */
export interface RunwayOpsSpec {
  /** Roll to roll between consecutive departures, when nothing lands between. */
  minDepartureIntervalS: Sec;
  /** No release with an arrival closer in than this, however slowly it is flying. */
  holdFinalNm: Nm;
  /** No release for this long after a landing, while it is still rolling out. */
  holdAfterLandingS: Sec;
  /** How far the arrival must still be, in time, when the departure ahead rotates. */
  airborneMarginS: Sec;
}

export interface FacilitySpec {
  towerFrequency: string;
  departureFrequency: string;
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
  /**
   * Bearing from the ARP. Without `at`, the gate is placed on the boundary along
   * it — which is what a field whose gates are *designed* wants. With `at`, it is
   * derived from the position instead and this is ignored.
   */
  bearingDeg?: Deg;
  /**
   * Where the gate actually is, for a field transcribing published fixes.
   *
   * A real TMA's entry fixes are at real coordinates and are not all the same
   * range from the field, so forcing them onto one boundary circle moves them —
   * at VABB by up to 8 NM, which bends the first leg of the arrival. When this is
   * given the gate sits exactly here and the airspace simply has to contain it.
   */
  at?: FixAt;
  /**
   * Share of the arrivals this gate is offered, relative to the field's other
   * gates. Defaults to 1, i.e. an even split.
   *
   * A property of the field, not of the job: which direction a real airport's
   * traffic comes from is a fact about the route network around it, and at a
   * field whose gates are 30° apart in one sector and 90° apart in another an
   * even split is the unrealistic choice.
   */
  weight?: number;
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
  /** The common trunk: the fixes every way out of this SID flies first. */
  fixes: readonly SidFixSpec[];
  /**
   * Where the trunk splits. Omit for a SID with one way out.
   *
   * Real SIDs off one runway share their first fixes and then fan out to the
   * airways, and a chart names the whole fan once. Each branch is compiled into
   * its own complete route, so the simulation still only ever sees a flat chain
   * of waypoints — see `compileSid`.
   */
  exits?: readonly SidExitSpec[];
}

export interface SidExitSpec {
  /** Names the branch, and with it the compiled route: `ANOLI2A/ISRIS`. */
  name: string;
  /** Flown after the trunk. The last one is the route's exit fix. */
  fixes: readonly SidFixSpec[];
}

export interface SidFixSpec {
  name: string;
  at: FixAt;
  /** Published "at or below", in force from the start of the route until here. */
  maxAltitudeFt?: Ft;
  /**
   * Published "at or above", in force from here to the end of the route.
   *
   * Nothing reads this to fly the aircraft — a departure is always climbing as
   * hard as it can, so a floor can only be satisfied, never chased. It is read by
   * the validator, which needs it to check the *other* way a crossing restriction
   * works: a chart publishing "at or above FL100" is guaranteeing the departure
   * passes over the arrival rather than under it. Defaults to `topFt` on the last
   * fix, which is the label a chart carries there anyway.
   */
  minAltitudeFt?: Ft;
}

// ── Compiled ────────────────────────────────────────────────────────────────

export interface Scenario {
  id: string;
  name: string;
  icao: string;
  elevationFt: Ft;
  /**
   * Airport reference point, and always the origin of the local frame.
   *
   * Not something a field states: the frame *is* local to the field, so there is
   * nothing to be gained by offsetting it, and a good deal that quietly assumes
   * it — the airspace shape is measured from the origin, and the scope centres on
   * it. Named rather than written as `{0, 0}` so the code says which point it
   * means.
   */
  arp: Point;
  runway: Runway;
  /** Drawn, never flown. Empty for a field with one strip. */
  inactiveRunways: readonly InactiveRunway[];
  /** Drawn, and read by nothing else. Empty for a field that states no coast. */
  coastline: readonly (readonly Point[])[];
  airspace: Airspace;
  gates: readonly EntryGate[];
  stars: readonly Star[];
  sids: readonly Sid[];
  fleet: readonly AircraftType[];
  airlines: readonly Airline[];
  traffic: TrafficSpec;
  runwayOps: RunwayOpsSpec;
  facility: FacilitySpec;
}

export interface Runway extends Required<RunwaySpec> {
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

/**
 * Stretches of coastline, each an open or closed chain of `[x, y]` in the field's
 * local NM frame.
 *
 * Coordinates rather than the `FixAt` closures a route is authored with, and the
 * exception is the point: a `FixAt` exists so a fix can be stated in the frame a
 * chart states it in — on final, off the departure end — and none of that applies
 * to a coast, which is at the coordinates the world put it at. Several hundred
 * closures would also be several hundred allocations to say what two numbers say.
 */
export type CoastlineSpec = readonly (readonly (readonly [Nm, Nm])[])[];

export interface InactiveRunway {
  id: string;
  ends: readonly [Point, Point];
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
  /** Share of the arrivals offered here, relative to the other gates. */
  weight: number;
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
  /**
   * Unique route name, and what a recording stores. `SABAR1A` for a SID with one
   * way out, `ANOLI2A/ISRIS` for one branch of a SID with several.
   */
  name: string;
  /**
   * The published chart name, shared by every branch of one SID. What a log line
   * and a chart label should say; `name` is what identifies the route.
   */
  chart: string;
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
