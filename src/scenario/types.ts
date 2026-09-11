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
  /**
   * Which controller's position this field is. Defaults to `approach`.
   *
   * A role is a property of the *facility* rather than of the field, which sits
   * awkwardly beside the rule that `constants.ts` holds the job and the
   * `Scenario` holds the field. It rides here because a field is one position at
   * one facility — VABB approach and the sector feeding it are two scenarios, not
   * one scenario with a switch — and because the layering rules leave no other
   * channel: nothing under `src/sim/` or `src/render/` may import a scenario
   * value, so a mode flag has to arrive on the compiled `Scenario` they are
   * handed.
   */
  role?: FacilityRole;
  runway: RunwaySpec;
  /**
   * Other runways on the field. Drawn on the scope and nothing else — see
   * `InactiveRunwaySpec`.
   */
  inactiveRunways?: readonly InactiveRunwaySpec[];
  /** Scenery: the coast, if the field is anywhere near one. */
  coastline?: CoastlineSpec;
  /** Scenery: high ground, if the field has any worth shading. */
  terrain?: TerrainSpec;
  airspace: AirspaceSpec;
  gates: readonly EntryGateSpec[];
  /**
   * What the next sector down has asked for, per fix a stream is delivered to.
   * Meaningful only on a `center` field; a `approach` field states none.
   */
  delivery?: readonly DeliveryGateSpec[];
  stars: readonly StarSpec[];
  sids: readonly SidSpec[];
  fleet: readonly AircraftType[];
  airlines: readonly Airline[];
  performance?: Partial<PerformanceSpec>;
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

/**
 * What the *air* at this field does to what an aircraft can do in it.
 *
 * The fleet's performance figures are book numbers — EUROCONTROL APD, quoted at
 * a temperate day — and a field is entitled to say its air is not that. Mumbai
 * in May is 35 °C at sea level, a density altitude around 2500 ft, and a
 * departure out of it does not climb at book rate.
 *
 * A scale rather than a table of its own: the *relative* performance of the six
 * types is a fact about the airframes and stays wherever the airframes are
 * described, while how much of it today's air gives back is a fact about the
 * field. One number keeps those two apart, so a new field states its climate
 * and inherits the fleet.
 */
export interface PerformanceSpec {
  /**
   * Fraction of book climb rate a departure achieves here. 1 is the book
   * figure; below it the aircraft climbs more shallowly and, because climb is
   * served before acceleration out of one budget (§4.3), has *more* left to
   * accelerate with — which is the right way round, since it is the air that is
   * thin, not the engines that are throttled.
   */
  departureClimbScale: number;
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
  /** Who a center sector hands its arrivals to. Unused at an approach field. */
  approachFrequency: string;
}

/**
 * Which job the player is doing at this field.
 *
 * `approach` takes arrivals from a gate and puts them on the ILS. `center` takes
 * them at cruise from much further out and *delivers* them to a gate, which is
 * the same boundary read from the other side: a center field's routes end where
 * an approach field's begin.
 */
export type FacilityRole = 'approach' | 'center';

/**
 * A fix a center field delivers a stream to, and the rate the next sector wants
 * it at (§3.2a).
 *
 * The rate is the whole objective. It is miles-in-trail expressed as the thing
 * the receiving controller actually cares about — 10 an hour is a six-minute
 * interval — and it is stated per fix because a sector feeding two gates has to
 * satisfy both independently: filling one and starving the other is not a
 * sector that delivered 24 an hour.
 */
export interface DeliveryGateSpec {
  /** The fix this stream is delivered to: the last waypoint of its routes. */
  fixName: string;
  /** What the next sector down has asked for. */
  targetRatePerHour: number;
}

/**
 * How the boundary is shaped.
 *
 * `chordedCircle` is the original and the default: a circle centred on the ARP
 * with its north and south caps cut off, which is what a terminal area looks
 * like on a screen. `sector` is an annular wedge — an inner arc, an outer arc
 * and two radials — which is what one en-route sector actually is, and it is why
 * a center field can own the ground between 50 and 180 NM on one side of the
 * field without also owning the other side.
 *
 * Both are measured from the ARP, so `Scenario.arp` stays the origin of the
 * frame and every `FixAt` closure keeps working. What a sector field does move
 * is where the *scope* is centred — see `Scenario.scopeCentre`.
 */
export type AirspaceShape =
  | { kind: 'chordedCircle' }
  | {
      kind: 'sector';
      /** Inner arc: where the next sector down begins. */
      innerNm: Nm;
      /**
       * The wedge runs clockwise from `fromDeg` to `toDeg`, and may wrap through
       * north: 300 → 060 is a 120° wedge over the top, not a 240° one under it.
       */
      fromDeg: Deg;
      toDeg: Deg;
    };

export interface AirspaceSpec {
  radiusNm: Nm;
  /**
   * The circle's caps are cut off by chords this far either side of the airport,
   * measured across the final approach course. Equal to `radiusNm` for an uncut
   * circle, and defaulted to it. Ignored by a `sector` shape, which has no caps.
   */
  halfHeightNm?: Nm;
  /** Defaults to the chorded circle every approach field uses. */
  shape?: AirspaceShape;
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
  /**
   * Entry gate. Its position becomes waypoint 0; at most one route per gate.
   * Omit on a route with `entries`, where each entry names its own.
   */
  gate?: string;
  /**
   * The crossing published at the gate — what the previous sector hands the
   * arrival over at.
   *
   * This lives on the route rather than on the gate because it is a property of
   * the arrival's geometry: a route with a short run to the localizer has to be
   * given the height off lower, and it is the route that knows that. Omit on a
   * route with `entries`, for the same reason each entry names its own gate.
   */
  entryAltitudeFt?: Ft;
  entrySpeedKts?: Kts;
  /** The common trunk: the fixes every way *in* to this route flies last. */
  fixes: readonly StarFixSpec[];
  /**
   * Where the route is fed from. Omit for a route with one way in.
   *
   * The mirror of `SidSpec.exits`, and it exists for the mirror reason: real
   * arrivals converge on a common trunk from several airways, and a chart names
   * the whole funnel once. Each entry is compiled into its own complete `Star`
   * re-carrying the trunk, so the simulation still only ever sees a flat chain of
   * waypoints — see `compileStar`.
   *
   * The one place it is *not* a mirror is where the gate goes. A SID's branches
   * share one origin — the runway — and diverge from it; a STAR's entries have
   * different origins and converge, so each names its own gate and its own entry
   * crossing rather than inheriting one.
   */
  entries?: readonly StarEntrySpec[];
}

/**
 * One way in to a route's trunk: an airway feeding it from a gate of its own.
 *
 * The entry crossing is per entry and not per trunk because a route's own length
 * decides what it can be given — the fact `fields/vabb/stars.ts` records about
 * EMRAK 2A. A 180 NM feed and a 90 NM feed onto one trunk cannot be handed over
 * at the same level.
 */
export interface StarEntrySpec {
  /** Names the branch, and with it the compiled route: `KETOR2A/PARAR`. */
  name: string;
  /** This entry's own gate. */
  gate: string;
  entryAltitudeFt: Ft;
  entrySpeedKts: Kts;
  /** Flown before the trunk. */
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
  /**
   * Share of the departures released down this SID, relative to the field's
   * others. Defaults to 1, i.e. an even split.
   *
   * The mirror of `EntryGateSpec.weight`, and a property of the field for the
   * same reason: which way an airport's traffic *leaves* is a fact about the
   * route network around it. At LSGG the busiest way out carries four times the
   * quietest. A branching SID declares it once and every exit inherits it — the
   * fan is one clearance as far as the flow is concerned.
   */
  weight?: number;
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
  /**
   * Hold this fix until the aircraft is at or above this level, then turn.
   *
   * The one place a SID's vertical state gates its lateral one, and it is opt-in
   * because almost no chart does it. LSGG's do: every RWY 22 sheet reads **"turn
   * when passing 7000, but not before PAS"**, because Geneva sits in a valley and
   * a departure that turns early flies into the Jura rather than over it. Without
   * it the turn is purely lateral — the aircraft rounds PAS at whatever height it
   * happens to have — and the A332, the only type in the fleet climbing at 2000
   * fpm, crossed the ridge 490 ft *below* its 7000 MSA.
   *
   * Distinct from `minAltitudeFt`, which the validator reads and which describes
   * what the aircraft does anyway. This one is read by `stepDeparture` and changes
   * what it does, so the two must not be conflated: VABB publishes floors at fixes
   * its departures pass far above, and gating those turns would have them orbiting
   * a fix waiting for a level they had already climbed through.
   */
  turnAtOrAboveFt?: Ft;
}

// ── Compiled ────────────────────────────────────────────────────────────────

export interface Scenario {
  id: string;
  name: string;
  icao: string;
  elevationFt: Ft;
  /** Which job this field is (`ScenarioSpec.role`). */
  role: FacilityRole;
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
  /** Drawn, and read by nothing else. Empty for a field that states no terrain. */
  terrain: readonly TerrainBand[];
  airspace: Airspace;
  gates: readonly EntryGate[];
  /** Empty at an approach field. */
  delivery: readonly DeliveryGate[];
  stars: readonly Star[];
  /**
   * Sets of STARs that become one stream before the end, keyed by the fix they
   * become it at — derived by `compileScenario`, never authored.
   *
   * A field whose routes only touch at a fix needs none of this: VABB's cross at
   * different levels, which is what keeps them apart. LSGG's do something else —
   * three routes are coincident for 40 NM, same fixes and same levels, one behind
   * the other. There is no vertical split to be had because there is no lateral
   * separation to deconflict.
   *
   * What separates them there is the *delivery interval*: `traffic.ts` cools down
   * a whole group rather than a single gate, so a merge is offered traffic at the
   * rate one route would be. Empty for a field with no shared trunks.
   */
  mergeGroups: readonly MergeGroup[];
  /** The streams the arrival spawner meters, one clock each (§4.4). */
  arrivalStreams: readonly ArrivalStream[];
  sids: readonly Sid[];
  fleet: readonly AircraftType[];
  airlines: readonly Airline[];
  performance: PerformanceSpec;
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

/**
 * High ground, as bands of closed rings in the field's local NM frame.
 *
 * One entry per band, `[levelFt, rings]`, ordered low to high — which is also the
 * order it is drawn in, each band filling over the one below. A ring encloses
 * ground needing at least its level, so a higher band lies inside a lower one
 * wherever both cover the same hill.
 *
 * **`levelFt` is a minimum safe altitude, not a ground elevation.** It is the
 * figure the scope prints, so it has to be the one a controller would read: the
 * terrain plus its obstacle clearance. A field converting from a source keyed by
 * elevation has to add that itself — see `fields/vabb/terrain.ts`, where getting
 * this backwards understated every band by 2000 ft.
 *
 * Coordinate pairs rather than the `FixAt` closures a route is authored with, for
 * the reason `CoastlineSpec` gives: a `FixAt` exists so a fix can be stated in the
 * frame a chart states it in, and none of that applies to a hill.
 *
 * A whole number of thousands. Nothing enforces it — it is what a field's own
 * conversion produces, and what lets the scope label a band.
 */
export type TerrainSpec = readonly (readonly [Ft, readonly (readonly (readonly [Nm, Nm])[])[]])[];

/**
 * A set of STARs that run together from `fixName` to the end of their routes.
 *
 * Membership is by coincidence of geometry rather than by declaration: two routes
 * are in a group when they share a fix and everything after it. That makes it a
 * fact about the field's own coordinates, which is where it belongs — a field
 * cannot claim a merge it does not fly, or forget one it does.
 */
export interface MergeGroup {
  /** Where the routes become one stream. */
  fixName: string;
  /** The STAR names sharing it, in the order the field declares them. */
  starNames: readonly string[];
}

/**
 * One stream of arriving traffic, and the unit the spawner meters (§4.4).
 *
 * A stream is a merge group where the field has one, and a lone gate where it
 * does not, so every gate belongs to exactly one. That is the whole point: the
 * spawner runs a clock per stream rather than one for the sector, and a stream
 * that is blocked can no longer starve the others — which is what a single
 * weighted draw over every gate did, since a draw for a busy gate stalled the
 * sector instead of feeding whoever was free.
 *
 * `share` is what the stream is owed out of the flow, and `gates` are weighted
 * *within* it. Splitting the draw in two that way leaves every declared ratio
 * untouched: VABBS still offers AGELA twice what it offers EPKOS, and KABSO five
 * times what it offers SUGID.
 */
export interface ArrivalStream {
  /** The merge fix, or the gate's own name where the stream is a single gate. */
  key: string;
  /** The gates feeding it, each keeping the weight the field declared. */
  gateNames: readonly string[];
  /**
   * This stream's portion of the arrival flow.
   *
   * A center field reads it from the delivery agreement the stream feeds, so the
   * sector is offered traffic in the proportions it has promised to hand on. Any
   * other field sums its gates' weights, which is the same statement made by the
   * only means an approach field has. Shares are relative — `flowPerHour` is
   * divided among them — so they need not sum to anything in particular.
   */
  share: number;
}

/** A compiled terrain band: one minimum safe altitude and the rings needing it. */
export interface TerrainBand {
  levelFt: Ft;
  rings: readonly (readonly Point[])[];
}

export interface InactiveRunway {
  id: string;
  ends: readonly [Point, Point];
}

export interface Airspace extends AirspaceSpec {
  halfHeightNm: Nm;
  shape: AirspaceShape;
  /** The box the scope fits itself to. Derived from the shape; see `ViewBox`. */
  view: ViewBox;
  /** Half-width of each chord — where it meets the circle. */
  chordHalfWidthNm: Nm;
  /** Half-angle of each surviving arc, measured from due east/west. */
  arcHalfAngleRad: number;
}

/**
 * The smallest box containing the airspace — where the scope looks, and how much
 * of the frame it has to show.
 *
 * At an approach field this is the airport with the radius either side, which is
 * what the scope has always fitted. A sector is the reason it has to be stated:
 * an annular wedge from 50 to 180 NM on one side of the field puts the field
 * itself in a corner, and centring on the ARP would spend most of the canvas on
 * ground nobody controls.
 *
 * So the *view* gets its own centre while the *frame* keeps the ARP as its
 * origin. The airspace shape, every `FixAt` closure and every range ring are
 * still measured from the field — a range ring is DME from the field, which is
 * what a controller reads off it.
 *
 * Read by `createProjection` and by nothing else.
 */
export interface ViewBox {
  centre: Point;
  halfWidthNm: Nm;
  halfHeightNm: Nm;
}

/** A compiled delivery fix: where a stream leaves, and how fast it is wanted. */
export interface DeliveryGate extends DeliveryGateSpec {
  /** The fix's position, taken from the routes that end there. */
  position: Point;
  /** The routes delivering to it, by compiled name. */
  starNames: readonly string[];
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
  /**
   * Unique route name, and what a recording stores. `VANDA1A` for a route with
   * one way in, `KETOR2A/PARAR` for one entry of a route with several.
   */
  name: string;
  /**
   * The published chart name, shared by every entry onto one trunk. What a log
   * line and a chart label should say; `name` is what identifies the route.
   */
  chart: string;
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
  /** Gate the turn off this fix until at or above this level (`SidFixSpec`). */
  turnAtOrAboveFt?: Ft;
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
  /** Share of the departures released down this route, relative to the others. */
  weight: number;
  waypoints: readonly SidWaypoint[];
  lengthNm: Nm;
}
