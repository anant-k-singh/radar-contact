import { describe, expect, it } from 'vitest';
import { AIRCRAFT_TYPES, type AircraftType } from '../src/scenario/aircraftTypes.js';
import { ceilingAtFt } from '../src/scenario/routes.js';
import type { Sid } from '../src/scenario/types.js';
import { starProfileAt } from '../src/scenario/routes.js';
import type { Star } from '../src/scenario/types.js';
import type { Aircraft } from '../src/sim/aircraft.js';
import { isControllable, isDeparture } from '../src/sim/aircraft.js';
import { adjustAltitude, adjustHeading, nextSelectableId } from '../src/sim/commands.js';
import {
  DEPARTURE_CLIMB_SPEED_KTS,
  GO_AROUND_RUNWAY_OCCUPIED_NM,
  GS_FT_PER_NM,
  PHYSICS_DT,
  SEP_HORIZ_NM,
  SEP_VERT_FT,
} from '../src/sim/constants.js';
import { maxDepartureRollS } from '../src/sim/departure.js';
import { groundSpeed } from '../src/sim/dynamics.js';
import { createRng } from '../src/sim/rng.js';
import { createDeparture, createTrafficState, runwayBlockedBy } from '../src/sim/traffic.js';
import { distance, type Point } from '../src/sim/units.js';
import {
  createWorld,
  departureQueueLength,
  departureRatePerHour,
  step,
  type World,
} from '../src/sim/world.js';
import { AIRPORT, geo, makeAircraft, MEDIUM_TYPE, onFinal, quietWorld, run, SCENARIO } from './helpers.js';

const sidNamed = (name: string): Sid => SCENARIO.sids.find((sid) => sid.name === name)!;
/**
 * An altitude capture is asymptotic — the rate tapers inside the last 200 ft —
 * so an aircraft levelling at a target sits a foot or two under it indefinitely.
 * Anything inside this is "at" the altitude; real tolerance on a crossing is
 * ±200 ft.
 */
const CAPTURE_TOLERANCE_FT = 10;
const fixNamed = (sid: Sid, name: string) => sid.waypoints.find((wpt) => wpt.name === name)!;
/**
 * How far abeam the centreline the south STARs' downwind legs run — read off the
 * chart rather than written down here, so moving the downwind moves the tests
 * with it.
 */
const DOWNWIND_ABEAM_NM = Math.abs(
  SCENARIO.stars.find((star) => star.name === 'RIMOL1A')!.waypoints.at(-1)!.position.x,
);

/**
 * Where a turning SID's track crosses the arrival downwind leg — the turning leg
 * runs at the latitude of the SID's first fix, and the downwind is straight
 * north/south, so the crossing is that latitude abeam.
 */
const crossingPoint = (side: number): Point => ({
  x: side * DOWNWIND_ABEAM_NM,
  y: sidNamed('SABAR1A').waypoints[1]!.position.y,
});

/** A departure of a given type at the holding point, in an otherwise empty world. */
function departure(sid: Sid, type: AircraftType): { ac: Aircraft; world: World } {
  const ac = createDeparture(SCENARIO, createRng(7), createTrafficState(), sid, [], 0);
  ac.type = type;
  ac.targetIasKts = type.v2Kts;
  return { ac, world: quietWorld(ac) };
}

/** One recorded instant of a departure's climb. */
interface Sample {
  x: number;
  y: number;
  altitudeFt: number;
  iasKts: number;
  phase: Aircraft['phase'];
}

/**
 * Fly a departure until it leaves the airspace, sampling once a second. Capped
 * well past the longest route so a route that never completes fails loudly
 * rather than hanging.
 */
function flyOut(sid: Sid, type: AircraftType): { samples: Sample[]; world: World } {
  const { ac, world } = departure(sid, type);
  const samples: Sample[] = [];
  const stepsPerSample = Math.round(1 / PHYSICS_DT);

  for (let second = 0; second < 1800; second += 1) {
    for (let i = 0; i < stepsPerSample; i += 1) step(world, PHYSICS_DT);
    if (world.aircraft.length === 0) break;
    samples.push({
      x: ac.x,
      y: ac.y,
      altitudeFt: ac.altitudeFt,
      iasKts: ac.iasKts,
      phase: ac.phase,
    });
  }
  return { samples, world };
}

// ── Chart geometry ──────────────────────────────────────────────────────────

/** Perpendicular distance from a point to a segment, and where along it that is. */
function nearestOnSegment(p: Point, a: Point, b: Point): { distNm: number; t: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return { distNm: Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)), t };
}

/**
 * The closest point of any STAR to a position, and what an arrival flying the
 * published profile would be at there. This is how the proximity test asks the
 * question the restriction exists to answer: if a departure is within radar
 * minima of an arrival route, how far under it is it?
 */
function nearestStar(p: Point): { distNm: number; altitudeFt: number; star: Star } {
  let best = { distNm: Infinity, altitudeFt: 0, star: SCENARIO.stars[0]! };
  for (const star of SCENARIO.stars) {
    for (let i = 0; i < star.waypoints.length - 1; i += 1) {
      const from = star.waypoints[i]!;
      const to = star.waypoints[i + 1]!;
      const { distNm, t } = nearestOnSegment(p, from.position, to.position);
      if (distNm >= best.distNm) continue;
      // Distance to go decreases along the route, so the nearest point's dtg is
      // the leg's start minus however far down the leg it sits.
      const dtgNm = from.dtgNm - t * (from.dtgNm - to.dtgNm);
      best = { distNm, altitudeFt: starProfileAt(star, dtgNm).altitudeFt, star };
    }
  }
  return best;
}

// ── Take-off ────────────────────────────────────────────────────────────────

describe('the take-off roll', () => {
  it('rotates inside the runway, for every type', () => {
    for (const type of AIRCRAFT_TYPES) {
      const { ac, world } = departure(sidNamed('RAMOX1A'), type);
      expect(ac.phase).toBe('roll');

      let rolledNm = 0;
      while (ac.phase === 'roll' && world.timeS < 200) {
        const before = { x: ac.x, y: ac.y };
        step(world, PHYSICS_DT);
        rolledNm += distance(before, { x: ac.x, y: ac.y });
      }

      expect(ac.phase, `${type.code} never rotated`).toBe('climb');
      expect(ac.iasKts).toBeGreaterThanOrEqual(type.v2Kts - 0.5);
      expect(rolledNm, `${type.code} used ${rolledNm.toFixed(2)} NM of runway`).toBeLessThan(
        AIRPORT.runway.lengthNm,
      );
    }
  });

  it('stays on the ground and on the runway heading while rolling', () => {
    const { ac, world } = departure(sidNamed('SABAR1A'), AIRCRAFT_TYPES[0]!);
    // Far enough into the roll to be moving, nowhere near V2.
    run(world, 8);
    expect(ac.phase).toBe('roll');
    expect(ac.altitudeFt).toBe(AIRPORT.elevationFt);
    expect(ac.vsFpm).toBe(0);
    // The first fix is off to the west, but a rolling aircraft does not turn.
    expect(ac.headingDeg).toBe(AIRPORT.runway.courseDeg);
    expect(Math.abs(ac.x)).toBeLessThan(0.001);
  });
});

// ── The published restrictions ──────────────────────────────────────────────

describe('SID crossing restrictions', () => {
  const turning = [
    { sid: sidNamed('SABAR1A'), restriction: 'MORVA', exit: 'SABAR', side: -1 },
    { sid: sidNamed('KIROS1A'), restriction: 'TELMU', exit: 'KIROS', side: 1 },
  ];

  it('never busts the crossing restriction anywhere it is in force, for every type', () => {
    for (const { sid, restriction } of turning) {
      const restrictedFt = fixNamed(sid, restriction).maxAltitudeFt!;
      for (const type of AIRCRAFT_TYPES) {
        const { samples } = flyOut(sid, type);
        // Asserted over every instant the restriction applies rather than at one
        // sampled point near the fix: the ceiling is published for a segment, and
        // a sample landing a fraction of a second past the release fix would
        // otherwise read as a bust when it is nothing of the kind.
        const restricted = samples.filter((s) => ceilingAtFt(sid, s) === restrictedFt);
        expect(restricted.length).toBeGreaterThan(10);
        const highest = Math.max(...restricted.map((s) => s.altitudeFt));
        expect(
          highest,
          `${type.code} on ${sid.name} reached ${Math.round(highest)} ft under the restriction`,
        ).toBeLessThanOrEqual(restrictedFt);
        // And it really did climb to the restriction — the number is a ceiling
        // being held, not a performance limit being hit.
        expect(highest).toBeGreaterThan(restrictedFt - CAPTURE_TOLERANCE_FT);
      }
    }
  });

  it('holds the restriction past the downwind, and only lifts it clear of one', () => {
    for (const { sid, restriction, side } of turning) {
      const fix = fixNamed(sid, restriction);
      const crossing = crossingPoint(side);

      // The ceiling is in force where the tracks cross...
      expect(nearestStar(crossing).distNm).toBeLessThan(0.001); // it really is the crossing
      expect(ceilingAtFt(sid, crossing)).toBe(fix.maxAltitudeFt);
      // ...still in force halfway out to the fix that ends it...
      const between = { x: (crossing.x + fix.position.x) / 2, y: crossing.y };
      expect(ceilingAtFt(sid, between)).toBe(fix.maxAltitudeFt);
      // ...and lifts only beyond that fix.
      expect(ceilingAtFt(sid, fix.position)).toBe(fix.maxAltitudeFt);
      const beyond = { x: fix.position.x * 1.2, y: fix.position.y };
      expect(ceilingAtFt(sid, beyond)).toBe(sid.topFt);

      // The point of putting the fix out here rather than on the crossing: at
      // the release the track is already diverging from the arrival route, and
      // the arrival above is high enough that the climb cannot eat the gap it
      // was just held under before the two are 3 NM apart (§4.7). That the
      // margin actually survives the climb is what `flyOut` proves, type by
      // type; this is the chart-geometry half of it.
      const release = nearestStar(fix.position);
      expect(release.distNm).toBeGreaterThan(nearestStar(crossing).distNm);
      expect(nearestStar(beyond).distNm).toBeGreaterThan(release.distNm);
      expect(release.altitudeFt - fix.maxAltitudeFt!).toBeGreaterThanOrEqual(SEP_VERT_FT);
    }
  });

  it('makes the exit fix altitude, for every type', () => {
    for (const { sid, exit } of turning) {
      const fix = fixNamed(sid, exit);
      for (const type of AIRCRAFT_TYPES) {
        const { samples } = flyOut(sid, type);
        const at = samples.reduce((best, s) =>
          distance(s, fix.position) < distance(best, fix.position) ? s : best,
        );
        expect(
          at.altitudeFt,
          `${type.code} on ${sid.name} reached ${exit} at ${Math.round(at.altitudeFt)} ft`,
        ).toBeGreaterThanOrEqual(fix.minAltitudeFt! - CAPTURE_TOLERANCE_FT);
      }
    }
  });

  it('makes the exit altitude by RAMOX on the unrestricted straight departure', () => {
    const sid = sidNamed('RAMOX1A');
    const fix = fixNamed(sid, 'RAMOX');
    for (const type of AIRCRAFT_TYPES) {
      const { samples } = flyOut(sid, type);
      const at = samples.reduce((best, s) =>
        distance(s, fix.position) < distance(best, fix.position) ? s : best,
      );
      expect(
        at.altitudeFt,
        `${type.code} reached RAMOX at ${Math.round(at.altitudeFt)} ft`,
      ).toBeGreaterThanOrEqual(fix.minAltitudeFt! - CAPTURE_TOLERANCE_FT);
    }

    // Nothing restricts it, so once airborne it should never have levelled off
    // short of the ceiling. Measured over the airborne samples only — the whole
    // take-off roll is, quite correctly, a run of identical altitudes.
    const airborne = flyOut(sid, AIRCRAFT_TYPES[3]!) // the slowest climber
      .samples.filter((s) => s.phase === 'climb');
    const levelledEarly = airborne.some(
      (s, i) =>
        i > 0 &&
        s.altitudeFt < sid.topFt - 100 &&
        Math.abs(s.altitudeFt - airborne[i - 1]!.altitudeFt) < 1,
    );
    expect(levelledEarly).toBe(false);
  });

  it('never climbs above the top of the departure climb', () => {
    for (const sid of SCENARIO.sids) {
      for (const type of AIRCRAFT_TYPES) {
        const { samples } = flyOut(sid, type);
        const highest = Math.max(...samples.map((s) => s.altitudeFt));
        expect(highest, `${type.code} on ${sid.name}`).toBeLessThanOrEqual(sid.topFt + 1);
      }
    }
  });
});

// ── The reason the restrictions exist ───────────────────────────────────────

describe('SIDs against the STARs', () => {
  it('stays 1000 ft clear of every arrival route it comes within 3 NM of', () => {
    for (const sid of SCENARIO.sids) {
      for (const type of AIRCRAFT_TYPES) {
        const { samples } = flyOut(sid, type);
        for (const sample of samples) {
          const near = nearestStar(sample);
          if (near.distNm >= SEP_HORIZ_NM) continue;
          const gapFt = Math.abs(near.altitudeFt - sample.altitudeFt);
          expect(
            gapFt,
            `${type.code} on ${sid.name} passed ${near.distNm.toFixed(1)} NM from ` +
              `${near.star.name} at ${Math.round(sample.altitudeFt)} ft, with the arrival ` +
              `above at ${Math.round(near.altitudeFt)} ft`,
          ).toBeGreaterThanOrEqual(SEP_VERT_FT);
        }
      }
    }
  });

  it('passes underneath the downwind, not over it', () => {
    const sid = sidNamed('SABAR1A');
    const crossing = crossingPoint(-1);
    const { samples } = flyOut(sid, AIRCRAFT_TYPES[0]!);
    const at = samples.reduce((best, s) =>
      distance(s, crossing) < distance(best, crossing) ? s : best,
    );
    const arrivalFt = nearestStar(crossing).altitudeFt;
    expect(arrivalFt).toBeGreaterThan(at.altitudeFt);
    expect(arrivalFt - at.altitudeFt).toBeGreaterThan(2000);
    // Not a coincidence of where the sample landed: the published numbers
    // themselves are 2000 ft apart at the crossing.
    const restrictedFt = fixNamed(sid, 'MORVA').maxAltitudeFt!;
    expect(arrivalFt - restrictedFt).toBeGreaterThan(2000);
  });
});

// ── Climb profile ───────────────────────────────────────────────────────────

describe('the climb profile', () => {
  it('flies the initial-climb IAS, then accelerates to 250 kt', () => {
    const type = AIRCRAFT_TYPES.find((t) => t.code === 'B738')!;
    const { samples } = flyOut(sidNamed('RAMOX1A'), type);

    const airborne = samples.filter((s) => s.phase === 'climb');
    // Just after rotation it is at V2 heading for the initial-climb speed, and
    // never faster than that until the flaps are up.
    expect(airborne[0]!.iasKts).toBeLessThan(type.initialClimbKts + 5);
    const low = airborne.filter((s) => s.altitudeFt < 1500);
    for (const s of low) expect(s.iasKts).toBeLessThan(type.initialClimbKts + 5);

    // And it gets to the climb speed, but never past it — 250 kt is the limit
    // below 10,000 ft and our whole airspace is below it.
    const fastest = Math.max(...samples.map((s) => s.iasKts));
    expect(fastest).toBeGreaterThan(DEPARTURE_CLIMB_SPEED_KTS - 5);
    expect(fastest).toBeLessThanOrEqual(DEPARTURE_CLIMB_SPEED_KTS + 0.5);
  });

  it('leaves the airspace and counts as a departure rather than a lost arrival', () => {
    const { world } = flyOut(sidNamed('RAMOX1A'), AIRCRAFT_TYPES[0]!);
    expect(world.aircraft).toHaveLength(0);
    expect(world.stats.departures).toBe(1);
    expect(world.stats.exits).toBe(0);
  });
});

// ── Whose aircraft it is ────────────────────────────────────────────────────

describe('a departure is not the player’s', () => {
  it('takes no instructions', () => {
    const { ac, world } = departure(sidNamed('SABAR1A'), AIRCRAFT_TYPES[0]!);
    run(world, 60);
    expect(isDeparture(ac)).toBe(true);
    expect(isControllable(ac)).toBe(false);

    const before = { alt: ac.targetAltitudeFt, hdg: ac.targetHeadingDeg };
    adjustAltitude(world, ac, 1);
    adjustHeading(world, ac, 1);
    expect(ac.pending).toHaveLength(0);
    expect(ac.targetAltitudeFt).toBe(before.alt);
    expect(ac.targetHeadingDeg).toBe(before.hdg);
    expect(world.messages.some((m) => m.text.includes('with Departure'))).toBe(true);
  });

  it('is skipped by the Tab cycle but still exists on the scope', () => {
    const arrival = makeAircraft({ x: 0, y: 20 });
    const { ac: dep } = departure(sidNamed('SABAR1A'), AIRCRAFT_TYPES[0]!);
    const world = quietWorld(arrival, dep);

    expect(nextSelectableId(world)).toBe(arrival.id);
    world.selectedId = arrival.id;
    expect(nextSelectableId(world)).toBe(arrival.id);
    expect(world.aircraft).toContain(dep);
  });
});

// ── The shared runway ───────────────────────────────────────────────────────

describe('the shared runway', () => {
  /** An arrival on the glideslope at `alongNm`, flying `iasKts`. */
  const onApproach = (alongNm: number, iasKts: number): Aircraft =>
    makeAircraft({
      ...onFinal(alongNm),
      phase: 'gs',
      altitudeFt: alongNm * GS_FT_PER_NM,
      headingDeg: AIRPORT.runway.courseDeg,
      iasKts,
    });

  it('holds a departure while an arrival is on short final', () => {
    const state = createTrafficState();
    const vapp = MEDIUM_TYPE.vappKts;
    expect(runwayBlockedBy(SCENARIO, state, [onApproach(SCENARIO.runwayOps.holdFinalNm - 1, vapp)], 0)).toBe(
      'arrival on short final',
    );
    expect(runwayBlockedBy(SCENARIO, state, [onApproach(SCENARIO.runwayOps.holdFinalNm + 3, vapp)], 0)).toBeNull();
  });

  it('measures the arrival in time, so a fast one blocks from further out', () => {
    // The gate is "will the departure be airborne with the margin to spare",
    // not a fixed distance — the whole reason it reads the ground speed (§4.7).
    const state = createTrafficState();
    const requiredS = maxDepartureRollS(SCENARIO.fleet) + SCENARIO.runwayOps.airborneMarginS;

    // One distance, two speeds: far enough at an approach speed, not far enough
    // at 210 kt. The two time assertions below state that premise explicitly, so
    // a retune of the margin fails here with the reason rather than a bare
    // "expected null".
    const slow = onApproach(4.5, MEDIUM_TYPE.vappKts);
    const fast = onApproach(4.5, 210);
    expect(geo(slow).alongNm / (groundSpeed(slow) / 3600)).toBeGreaterThan(requiredS);
    expect(geo(fast).alongNm / (groundSpeed(fast) / 3600)).toBeLessThan(requiredS);
    expect(runwayBlockedBy(SCENARIO, state, [slow], 0)).toBeNull();
    expect(runwayBlockedBy(SCENARIO, state, [fast], 0)).toBe('arrival on short final');
  });

  it('never releases inside the distance floor, however slow the arrival is', () => {
    const state = createTrafficState();
    // Slow enough that the time test alone would let it go.
    const crawling = onApproach(SCENARIO.runwayOps.holdFinalNm - 0.1, 90);
    expect(runwayBlockedBy(SCENARIO, state, [crawling], 0)).toBe('arrival on short final');
  });

  it('holds a departure behind a landing and behind the one before it', () => {
    const state = createTrafficState();
    state.lastLandingS = 1000;
    expect(runwayBlockedBy(SCENARIO, state, [], 1010)).toBe('landing traffic rolling out');
    expect(runwayBlockedBy(SCENARIO, state, [], 1100)).toBeNull();

    state.lastLandingS = null;
    state.lastDepartureS = 1000;
    expect(runwayBlockedBy(SCENARIO, state, [], 1000 + SCENARIO.runwayOps.minDepartureIntervalS - 1)).toBe(
      'departure spacing',
    );
    expect(runwayBlockedBy(SCENARIO, state, [], 1000 + SCENARIO.runwayOps.minDepartureIntervalS)).toBeNull();
  });

  it('does not release a second departure onto an occupied runway', () => {
    const { ac, world } = departure(sidNamed('RAMOX1A'), AIRCRAFT_TYPES[0]!);
    expect(ac.phase).toBe('roll');
    expect(runwayBlockedBy(SCENARIO, world.traffic, world.aircraft, 0)).toBe('runway occupied');
  });

  it('gets every type airborne before an arrival released at 3 NM reaches the threshold', () => {
    // The rule the 3 NM is standing in for: a departure has to be off the ground
    // before the landing aircraft crosses the threshold behind it (§4.7). The
    // arrival is placed at exactly the release distance, on the glideslope at
    // its approach speed — the limiting case, since one an inch further out is
    // what actually unblocks the runway.
    let worstMarginS = Infinity;
    let worstCase = '';
    for (const depType of AIRCRAFT_TYPES) {
      for (const arrType of AIRCRAFT_TYPES) {
        const arrival = makeAircraft({
          ...onFinal(SCENARIO.runwayOps.holdFinalNm),
          type: arrType,
          phase: 'gs',
          altitudeFt: SCENARIO.runwayOps.holdFinalNm * GS_FT_PER_NM,
          headingDeg: AIRPORT.runway.courseDeg,
          iasKts: arrType.vappKts,
        });
        const { ac: dep } = departure(sidNamed('RAMOX1A'), depType);
        const world = quietWorld(arrival, dep);

        while (dep.phase === 'roll' && world.timeS < 300) step(world, PHYSICS_DT);
        expect(dep.phase, `${depType.code} never rotated`).toBe('climb');

        // Still airborne itself, so it has not reached the threshold: the
        // landing is what removes it from the scope.
        expect(
          world.aircraft,
          `${arrType.code} landed over ${depType.code} while it was still rolling`,
        ).toContain(arrival);

        const marginS = geo(arrival).alongNm / (groundSpeed(arrival) / 3600);
        expect(marginS).toBeGreaterThan(0);
        if (marginS < worstMarginS) {
          worstMarginS = marginS;
          worstCase = `${depType.code} rolling under a ${arrType.code}`;
        }
      }
    }
    // Not just positive but comfortable, so a retune of either the distance or
    // the take-off acceleration cannot quietly eat the margin down to nothing.
    expect(worstMarginS, `worst case ${worstCase}: ${worstMarginS.toFixed(1)} s`).toBeGreaterThan(
      10,
    );
  });

  it('sends an arrival around rather than landing it on an occupied runway', () => {
    // The backstop (§6.2). Whatever the release decided a minute ago, an
    // aircraft this close to a runway with something on it goes around.
    const { ac: dep } = departure(sidNamed('RAMOX1A'), AIRCRAFT_TYPES[4]!);
    const arrival = onApproach(GO_AROUND_RUNWAY_OCCUPIED_NM + 0.4, MEDIUM_TYPE.vappKts);
    const world = quietWorld(arrival, dep);

    run(world, 30);
    expect(dep.phase, 'the departure should still be rolling').toBe('roll');
    expect(arrival.phase).toBe('goAround');
    expect(world.stats.goArounds).toBe(1);
    expect(world.stats.landings).toBe(0);
    expect(world.messages.some((m) => m.text.includes('runway occupied'))).toBe(true);
  });

  it('lands the same arrival when the runway is clear', () => {
    const arrival = onApproach(GO_AROUND_RUNWAY_OCCUPIED_NM + 0.4, MEDIUM_TYPE.vappKts);
    const world = quietWorld(arrival);
    run(world, 30);
    expect(world.stats.goArounds).toBe(0);
    expect(world.stats.landings).toBe(1);
  });

  it('holds the runway for the landing that just vacated it, against arrivals too', () => {
    // The occupancy is a time because the landing is removed at touchdown, and
    // it applies to the aircraft behind as well as to the next departure.
    const arrival = onApproach(GO_AROUND_RUNWAY_OCCUPIED_NM + 0.4, MEDIUM_TYPE.vappKts);
    const world = quietWorld(arrival);
    world.traffic.lastLandingS = 0;
    run(world, 30);
    expect(arrival.phase).toBe('goAround');
    expect(world.stats.landings).toBe(0);

    // Past the occupancy time, the same approach lands.
    const later = onApproach(GO_AROUND_RUNWAY_OCCUPIED_NM + 0.4, MEDIUM_TYPE.vappKts);
    const clear = quietWorld(later);
    clear.traffic.lastLandingS = -SCENARIO.runwayOps.holdAfterLandingS;
    run(clear, 30);
    expect(clear.stats.landings).toBe(1);
  });

  it('is not a radar separation problem while the departure is on the runway', () => {
    // An arrival landing over an aircraft that is still rolling is the tower's
    // business, not ours (§9.4) — it must not be logged as a violation.
    const { ac: dep } = departure(sidNamed('RAMOX1A'), AIRCRAFT_TYPES[0]!);
    const landing = makeAircraft({
      ...onFinal(1.5),
      phase: 'gs',
      altitudeFt: 480,
      headingDeg: AIRPORT.runway.courseDeg,
    });
    const world = quietWorld(landing, dep);
    run(world, 5);
    expect(world.stats.violations).toBe(0);
    expect(dep.alert).toBe('none');
  });
});

// ── Flow control ────────────────────────────────────────────────────────────

describe('departure flow', () => {
  it('releases nothing at all when the flow is zero', () => {
    const world = quietWorld();
    world.departureFlowPerHour = 0;
    world.traffic.nextDepartureAtS = 0;
    run(world, 900);
    expect(world.aircraft).toHaveLength(0);
  });

  it('turns back on without a restart once the flow is raised', () => {
    const world = quietWorld();
    world.departureFlowPerHour = 0;
    world.traffic.nextDepartureAtS = 0;
    run(world, 300);
    expect(world.aircraft).toHaveLength(0);

    world.departureFlowPerHour = 20;
    run(world, 120);
    expect(world.aircraft.length).toBeGreaterThan(0);
    expect(world.aircraft.every(isDeparture)).toBe(true);
  });

  it('joins the queue on the flow interval whatever the runway is doing', () => {
    const world = quietWorld();
    world.departureFlowPerHour = 20;
    world.traffic.nextDepartureAtS = 0;

    // Hold the runway for the whole ten minutes: something has always just
    // landed on it. Nothing rolls, and the departures stack up at the threshold
    // rather than being skipped.
    for (let i = 0; i < 600 / PHYSICS_DT; i += 1) {
      world.traffic.lastLandingS = world.timeS;
      step(world, PHYSICS_DT);
    }
    expect(world.aircraft).toHaveLength(0);
    // 20/h is one every three minutes, exactly — the first at the opening tick.
    expect(departureQueueLength(world)).toBe(4);

    // Give the runway back and the queue drains at the *departure* interval,
    // which is faster than the flow that filled it.
    const queued = departureQueueLength(world);
    run(world, 400);
    expect(world.aircraft.length).toBeGreaterThanOrEqual(3);
    expect(world.aircraft.every(isDeparture)).toBe(true);
    expect(departureQueueLength(world)).toBeLessThan(queued);
  });

  it('keeps 90 s between rolls when nothing lands in between', () => {
    const world = quietWorld();
    world.departureFlowPerHour = 20;
    world.traffic.nextDepartureAtS = Number.POSITIVE_INFINITY;
    // A queue deep enough that the flow interval is never what is limiting.
    world.traffic.departureQueue = 10;

    run(world, 600);
    // Only the last few roll times are kept — enough to check the interval on.
    const rolls = world.stats.departureTimesS;
    expect(rolls.length).toBeGreaterThan(2);
    for (let i = 1; i < rolls.length; i += 1) {
      expect(rolls[i]! - rolls[i - 1]!).toBeGreaterThanOrEqual(SCENARIO.runwayOps.minDepartureIntervalS - PHYSICS_DT);
    }
    // And the queue really was the source of them.
    expect(departureQueueLength(world)).toBe(10 - world.aircraft.length);
  });

  it('drains a queue that was built before the flow was turned off', () => {
    const world = quietWorld();
    world.traffic.nextDepartureAtS = Number.POSITIVE_INFINITY;
    world.traffic.departureQueue = 2;
    world.departureFlowPerHour = 0;

    run(world, 200);
    // Already at the holding point, so they still go — the flow only decides
    // whether anyone new turns up.
    expect(world.aircraft).toHaveLength(2);
    expect(departureQueueLength(world)).toBe(0);
  });

  it('reports a departure rate against what the runway actually released', () => {
    const world = quietWorld();
    world.departureFlowPerHour = 20;
    world.traffic.nextDepartureAtS = 0;

    // Too few rolls for a gap to mean anything yet.
    run(world, 60);
    expect(departureRatePerHour(world)).toBeNull();

    // Timed at the roll rather than at the airspace exit, so the rate is a real
    // number well before the first departure has even finished its SID (§8.2) —
    // which is the whole reason it is not counted off `stats.departures`.
    run(world, 480);
    expect(world.stats.departures).toBe(0);
    expect(departureRatePerHour(world)!).toBeGreaterThan(0);

    run(world, 720);
    const rate = departureRatePerHour(world)!;
    // Nothing is landing to hold the runway, so it should track the flow set —
    // within the wake-turbulence interval, which caps it at 30/h.
    expect(rate).toBeGreaterThan(10);
    expect(rate).toBeLessThanOrEqual(3600 / SCENARIO.runwayOps.minDepartureIntervalS);
  });

  it('reports no departure rate at all when the flow is off', () => {
    const world = quietWorld();
    world.departureFlowPerHour = 0;
    world.traffic.nextDepartureAtS = 0;
    run(world, 720);
    // Nothing ever rolled, so there is no gap to read — not a rate of zero.
    expect(departureRatePerHour(world)).toBeNull();
  });

  it('leaves the arrival sequence a seed produces untouched', () => {
    // The whole reason departures draw on their own stream: `?seed=` has to mean
    // the same arrival problem whatever the departure flow is set to.
    const gatesFor = (departureFlowPerHour: number): string[] => {
      const world = quietWorld();
      world.departureFlowPerHour = departureFlowPerHour;
      world.traffic.nextSpawnAtS = 0;
      world.traffic.nextDepartureAtS = 0;
      run(world, 1800);
      return world.aircraft.filter((ac) => !isDeparture(ac)).map((ac) => ac.entryGate);
    };
    expect(gatesFor(20)).toEqual(gatesFor(0));
  });
});

// ── The published routes together ───────────────────────────────────────────

describe('a session flown entirely as published', () => {
  /**
   * The strongest statement the geometry can make: with the departure flow at
   * its maximum and nobody touching anything, a departure must never be half of
   * a conflict. Arrivals still conflict with *each other* — the two north STARs
   * end pointing at one another, which is the sequencing problem the player is
   * there to solve — so only pairs involving a departure are examined.
   */
  it('never loses separation against a departure, over two hours', () => {
    const world = createWorld(SCENARIO, 20260825, 50, 20);
    const violations: string[] = [];
    // Predicted conflicts are counted rather than banned. The 90 s look-ahead
    // takes the closest horizontal and closest vertical approach *independently*
    // (§9.2), so a departure climbing out and an arrival descending inbound can
    // be flagged converging and then both turn away — advisory, and not wrong,
    // but it must stay a handful an hour rather than every departure.
    const warned = new Set<string>();

    const steps = Math.round((2 * 3600) / PHYSICS_DT);
    for (let i = 0; i < steps; i += 1) {
      step(world, PHYSICS_DT);
      for (const pair of world.separation.pairs) {
        if (!isDeparture(pair.a) && !isDeparture(pair.b)) continue;
        if (pair.level === 'warning') {
          warned.add(pair.key);
          continue;
        }
        violations.push(
          `${pair.a.callsign}/${pair.b.callsign} at ${Math.round(world.timeS)}s — ` +
            `${pair.horizNm.toFixed(1)} NM, ${Math.round(pair.vertFt)} ft`,
        );
      }
      if (violations.length > 0) break;
    }

    expect(violations).toEqual([]);
    // And the session really did run departures, so this is not vacuous.
    expect(world.stats.departures).toBeGreaterThan(20);
    expect(warned.size).toBeLessThan(world.stats.departures / 3);
  });

  it('keeps the runway sequence sane under a saturated arrival flow', () => {
    const world = createWorld(SCENARIO, 20260825, 50, 20);
    run(world, 3600);
    // Departures are held for arrivals, so the flow set is an upper bound that
    // a busy final eats into — but the runway must not deadlock either.
    expect(world.stats.departures).toBeGreaterThan(5);
    expect(world.stats.departures).toBeLessThanOrEqual(20);
  });
});
