/**
 * Turn an authored `ScenarioSpec` into the `Scenario` the simulation flies.
 *
 * Everything derived happens here and only here: the runway frame, the gate
 * positions, every fix's coordinates, the cumulative route distances, the
 * constraint lists, and which way each SID turns. A field file therefore states
 * facts and nothing else, and two fields cannot disagree about how a fact
 * becomes geometry.
 */
import { boundaryRangeAtBearing, compileAirspace } from './airspace.js';
import {
  DEFAULT_FACILITY,
  DEFAULT_PERFORMANCE,
  DEFAULT_RUNWAY,
  DEFAULT_RUNWAY_OPS,
  DEFAULT_TRAFFIC,
} from './defaults.js';
import { lerp, turnOf, type FixContext } from './geometry.js';
import type {
  EntryGate,
  InactiveRunway,
  Runway,
  RunwaySpec,
  Scenario,
  ScenarioSpec,
  Sid,
  SidFixSpec,
  SidSpec,
  SidWaypoint,
  Star,
  StarConstraint,
  StarSpec,
  StarWaypoint,
} from './types.js';
import { bearing, distance, headingVector, type Deg, type Ft, type Point } from '../sim/units.js';

/** How far above the assignable ceiling a departure levels off (§4.7). */
const DEPARTURE_TOP_MARGIN_FT = 1000;

/**
 * A spec's own values, with the keys it left out dropped rather than spread as
 * `undefined` — which would otherwise overwrite the defaults it means to inherit.
 */
function definedOnly<T extends object>(spec: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(spec).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

function compileRunway(spec: RunwaySpec, arp: Point, elevationFt: Ft): Runway {
  const direction = headingVector(spec.courseDeg);
  // Centre the runway on the airport reference point.
  const threshold: Point = {
    x: arp.x - (direction.x * spec.lengthNm) / 2,
    y: arp.y - (direction.y * spec.lengthNm) / 2,
  };
  return {
    ...DEFAULT_RUNWAY,
    ...definedOnly(spec),
    id: spec.id,
    courseDeg: spec.courseDeg,
    lengthNm: spec.lengthNm,
    elevationFt,
    threshold,
    direction,
    farEnd: {
      x: threshold.x + direction.x * spec.lengthNm,
      y: threshold.y + direction.y * spec.lengthNm,
    },
  };
}

/**
 * Resolve the positions of a route's fixes, then fill in the ones declared as a
 * fraction of the leg between their positioned neighbours.
 *
 * `anchors` is the run of positions already known; a fractional fix is placed
 * between the last one before it and the first one after, so a reporting point
 * needs no forward reference to the fix it precedes.
 */
function resolvePositions(
  declared: readonly (Point | null)[],
  fractions: readonly (number | undefined)[],
  label: string,
): Point[] {
  const out = declared.slice();
  for (let i = 0; i < out.length; i += 1) {
    if (out[i] !== null) continue;
    const fraction = fractions[i];
    if (fraction === undefined) throw new Error(`${label}: fix ${i} has neither a position nor a fraction`);

    let before = i - 1;
    while (before >= 0 && declared[before] === null) before -= 1;
    let after = i + 1;
    while (after < out.length && declared[after] === null) after += 1;
    if (before < 0 || after >= out.length) {
      throw new Error(`${label}: fix ${i} is placed on a leg with no positioned fix on both sides`);
    }
    out[i] = lerp(declared[before]!, declared[after]!, fraction);
  }
  return out as Point[];
}

function compileStar(spec: StarSpec, gate: EntryGate, ctx: FixContext): Star {
  const routeCtx: FixContext = { ...ctx, gate };
  const positions = resolvePositions(
    // The gate itself is the first fix: Center delivers the aircraft to it at the
    // published altitude and speed, so the profile starts there.
    [gate.position, ...spec.fixes.map((fix) => (fix.at ? fix.at(routeCtx) : null))],
    [undefined, ...spec.fixes.map((fix) => fix.fraction)],
    spec.name,
  );

  const waypoints: StarWaypoint[] = [
    {
      name: gate.name,
      position: positions[0]!,
      altitudeFt: spec.entryAltitudeFt,
      speedKts: spec.entrySpeedKts,
      dtgNm: 0,
    },
    ...spec.fixes.map((fix, i) => ({
      name: fix.name,
      position: positions[i + 1]!,
      altitudeFt: fix.altitudeFt,
      speedKts: fix.speedKts,
      dtgNm: 0,
    })),
  ];

  for (let i = waypoints.length - 2; i >= 0; i -= 1) {
    waypoints[i]!.dtgNm = waypoints[i + 1]!.dtgNm + distance(waypoints[i]!.position, waypoints[i + 1]!.position);
  }

  const pick = (read: (wpt: StarWaypoint) => number | undefined): StarConstraint[] =>
    waypoints
      .filter((wpt) => read(wpt) !== undefined)
      .map((wpt) => ({ dtgNm: wpt.dtgNm, value: read(wpt)! }));

  return {
    name: spec.name,
    gate: gate.name,
    waypoints,
    lengthNm: waypoints[0]!.dtgNm,
    altitudes: pick((wpt) => wpt.altitudeFt),
    speeds: pick((wpt) => wpt.speedKts),
  };
}

/**
 * Compile one SID into one route per way out of it.
 *
 * A branching SID is flattened rather than modelled: each exit becomes a
 * complete `Sid` carrying the trunk again, so the simulation never learns that a
 * route can fork. `stepDeparture`, `ceilingAtFt` and the route sequencer all keep
 * seeing a flat chain of waypoints and an index into it, and a recording still
 * resolves a route by a single unique name.
 *
 * The duplicated trunk costs only the chart drawing, which paints the shared
 * legs once per branch — identical strokes, so it is invisible, but `mapLayer`
 * dedupes the *labels*.
 */
function compileSid(spec: SidSpec, ctx: FixContext, defaultTopFt: Ft): Sid[] {
  const topFt = spec.topFt ?? defaultTopFt;
  const branches: readonly { suffix: string; fixes: readonly SidFixSpec[] }[] =
    spec.exits === undefined
      ? // One way out: the route keeps the chart's own name, so a field with no
        // branching SIDs is named exactly as it was before exits existed.
        [{ suffix: '', fixes: spec.fixes }]
      : spec.exits.map((exit) => ({ suffix: `/${exit.name}`, fixes: [...spec.fixes, ...exit.fixes] }));

  return branches.map(({ suffix, fixes }) => {
    const waypoints: SidWaypoint[] = [
      // The departure end of the runway is the first waypoint: it is where the
      // route starts on the chart, and the aircraft is already past it by the time
      // it is tracking anything. Nothing is published there.
      { name: `RWY${ctx.runway.id}`, position: ctx.runway.farEnd, alongNm: 0 },
      ...fixes.map((fix) => ({
        name: fix.name,
        position: fix.at(ctx),
        maxAltitudeFt: fix.maxAltitudeFt,
        minAltitudeFt: fix.minAltitudeFt,
        alongNm: 0,
      })),
    ];

    // The chart labels the top of climb at the last fix, so default it there.
    const last = waypoints[waypoints.length - 1]!;
    if (last.minAltitudeFt === undefined && last.maxAltitudeFt === undefined) {
      last.minAltitudeFt = topFt;
    }

    for (let i = 1; i < waypoints.length; i += 1) {
      waypoints[i]!.alongNm =
        waypoints[i - 1]!.alongNm + distance(waypoints[i - 1]!.position, waypoints[i]!.position);
    }

    return {
      name: `${spec.name}${suffix}`,
      chart: spec.name,
      // Per branch, and deliberately: `turnOf` takes the first leg more than
      // `STRAIGHT_OUT_DEG` off the runway course, so a trunk that carries the
      // turn — which is the usual shape, and all three of VABB's — gives every
      // branch the label the chart prints. A trunk that goes straight out
      // instead leaves the first turn to the branch, and two branches leaving
      // opposite sides then report opposite turns, which is what they fly.
      turn: turnOf(ctx.runway, waypoints),
      topFt,
      waypoints,
      lengthNm: last.alongNm,
    };
  });
}

export function compileScenario(spec: ScenarioSpec): Scenario {
  // The local frame is the field's own, so its reference point is the origin.
  const arp: Point = { x: 0, y: 0 };
  const runway = compileRunway(spec.runway, arp, spec.elevationFt);
  const airspace = compileAirspace(spec.airspace);
  const ctx: FixContext = { runway, arp };

  // A gate either states where it is, or is placed on the boundary along its
  // bearing. On the boundary — not at the radius — because past the arcs the
  // boundary is a chord, and using the radius would put a gate outside the drawn
  // shape and several miles from its own marker.
  const gates: EntryGate[] = spec.gates.map((gateSpec) => {
    let position: Point;
    let bearingDeg: Deg;
    if (gateSpec.at) {
      position = gateSpec.at(ctx);
      bearingDeg = bearing(arp, position);
    } else if (gateSpec.bearingDeg !== undefined) {
      bearingDeg = gateSpec.bearingDeg;
      const v = headingVector(bearingDeg);
      const rangeNm = boundaryRangeAtBearing(airspace, bearingDeg);
      position = { x: arp.x + v.x * rangeNm, y: arp.y + v.y * rangeNm };
    } else {
      throw new Error(`${spec.id}: gate ${gateSpec.name} states neither a bearing nor a position`);
    }
    const star = spec.stars.find((candidate) => candidate.gate === gateSpec.name);
    const entryAltitudeFt = star?.entryAltitudeFt ?? gateSpec.entryAltitudeFt;
    const entrySpeedKts = star?.entrySpeedKts ?? gateSpec.entrySpeedKts;
    if (entryAltitudeFt === undefined || entrySpeedKts === undefined) {
      throw new Error(
        `${spec.id}: gate ${gateSpec.name} has no STAR, so it must declare its own entry altitude and speed`,
      );
    }
    return {
      name: gateSpec.name,
      bearingDeg,
      position,
      inboundHeadingDeg: bearing(position, arp),
      entryAltitudeFt,
      entrySpeedKts,
      weight: gateSpec.weight ?? 1,
    };
  });

  const gateByName = new Map(gates.map((gate) => [gate.name, gate]));
  const stars = spec.stars.map((starSpec) => {
    const gate = gateByName.get(starSpec.gate);
    if (!gate) throw new Error(`${starSpec.name}: no entry gate named ${starSpec.gate}`);
    return compileStar(starSpec, gate, ctx);
  });

  const defaultTopFt = airspace.ceilingFt + DEPARTURE_TOP_MARGIN_FT;
  const sids = spec.sids.flatMap((sidSpec) => compileSid(sidSpec, ctx, defaultTopFt));

  return {
    id: spec.id,
    name: spec.name,
    icao: spec.icao,
    elevationFt: spec.elevationFt,
    arp,
    runway,
    inactiveRunways: (spec.inactiveRunways ?? []).map(
      (other): InactiveRunway => ({ id: other.id, ends: [other.ends[0](ctx), other.ends[1](ctx)] }),
    ),
    // The one thing compiled by being turned from pairs into points, because a
    // coastline is already in the frame — see `CoastlineSpec`.
    coastline: (spec.coastline ?? []).map((chain) => chain.map(([x, y]) => ({ x, y }))),
    airspace,
    gates,
    stars,
    sids,
    fleet: spec.fleet,
    airlines: spec.airlines,
    performance: { ...DEFAULT_PERFORMANCE, ...definedOnly(spec.performance ?? {}) },
    traffic: { ...DEFAULT_TRAFFIC, ...definedOnly(spec.traffic ?? {}) },
    runwayOps: { ...DEFAULT_RUNWAY_OPS, ...definedOnly(spec.runwayOps ?? {}) },
    facility: { ...DEFAULT_FACILITY, ...definedOnly(spec.facility ?? {}) },
  };
}
