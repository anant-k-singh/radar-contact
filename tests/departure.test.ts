import { describe, expect, it } from 'vitest';
import { AIRCRAFT_TYPES, type AircraftType } from '../src/scenario/aircraftTypes.js';
import { AIRPORT } from '../src/scenario/airport.js';
import { ceilingAtFt, SIDS, type Sid } from '../src/scenario/sids.js';
import { STARS, starProfileAt, type Star } from '../src/scenario/stars.js';
import type { Aircraft } from '../src/sim/aircraft.js';
import { isControllable, isDeparture } from '../src/sim/aircraft.js';
import { adjustAltitude, adjustHeading, nextSelectableId } from '../src/sim/commands.js';
import {
  CEILING_FT,
  DEPARTURE_CLIMB_SPEED_KTS,
  DEPARTURE_HOLD_FINAL_NM,
  DEPARTURE_MIN_INTERVAL_S,
  PHYSICS_DT,
  SEP_HORIZ_NM,
  SEP_VERT_FT,
} from '../src/sim/constants.js';
import { createRng } from '../src/sim/rng.js';
import { createDeparture, createTrafficState, runwayBlockedBy } from '../src/sim/traffic.js';
import { distance, type Point } from '../src/sim/units.js';
import { createWorld, step, type World } from '../src/sim/world.js';
import { makeAircraft, onFinalApproach, quietWorld, run } from './helpers.js';

const sidNamed = (name: string): Sid => SIDS.find((sid) => sid.name === name)!;
/**
 * An altitude capture is asymptotic — the rate tapers inside the last 200 ft —
 * so an aircraft levelling at a target sits a foot or two under it indefinitely.
 * Anything inside this is "at" the altitude; real tolerance on a crossing is
 * ±200 ft.
 */
const CAPTURE_TOLERANCE_FT = 10;
const fixNamed = (sid: Sid, name: string) => sid.waypoints.find((wpt) => wpt.name === name)!;

/** A departure of a given type at the holding point, in an otherwise empty world. */
function departure(sid: Sid, type: AircraftType): { ac: Aircraft; world: World } {
  const ac = createDeparture(createRng(7), createTrafficState(), sid, [], 0);
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
  let best = { distNm: Infinity, altitudeFt: 0, star: STARS[0]! };
  for (const star of STARS) {
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
    { sid: sidNamed('SABAR1A'), crossing: 'MORVA', release: 'VELSA', exit: 'SABAR' },
    { sid: sidNamed('KIROS1A'), crossing: 'TELMU', release: 'ZANDU', exit: 'KIROS' },
  ];

  it('never busts the 3500 restriction anywhere it is in force, for every type', () => {
    for (const { sid, crossing } of turning) {
      const restrictedFt = fixNamed(sid, crossing).maxAltitudeFt!;
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

  it('holds the restriction until it is laterally clear of the downwind', () => {
    for (const { sid, crossing, release } of turning) {
      const crossingFix = fixNamed(sid, crossing);
      const releaseFix = fixNamed(sid, release);
      // The published ceiling is still in force at the crossing and for the whole
      // leg beyond it, and lifts only past the release fix (§4.7).
      expect(ceilingAtFt(sid, crossingFix.position)).toBe(crossingFix.maxAltitudeFt);
      const between = {
        x: (crossingFix.position.x + releaseFix.position.x) / 2,
        y: crossingFix.position.y,
      };
      expect(ceilingAtFt(sid, between)).toBe(crossingFix.maxAltitudeFt);
      const beyond = { x: releaseFix.position.x * 1.2, y: releaseFix.position.y };
      expect(ceilingAtFt(sid, beyond)).toBe(CEILING_FT);
      // And by the time it lifts, the track is clear of every arrival route.
      expect(nearestStar(releaseFix.position).distNm).toBeGreaterThan(SEP_HORIZ_NM);
    }
  });

  it('makes 12,000 by the exit fix, for every type', () => {
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

  it('makes 12,000 by RAMOX on the unrestricted straight departure', () => {
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
        s.altitudeFt < CEILING_FT - 100 &&
        Math.abs(s.altitudeFt - airborne[i - 1]!.altitudeFt) < 1,
    );
    expect(levelledEarly).toBe(false);
  });

  it('never climbs above the airspace ceiling', () => {
    for (const sid of SIDS) {
      for (const type of AIRCRAFT_TYPES) {
        const { samples } = flyOut(sid, type);
        const highest = Math.max(...samples.map((s) => s.altitudeFt));
        expect(highest, `${type.code} on ${sid.name}`).toBeLessThanOrEqual(CEILING_FT + 1);
      }
    }
  });
});

// ── The reason the restrictions exist ───────────────────────────────────────

describe('SIDs against the STARs', () => {
  it('stays 1000 ft clear of every arrival route it comes within 3 NM of', () => {
    for (const sid of SIDS) {
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
    const fix = fixNamed(sid, 'MORVA');
    const { samples } = flyOut(sid, AIRCRAFT_TYPES[0]!);
    const at = samples.reduce((best, s) =>
      distance(s, fix.position) < distance(best, fix.position) ? s : best,
    );
    const arrivalFt = nearestStar(fix.position).altitudeFt;
    expect(arrivalFt).toBeGreaterThan(at.altitudeFt);
    expect(arrivalFt - at.altitudeFt).toBeGreaterThan(2000);
    // Not a coincidence of where the sample landed: the published numbers
    // themselves are 2000 ft apart at the crossing.
    expect(arrivalFt - fix.maxAltitudeFt!).toBeGreaterThan(2000);
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
  it('holds a departure while an arrival is on short final', () => {
    const state = createTrafficState();
    const shortFinal = makeAircraft({
      ...onFinalApproach(DEPARTURE_HOLD_FINAL_NM - 1),
      phase: 'gs',
      altitudeFt: 900,
    });
    expect(runwayBlockedBy(state, [shortFinal], 0)).toBe('arrival on short final');

    const further = makeAircraft({
      ...onFinalApproach(DEPARTURE_HOLD_FINAL_NM + 3),
      phase: 'gs',
      altitudeFt: 2200,
    });
    expect(runwayBlockedBy(state, [further], 0)).toBeNull();
  });

  it('holds a departure behind a landing and behind the one before it', () => {
    const state = createTrafficState();
    state.lastLandingS = 1000;
    expect(runwayBlockedBy(state, [], 1010)).toBe('landing traffic rolling out');
    expect(runwayBlockedBy(state, [], 1100)).toBeNull();

    state.lastLandingS = null;
    state.lastDepartureS = 1000;
    expect(runwayBlockedBy(state, [], 1000 + DEPARTURE_MIN_INTERVAL_S - 1)).toBe(
      'departure spacing',
    );
    expect(runwayBlockedBy(state, [], 1000 + DEPARTURE_MIN_INTERVAL_S)).toBeNull();
  });

  it('does not release a second departure onto an occupied runway', () => {
    const { ac, world } = departure(sidNamed('RAMOX1A'), AIRCRAFT_TYPES[0]!);
    expect(ac.phase).toBe('roll');
    expect(runwayBlockedBy(world.traffic, world.aircraft, 0)).toBe('runway occupied');
  });

  it('is not a radar separation problem while the departure is on the runway', () => {
    // An arrival landing over an aircraft that is still rolling is the tower's
    // business, not ours (§9.4) — it must not be logged as a violation.
    const { ac: dep } = departure(sidNamed('RAMOX1A'), AIRCRAFT_TYPES[0]!);
    const landing = makeAircraft({
      ...onFinalApproach(1.5),
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
  it('never puts a departure in conflict with anything, over two hours', () => {
    const world = createWorld(20260825, 50, 20);
    const offenders: string[] = [];

    const steps = Math.round((2 * 3600) / PHYSICS_DT);
    for (let i = 0; i < steps; i += 1) {
      step(world, PHYSICS_DT);
      for (const pair of world.separation.pairs) {
        if (!isDeparture(pair.a) && !isDeparture(pair.b)) continue;
        offenders.push(
          `${pair.a.callsign}/${pair.b.callsign} at ${Math.round(world.timeS)}s — ` +
            `${pair.horizNm.toFixed(1)} NM, ${Math.round(pair.vertFt)} ft`,
        );
      }
      if (offenders.length > 0) break;
    }

    expect(offenders).toEqual([]);
    // And the session really did run departures, so this is not vacuous.
    expect(world.stats.departures).toBeGreaterThan(20);
  });

  it('keeps the runway sequence sane under a saturated arrival flow', () => {
    const world = createWorld(20260825, 50, 20);
    run(world, 3600);
    // Departures are held for arrivals, so the flow set is an upper bound that
    // a busy final eats into — but the runway must not deadlock either.
    expect(world.stats.departures).toBeGreaterThan(5);
    expect(world.stats.departures).toBeLessThanOrEqual(20);
  });
});
