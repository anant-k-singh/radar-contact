/**
 * What a field has to get right.
 *
 * Every rule here was previously either prose in a comment, an assertion about
 * ZZZZ in particular, or nothing at all. Collecting them is most of the point of
 * making scenarios pluggable: a second airport is only cheap if there is
 * something that tells you what you got wrong.
 *
 * Static checks only — statements about the data, not about flying it. Anything
 * that needs an aircraft in the air belongs in the conformance suite, which flies
 * every route of every registered field.
 */
import { boundaryMarginNm } from './airspace.js';
import { ceilingAtFt, starProfileAt } from './routes.js';
import type { Scenario, Sid, Star } from './types.js';
import { bearing, distance, headingDiff, type Nm } from '../sim/units.js';

export interface Problem {
  severity: 'error' | 'warning';
  /** What the problem is about — a route, a gate, the runway. */
  where: string;
  message: string;
}

/** How finely a SID's track is walked when looking for arrival routes beside it. */
const SAMPLE_STEP_NM: Nm = 0.25;
/** Lateral distance at which a departure and an arrival need vertical separation. */
const CONFLICT_HORIZ_NM: Nm = 3;
const CONFLICT_VERT_FT = 1000;
/** The steepest turn a fly-by can be flown as; past this the route doubles back. */
const MAX_TURN_DEG = 150;
/** Shorter than this and a leg has no meaningful bearing. */
const MIN_LEG_NM: Nm = 0.1;
/**
 * Slack on "inside the boundary". A gate is *placed* on the boundary, so
 * measuring its position back can only ever be exact to floating point.
 */
const ON_BOUNDARY_NM: Nm = 1e-6;

/**
 * Feet of glideslope per NM on a 3° path.
 *
 * Duplicated from `GS_FT_PER_NM` rather than imported, because a scenario may not
 * import the tunables — that rule is what stopped a field's own numbers living
 * there. The duplication is held honest by a test asserting the two agree.
 */
export const VALIDATION_GS_FT_PER_NM = 318.4;

/** Glideslope height at an along-track distance, without importing the sim's ILS. */
function glideslopeFt(scenario: Scenario, alongNm: Nm): number {
  return scenario.runway.elevationFt + alongNm * VALIDATION_GS_FT_PER_NM;
}

/** Along-track distance from the threshold, as `finalGeometry` measures it. */
function alongFinalNm(scenario: Scenario, point: { x: number; y: number }): Nm {
  const { threshold, direction } = scenario.runway;
  return -((point.x - threshold.x) * direction.x + (point.y - threshold.y) * direction.y);
}

function checkRunwayAndAirspace(scenario: Scenario, problems: Problem[]): void {
  const { runway, airspace } = scenario;
  const add = (severity: Problem['severity'], message: string) =>
    problems.push({ severity, where: `runway ${runway.id}`, message });

  const numbered = Number.parseInt(runway.id, 10);
  if (Number.isFinite(numbered)) {
    const implied = numbered * 10;
    if (headingDiff(implied, runway.courseDeg) > 5) {
      add('error', `id implies ${implied}° but the course is ${runway.courseDeg}°`);
    }
  }
  if (runway.lengthNm <= 0) add('error', 'length must be positive');
  if (!(airspace.halfHeightNm > 0 && airspace.halfHeightNm <= airspace.radiusNm)) {
    problems.push({
      severity: 'error',
      where: 'airspace',
      message: `halfHeightNm ${airspace.halfHeightNm} must be in (0, radiusNm]`,
    });
  }
  const rings = airspace.rangeRingsNm;
  for (let i = 1; i < rings.length; i += 1) {
    if (rings[i]! <= rings[i - 1]!) {
      problems.push({ severity: 'error', where: 'airspace', message: 'range rings must ascend' });
      break;
    }
  }
  if (!(scenario.elevationFt < airspace.mvaFt)) {
    add('error', `the MVA of ${airspace.mvaFt} ft is not above the field`);
  }
  if (!(airspace.mvaFt <= runway.missedApproachAltitudeFt)) {
    add('error', 'the missed approach altitude is below the MVA');
  }
  if (!(runway.missedApproachAltitudeFt <= airspace.ceilingFt)) {
    add('error', 'the missed approach altitude is above the ceiling');
  }
}

function checkGates(scenario: Scenario, problems: Problem[]): void {
  for (const gate of scenario.gates) {
    const add = (severity: Problem['severity'], message: string) =>
      problems.push({ severity, where: `gate ${gate.name}`, message });

    if (boundaryMarginNm(scenario.airspace, gate.position) < -ON_BOUNDARY_NM) {
      add('error', 'sits outside the airspace boundary');
    }
    if (gate.entryAltitudeFt > scenario.airspace.ceilingFt) {
      add('error', `is handed over at ${gate.entryAltitudeFt} ft, above the assignable ceiling`);
    }
    if (gate.entryAltitudeFt <= scenario.airspace.mvaFt) {
      add('error', 'is handed over at or below the MVA');
    }
    // A gate whose inbound track runs parallel to the runway has no crossing
    // point with an offset downwind, which is what `joinsDownwind` needs.
    if (headingDiff(gate.inboundHeadingDeg, scenario.runway.courseDeg) % 180 < 1) {
      add('warning', 'tracks in parallel to the runway; a downwind route cannot be built from it');
    }
    const owners = scenario.stars.filter((star) => star.gate === gate.name);
    if (owners.length > 1) {
      add('error', `has ${owners.length} STARs; a gate may publish at most one`);
    }
  }
  for (const star of scenario.stars) {
    if (!scenario.gates.some((gate) => gate.name === star.gate)) {
      problems.push({
        severity: 'error',
        where: star.name,
        message: `names gate ${star.gate}, which does not exist`,
      });
    }
  }
}

function checkLegs(
  scenario: Scenario,
  where: string,
  waypoints: readonly { name: string; position: { x: number; y: number } }[],
  problems: Problem[],
): void {
  for (let i = 1; i < waypoints.length; i += 1) {
    const legNm = distance(waypoints[i - 1]!.position, waypoints[i]!.position);
    if (legNm < MIN_LEG_NM) {
      problems.push({
        severity: 'error',
        where,
        message: `the leg to ${waypoints[i]!.name} is ${legNm.toFixed(3)} NM long`,
      });
    }
  }
  for (let i = 1; i < waypoints.length - 1; i += 1) {
    const inbound = bearing(waypoints[i - 1]!.position, waypoints[i]!.position);
    const outbound = bearing(waypoints[i]!.position, waypoints[i + 1]!.position);
    if (headingDiff(inbound, outbound) > MAX_TURN_DEG) {
      problems.push({
        severity: 'error',
        where,
        message: `the turn at ${waypoints[i]!.name} is too tight to fly as a fly-by`,
      });
    }
  }
  // On the boundary is fine — a STAR's first fix *is* an entry gate, which sits
  // on it by construction. Outside it is not.
  for (const wpt of waypoints) {
    if (boundaryMarginNm(scenario.airspace, wpt.position) < -ON_BOUNDARY_NM) {
      problems.push({
        severity: 'error',
        where,
        message: `${wpt.name} is outside the airspace boundary`,
      });
    }
  }
}

function checkStar(scenario: Scenario, star: Star, problems: Problem[]): void {
  const add = (severity: Problem['severity'], message: string) =>
    problems.push({ severity, where: star.name, message });

  checkLegs(scenario, star.name, star.waypoints, problems);

  for (const wpt of star.waypoints) {
    if (wpt.altitudeFt === undefined || wpt.speedKts === undefined) {
      add('error', `${wpt.name} does not publish both an altitude and a speed`);
      continue;
    }
    if (wpt.altitudeFt < scenario.airspace.mvaFt) {
      add('error', `${wpt.name} publishes ${wpt.altitudeFt} ft, below the MVA`);
    }
    if (wpt.altitudeFt > scenario.airspace.ceilingFt) {
      add('error', `${wpt.name} publishes ${wpt.altitudeFt} ft, above the ceiling`);
    }
  }

  const altitudes = star.altitudes.map((constraint) => constraint.value);
  for (let i = 1; i < altitudes.length; i += 1) {
    if (altitudes[i]! > altitudes[i - 1]!) {
      add('error', 'published altitudes must only ever come down');
      break;
    }
  }

  const last = star.waypoints[star.waypoints.length - 1]!;
  if (last.dtgNm !== 0) add('error', 'the last fix must have zero distance to go');
  // The whole job of the last fix is to be a platform the localizer can be
  // intercepted from — which means under the glideslope where the route ends.
  const gsFt = glideslopeFt(scenario, alongFinalNm(scenario, last.position));
  const clearFt = gsFt - (last.altitudeFt ?? 0);
  if (clearFt <= 0) {
    add(
      'error',
      `${last.name} is ${Math.abs(clearFt).toFixed(0)} ft *above* the glideslope where it ends`,
    );
  } else if (clearFt < 200) {
    add('warning', `${last.name} is only ${clearFt.toFixed(0)} ft below the glideslope`);
  }
}

function checkSid(scenario: Scenario, sid: Sid, problems: Problem[]): void {
  const add = (severity: Problem['severity'], message: string) =>
    problems.push({ severity, where: sid.name, message });

  checkLegs(scenario, sid.name, sid.waypoints, problems);

  if (sid.topFt <= scenario.airspace.ceilingFt) {
    add('error', 'tops out at or below the assignable ceiling, so it is not above the arrivals');
  }
  let previousMaxFt = 0;
  for (const wpt of sid.waypoints) {
    if (wpt.maxAltitudeFt === undefined) continue;
    if (wpt.maxAltitudeFt < scenario.airspace.mvaFt) {
      add('error', `${wpt.name} publishes a ceiling below the MVA`);
    }
    if (wpt.maxAltitudeFt > sid.topFt) add('error', `${wpt.name} publishes a ceiling above the top`);
    if (wpt.maxAltitudeFt < previousMaxFt) {
      add('error', `the ceiling at ${wpt.name} is lower than one already passed`);
    }
    previousMaxFt = wpt.maxAltitudeFt;
  }
}

/**
 * The rule that makes one runway's departures and arrivals coexist: where a SID's
 * track crosses or passes close to a STAR's, there has to be a published ceiling
 * in force that clears what the arrival is descending through by 1000 ft.
 *
 * Tested at the **closest approach** of each pair of legs, which is where the
 * restriction has to be good. Not across the whole 3 NM band: a SID deliberately
 * carries its restriction only until the crossing is made good, and spends the
 * next mile or two climbing out of the band on its own performance. Whether it
 * actually manages that is a question about aircraft, and the conformance suite
 * answers it by flying every type down every route.
 *
 * Sampled off the charts, so a failure names two routes rather than a trajectory.
 */
function checkSidStarClearance(scenario: Scenario, problems: Problem[]): void {
  for (const sid of scenario.sids) {
    for (const star of scenario.stars) {
      let worst: { distNm: Nm; clearFt: number; ceilingFt: number; arrivalFt: number } | null = null;

      for (let i = 1; i < sid.waypoints.length; i += 1) {
        const near = nearestApproach(
          sid.waypoints[i - 1]!.position,
          sid.waypoints[i]!.position,
          star,
        );
        if (near.distNm > CONFLICT_HORIZ_NM) continue;
        const ceilingFt = ceilingAtFt(sid, near.at);
        const arrivalFt = starProfileAt(star, near.dtgNm).altitudeFt;
        const clearFt = arrivalFt - ceilingFt;
        if (!worst || clearFt < worst.clearFt) {
          worst = { distNm: near.distNm, clearFt, ceilingFt, arrivalFt };
        }
      }

      if (worst && worst.clearFt < CONFLICT_VERT_FT) {
        problems.push({
          severity: 'error',
          where: `${sid.name} × ${star.name}`,
          message:
            `they pass ${worst.distNm.toFixed(1)} NM apart with only ` +
            `${Math.round(worst.clearFt)} ft between the SID's ceiling of ${worst.ceilingFt} ft ` +
            `and the arrival descending through ${Math.round(worst.arrivalFt)} ft`,
        });
      }
    }
  }
}

/** Closest approach between a straight SID leg and a STAR's whole track. */
function nearestApproach(
  from: { x: number; y: number },
  to: { x: number; y: number },
  star: Star,
): { distNm: Nm; at: { x: number; y: number }; dtgNm: Nm } {
  const legNm = distance(from, to);
  const steps = Math.max(1, Math.ceil(legNm / SAMPLE_STEP_NM));
  let best = { distNm: Number.POSITIVE_INFINITY, at: from, dtgNm: 0 };
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const at = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
    const near = nearestOnStar(star, at);
    if (near.distNm < best.distNm) best = { distNm: near.distNm, at, dtgNm: near.dtgNm };
  }
  return best;
}

/** A SID's exit fix must leave room to fly out on, or the route ends nowhere. */
function checkSidExit(scenario: Scenario, sid: Sid, problems: Problem[]): void {
  const last = sid.waypoints[sid.waypoints.length - 1]!;
  if (boundaryMarginNm(scenario.airspace, last.position) <= 0) {
    problems.push({
      severity: 'error',
      where: sid.name,
      message: `${last.name} is not inside the boundary, so there is no leg to leave on`,
    });
  }
}

/** Closest point on a STAR's track to `point`, with its distance to go. */
function nearestOnStar(star: Star, point: { x: number; y: number }): { distNm: Nm; dtgNm: Nm } {
  let best = { distNm: Number.POSITIVE_INFINITY, dtgNm: 0 };
  for (let i = 1; i < star.waypoints.length; i += 1) {
    const from = star.waypoints[i - 1]!;
    const to = star.waypoints[i]!;
    const legNm = distance(from.position, to.position);
    if (legNm === 0) continue;
    const t = Math.max(
      0,
      Math.min(
        1,
        ((point.x - from.position.x) * (to.position.x - from.position.x) +
          (point.y - from.position.y) * (to.position.y - from.position.y)) /
          (legNm * legNm),
      ),
    );
    const on = {
      x: from.position.x + (to.position.x - from.position.x) * t,
      y: from.position.y + (to.position.y - from.position.y) * t,
    };
    const distNm = distance(point, on);
    if (distNm < best.distNm) best = { distNm, dtgNm: to.dtgNm + legNm * (1 - t) };
  }
  return best;
}

function checkNames(scenario: Scenario, problems: Problem[]): void {
  const routeNames = new Set<string>();
  for (const route of [...scenario.stars, ...scenario.sids]) {
    if (routeNames.has(route.name)) {
      problems.push({
        severity: 'error',
        where: route.name,
        message: 'two routes share this chart name; a recording resolves routes by name',
      });
    }
    routeNames.add(route.name);
  }

  // A fix name may legitimately repeat where two routes share a fix — real SIDs
  // off one runway do. The same name at two *different* places is what breaks
  // the hold logic and the readouts, which have only the name to go on.
  const seen = new Map<string, { x: number; y: number }>();
  const fixes = [
    ...scenario.stars.flatMap((star) => star.waypoints),
    ...scenario.sids.flatMap((sid) => sid.waypoints),
  ];
  for (const fix of fixes) {
    const first = seen.get(fix.name);
    if (first && distance(first, fix.position) > 0.01) {
      problems.push({
        severity: 'error',
        where: fix.name,
        message: 'names two different positions',
      });
    }
    if (!first) seen.set(fix.name, fix.position);
  }
}

function checkTraffic(scenario: Scenario, problems: Problem[]): void {
  const { traffic, runwayOps, gates, fleet, airlines } = scenario;
  if (fleet.length === 0) problems.push({ severity: 'error', where: 'fleet', message: 'is empty' });
  if (airlines.length === 0) {
    problems.push({ severity: 'error', where: 'airlines', message: 'is empty' });
  }
  const reachablePerHour = (gates.length * 3600) / traffic.gateCooldownS;
  if (traffic.arrivalsPerHour > reachablePerHour) {
    problems.push({
      severity: 'warning',
      where: 'traffic',
      message:
        `${traffic.arrivalsPerHour}/h is more than the ${gates.length} gates can deliver on a ` +
        `${traffic.gateCooldownS} s cooldown (${reachablePerHour.toFixed(0)}/h)`,
    });
  }
  const releasablePerHour = 3600 / runwayOps.minDepartureIntervalS;
  if (traffic.departuresPerHour > releasablePerHour) {
    problems.push({
      severity: 'warning',
      where: 'runwayOps',
      message: `${traffic.departuresPerHour}/h cannot be released on a ${runwayOps.minDepartureIntervalS} s interval`,
    });
  }
}

/** Every problem with a scenario, worst first. Empty means it is flyable. */
export function validateScenario(scenario: Scenario): Problem[] {
  const problems: Problem[] = [];
  checkRunwayAndAirspace(scenario, problems);
  checkGates(scenario, problems);
  checkNames(scenario, problems);
  for (const star of scenario.stars) checkStar(scenario, star, problems);
  for (const sid of scenario.sids) {
    checkSid(scenario, sid, problems);
    checkSidExit(scenario, sid, problems);
  }
  checkSidStarClearance(scenario, problems);
  checkTraffic(scenario, problems);
  return problems.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1));
}
