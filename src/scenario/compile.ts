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
import { identicalTailLength } from './routes.js';
import type {
  ArrivalStream,
  DeliveryGate,
  EntryGate,
  InactiveRunway,
  MergeGroup,
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
  StarFixSpec,
  StarSpec,
  StarWaypoint,
} from './types.js';
import { bearing, distance, headingVector, type Deg, type Ft, type Kts, type Point } from '../sim/units.js';

/**
 * Where a departure levels off with every restriction behind it — a cruise level,
 * not a margin over the ceiling. The old `ceilingFt + 1000` made an arbitrary
 * number look like a restriction and caused the conflict it prevented: MEDAM 1A
 * sat at 21,000 against a KINES 2R arrival at 20,000, head-on at the boundary.
 * Safe to raise because `departureClimbRateFpm` decays above 10,000.
 */
const DEPARTURE_TOP_FT = 30_000;

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

/**
 * One way in to a route: the trunk with one entry's fixes in front of it.
 *
 * The mirror of the `{ suffix, fixes }` branch `compileSid` builds, and it
 * differs in exactly one way: a SID's branches share the runway as their origin,
 * while a STAR's entries each have a gate and an entry crossing of their own,
 * because a route's own length decides what it can be handed over at.
 */
interface StarBranch {
  name: string;
  gate: string;
  entryAltitudeFt: Ft;
  entrySpeedKts: Kts;
  fixes: readonly StarFixSpec[];
}

/** Every way in to one authored route. One element unless it declares `entries`. */
function starBranches(spec: StarSpec): StarBranch[] {
  if (spec.entries === undefined) {
    if (
      spec.gate === undefined ||
      spec.entryAltitudeFt === undefined ||
      spec.entrySpeedKts === undefined
    ) {
      throw new Error(
        `${spec.name}: a route with no entries must state its own gate, entry altitude and entry speed`,
      );
    }
    // One way in: the route keeps the chart's own name, so a field with no
    // multi-entry routes is named exactly as it was before entries existed.
    return [
      {
        name: spec.name,
        gate: spec.gate,
        entryAltitudeFt: spec.entryAltitudeFt,
        entrySpeedKts: spec.entrySpeedKts,
        fixes: spec.fixes,
      },
    ];
  }
  if (spec.gate !== undefined) {
    throw new Error(`${spec.name}: a route with entries must not also name a gate of its own`);
  }
  return spec.entries.map((entry) => ({
    name: `${spec.name}/${entry.name}`,
    gate: entry.gate,
    entryAltitudeFt: entry.entryAltitudeFt,
    entrySpeedKts: entry.entrySpeedKts,
    fixes: [...entry.fixes, ...spec.fixes],
  }));
}

function compileStar(chart: string, branch: StarBranch, gate: EntryGate, ctx: FixContext): Star {
  const routeCtx: FixContext = { ...ctx, gate };
  const positions = resolvePositions(
    // The gate itself is the first fix: the previous sector delivers the aircraft
    // to it at the published altitude and speed, so the profile starts there.
    [gate.position, ...branch.fixes.map((fix) => (fix.at ? fix.at(routeCtx) : null))],
    [undefined, ...branch.fixes.map((fix) => fix.fraction)],
    branch.name,
  );

  const waypoints: StarWaypoint[] = [
    {
      name: gate.name,
      position: positions[0]!,
      altitudeFt: branch.entryAltitudeFt,
      speedKts: branch.entrySpeedKts,
      dtgNm: 0,
    },
    ...branch.fixes.map((fix, i) => ({
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
    name: branch.name,
    chart,
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
        turnAtOrAboveFt: fix.turnAtOrAboveFt,
        alongNm: 0,
      })),
    ];

    // No default floor at the exit fix: `topFt` is a cruise level, and a fix
    // inside the boundary is nowhere near it. A field wanting one publishes it.
    const last = waypoints[waypoints.length - 1]!;

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
      // Declared once per chart and inherited by every branch: a fan is one
      // clearance as far as the departure flow is concerned, so splitting the
      // weight across its exits would quietly favour the SID with more of them.
      weight: spec.weight ?? 1,
      waypoints,
      lengthNm: last.alongNm,
    };
  });
}

/**
 * Which STARs run together to the end, and from where.
 *
 * Two routes are in a group when they share a fix and every fix after it — which
 * makes this a fact read off the field's own geometry rather than something a
 * field can claim or forget. The merge fix is the *earliest* such fix, since that
 * is where the two streams actually become one and therefore where the delivery
 * interval has to have separated them already.
 *
 * A group of one is not a group, and neither is a pair that merely ends at the
 * same fix — three of VABB's five do that, and `checkStarSeparation` already has
 * a rule for it. What this finds is a shared *trunk*: at LSGG, 40 NM of it.
 *
 * The shared fixes must also be at the same level — see `identicalTailLength`,
 * which is where that distinction is drawn and why.
 */
function findMergeGroups(stars: readonly Star[]): MergeGroup[] {
  // `sharedFixes` is how far back the stream runs, kept so that folding two
  // overlapping groups keeps the *earliest* merge rather than whichever was seen
  // first: BANKO 3R and KINES 2R are one stream from GOLEB, 13 NM before BELUS 3R
  // joins them at BIVLO, and the exemption has to start at the earlier of the two.
  type Building = { fixName: string; starNames: string[]; sharedFixes: number };
  const tailFrom = (star: Star, index: number): string =>
    star.waypoints.slice(index).map((waypoint) => waypoint.name).join('>');

  // Keyed by the shared tail, so routes converging at different fixes on the same
  // trunk still land in one group — LSGG's BELUS 3R joins BANKO 3R and KINES 2R
  // at BIVLO, six fixes after those two have already merged at GOLEB.
  const byMerge = new Map<string, Building>();
  for (let i = 0; i < stars.length; i += 1) {
    for (let j = i + 1; j < stars.length; j += 1) {
      const a = stars[i]!;
      const b = stars[j]!;
      // Two fixes in common is a trunk; one is a shared last fix, which the
      // validator has its own rule for and the traffic generator need not space.
      const shared = identicalTailLength(a, b);
      if (shared < 2) continue;
      const group = byMerge.get(tailFrom(a, a.waypoints.length - shared)) ?? {
        fixName: a.waypoints[a.waypoints.length - shared]!.name,
        starNames: [],
        sharedFixes: shared,
      };
      for (const name of [a.name, b.name]) {
        if (!group.starNames.includes(name)) group.starNames.push(name);
      }
      byMerge.set(tailFrom(a, a.waypoints.length - shared), group);
    }
  }

  // Fold a group into any it overlaps: BANKO/KINES merging at GOLEB and
  // BANKO/BELUS at BIVLO are one stream of three, cooled down together. The
  // surviving group keeps the **earliest** merge fix, since that is where the
  // stream actually becomes one and therefore where spacing has to hold.
  const groups = [...byMerge.values()].sort((x, y) => y.starNames.length - x.starNames.length);
  const kept: Building[] = [];
  const absorb = (into: Building, from: Building): void => {
    for (const name of from.starNames) {
      if (!into.starNames.includes(name)) into.starNames.push(name);
    }
    if (from.sharedFixes > into.sharedFixes) {
      into.fixName = from.fixName;
      into.sharedFixes = from.sharedFixes;
    }
  };
  for (const group of groups) {
    const overlapping = kept.find((other) =>
      group.starNames.some((name) => other.starNames.includes(name)),
    );
    if (overlapping) absorb(overlapping, group);
    else kept.push({ ...group, starNames: [...group.starNames] });
  }
  // `sharedFixes` is scaffolding for the fold, not part of the compiled field.
  return kept.map(({ fixName, starNames }) => ({ fixName, starNames }));
}

/**
 * The streams the arrival spawner meters: every merge group, plus a singleton
 * for each gate that joins none (§4.4).
 *
 * Derived rather than declared, for the reason `findMergeGroups` is — a field
 * cannot claim a stream it does not fly. Every gate lands in exactly one stream,
 * which is what lets the spawner run one clock each and know the clocks together
 * account for the whole flow.
 *
 * The share is the delivery agreement where there is one, because a sector's
 * traffic should arrive in the proportions it has promised to hand on, and the
 * sum of the gates' weights otherwise — the same statement, made the only way an
 * approach field can make it.
 */
function findArrivalStreams(
  gates: readonly EntryGate[],
  stars: readonly Star[],
  mergeGroups: readonly MergeGroup[],
  delivery: readonly DeliveryGate[],
): ArrivalStream[] {
  const starByName = new Map(stars.map((star) => [star.name, star]));
  const weightOf = (names: readonly string[]): number =>
    names.reduce((sum, name) => sum + (gates.find((gate) => gate.name === name)?.weight ?? 0), 0);

  const streams: ArrivalStream[] = [];
  const claimed = new Set<string>();
  for (const group of mergeGroups) {
    // A group is named by its STARs; the spawner needs the gates those enter on.
    const gateNames = group.starNames
      .map((name) => starByName.get(name)?.gate)
      .filter((name): name is string => name !== undefined && !claimed.has(name));
    if (gateNames.length === 0) continue;
    for (const name of gateNames) claimed.add(name);
    // The agreement this stream feeds, if the field publishes one. Matched by
    // STAR rather than by fix, since a delivery gate already knows which routes
    // serve it and a merge fix is not always the delivery fix.
    const agreed = delivery.find((gate) =>
      gate.starNames.some((name) => group.starNames.includes(name)),
    );
    streams.push({
      key: group.fixName,
      gateNames,
      share: agreed?.targetRatePerHour ?? weightOf(gateNames),
    });
  }

  for (const gate of gates) {
    if (claimed.has(gate.name)) continue;
    const star = stars.find((candidate) => candidate.gate === gate.name);
    const agreed = star
      ? delivery.find((other) => other.starNames.includes(star.name))
      : undefined;
    streams.push({
      key: gate.name,
      gateNames: [gate.name],
      share: agreed?.targetRatePerHour ?? gate.weight,
    });
  }
  return streams;
}

export function compileScenario(spec: ScenarioSpec): Scenario {
  // The local frame is the field's own, so its reference point is the origin.
  const arp: Point = { x: 0, y: 0 };
  const runway = compileRunway(spec.runway, arp, spec.elevationFt);
  const airspace = compileAirspace(spec.airspace);
  const ctx: FixContext = { runway, arp };

  // Every way in to every route, flattened before the gates are placed: a gate
  // takes its handover altitude and speed from the route that lands on it, and
  // with multi-entry routes that route is a *branch*, so the branches have to
  // exist first. Pure — no context needed — which is what lets it run this early.
  const branches = spec.stars.flatMap((starSpec) =>
    starBranches(starSpec).map((branch) => ({ chart: starSpec.name, branch })),
  );
  const branchByGate = new Map(branches.map((entry) => [entry.branch.gate, entry]));

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
    const route = branchByGate.get(gateSpec.name);
    const entryAltitudeFt = route?.branch.entryAltitudeFt ?? gateSpec.entryAltitudeFt;
    const entrySpeedKts = route?.branch.entrySpeedKts ?? gateSpec.entrySpeedKts;
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
  const stars = branches.map(({ chart, branch }) => {
    const gate = gateByName.get(branch.gate);
    if (!gate) throw new Error(`${branch.name}: no entry gate named ${branch.gate}`);
    return compileStar(chart, branch, gate, ctx);
  });

  // A delivery fix is where a stream leaves this sector, so it is the last fix of
  // the routes that feed it — which is what its position and its membership are
  // read off, rather than restated. An approach field declares none.
  const delivery: DeliveryGate[] = (spec.delivery ?? []).map((deliverySpec) => {
    const serving = stars.filter(
      (star) => star.waypoints[star.waypoints.length - 1]!.name === deliverySpec.fixName,
    );
    if (serving.length === 0) {
      throw new Error(
        `${spec.id}: delivery fix ${deliverySpec.fixName} is not the last fix of any arrival route`,
      );
    }
    const last = serving[0]!.waypoints[serving[0]!.waypoints.length - 1]!;
    return {
      ...deliverySpec,
      position: last.position,
      starNames: serving.map((star) => star.name),
    };
  });

  const mergeGroups = findMergeGroups(stars);
  const defaultTopFt = Math.max(DEPARTURE_TOP_FT, airspace.ceilingFt + 1000);
  const sids = spec.sids.flatMap((sidSpec) => compileSid(sidSpec, ctx, defaultTopFt));

  return {
    id: spec.id,
    name: spec.name,
    icao: spec.icao,
    elevationFt: spec.elevationFt,
    role: spec.role ?? 'approach',
    arp,
    runway,
    inactiveRunways: (spec.inactiveRunways ?? []).map(
      (other): InactiveRunway => ({ id: other.id, ends: [other.ends[0](ctx), other.ends[1](ctx)] }),
    ),
    // The one thing compiled by being turned from pairs into points, because a
    // coastline is already in the frame — see `CoastlineSpec`.
    coastline: (spec.coastline ?? []).map((chain) => chain.map(([x, y]) => ({ x, y }))),
    terrain: (spec.terrain ?? []).map(([levelFt, rings]) => ({
      levelFt,
      rings: rings.map((ring) => ring.map(([x, y]) => ({ x, y }))),
    })),
    airspace,
    gates,
    delivery,
    stars,
    sids,
    mergeGroups,
    arrivalStreams: findArrivalStreams(gates, stars, mergeGroups, delivery),
    fleet: spec.fleet,
    airlines: spec.airlines,
    performance: { ...DEFAULT_PERFORMANCE, ...definedOnly(spec.performance ?? {}) },
    traffic: { ...DEFAULT_TRAFFIC, ...definedOnly(spec.traffic ?? {}) },
    runwayOps: { ...DEFAULT_RUNWAY_OPS, ...definedOnly(spec.runwayOps ?? {}) },
    facility: { ...DEFAULT_FACILITY, ...definedOnly(spec.facility ?? {}) },
  };
}
