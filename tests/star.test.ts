import { describe, expect, it } from 'vitest';
import { starForGate, starProfileAt } from '../src/scenario/routes.js';
import type { Star } from '../src/scenario/types.js';
import type { Aircraft } from '../src/sim/aircraft.js';
import { adjustAltitude, adjustHeading, adjustSpeed, resumeArrival } from '../src/sim/commands.js';
import { PHYSICS_DT, SEP_HORIZ_NM, SPEED_FLOOR_CLEAN_KTS, STAR_REJOIN_XTK_NM } from '../src/sim/constants.js';
import { createRng } from '../src/sim/rng.js';
import { createArrival, createTrafficState } from '../src/sim/traffic.js';
import { joinStar, rejoinLegIndex, starOwnsVertical } from '../src/sim/star.js';
import { bearing, distance, headingVector, normalizeHeading, type Point } from '../src/sim/units.js';
import { step } from '../src/sim/world.js';
import { issue } from '../src/sim/pilot.js';
import { AIRPORT, makeAircraft, pilotActs, quietWorld, run, SCENARIO } from './helpers.js';

/** A fresh arrival at `gateName`, on its STAR, in an otherwise empty world. */
function arrival(gateName: string): { ac: Aircraft; world: ReturnType<typeof quietWorld> } {
  const gate = AIRPORT.gates.find((candidate) => candidate.name === gateName)!;
  const ac = createArrival(SCENARIO, createRng(5), createTrafficState(), gate, [], 0);
  return { ac, world: quietWorld(ac) };
}

/**
 * What the route itself publishes at its last fix. Read off the chart rather
 * than from a constant, so retuning a single crossing does not need the tests
 * edited to match.
 */
function platformFor(star: Star): { altitudeFt: number; speedKts: number } {
  const last = star.waypoints[star.waypoints.length - 1]!;
  return { altitudeFt: last.altitudeFt!, speedKts: last.speedKts! };
}

/** Perpendicular distance from a point to a line segment. */
function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** How far the aircraft is from the nearest point of the whole published track. */
function offRouteNm(ac: Aircraft, star: Star): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < star.waypoints.length - 1; i += 1) {
    best = Math.min(
      best,
      distanceToSegment({ x: ac.x, y: ac.y }, star.waypoints[i]!.position, star.waypoints[i + 1]!.position),
    );
  }
  return best;
}

describe('the published routes', () => {
  it('gives every entry gate a STAR that ends level at the platform altitude', () => {
    expect(SCENARIO.stars).toHaveLength(AIRPORT.gates.length);
    for (const gate of AIRPORT.gates) {
      const star = starForGate(SCENARIO, gate.name)!;
      expect(star).toBeDefined();
      expect(star.waypoints[0]!.position).toEqual(gate.position);
      expect(star.waypoints[0]!.altitudeFt).toBe(gate.entryAltitudeFt);
      expect(star.waypoints[0]!.speedKts).toBe(gate.entrySpeedKts);

      // Every fix publishes both, so the profile is fully determined.
      for (const wpt of star.waypoints) {
        expect(wpt.altitudeFt).toBeDefined();
        expect(wpt.speedKts).toBeDefined();
      }
      const last = star.waypoints[star.waypoints.length - 1]!;
      expect(last.altitudeFt!).toBeGreaterThan(SCENARIO.airspace.mvaFt);
      expect(last.speedKts!).toBeGreaterThanOrEqual(SPEED_FLOOR_CLEAN_KTS);
      expect(last.dtgNm).toBe(0);
      // Published altitudes only ever come down.
      const altitudes = star.altitudes.map((constraint) => constraint.value);
      expect([...altitudes].sort((a, b) => b - a)).toEqual(altitudes);
    }
  });

  it('publishes 250 kt as far as the first fix, and reduces only after it', () => {
    for (const star of SCENARIO.stars) {
      const entrySpeedKts = star.waypoints[0]!.speedKts!;
      const first = star.waypoints[1]!;
      expect(first.speedKts).toBe(entrySpeedKts);

      // Anywhere on the leg from the gate to that fix the profile is still 250.
      const gateDtg = star.waypoints[0]!.dtgNm;
      for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
        const dtgNm = first.dtgNm + (gateDtg - first.dtgNm) * fraction;
        expect(starProfileAt(star, dtgNm).speedKts).toBe(entrySpeedKts);
      }
      // And it is coming off by the time the next fix is reached, arriving at
      // each later fix on that fix's own published speed.
      expect(starProfileAt(star, first.dtgNm - 0.5).speedKts).toBeLessThan(entrySpeedKts);
      for (const wpt of star.waypoints.slice(2)) {
        expect(starProfileAt(star, wpt.dtgNm).speedKts).toBe(wpt.speedKts);
      }
    }
  });

  // The published profile, spelled out. Crossings are maintained per fix, so
  // this table is the one place a retune has to be mirrored — deliberately, as
  // a change here should be a change someone meant to make.
  it('publishes the charted crossing at every fix', () => {
    const expected: Record<string, [number, number]> = {
      OKPUR: [9000, 250], ALVOR: [7000, 230], ARDIS: [3000, 200],
      NIVEL: [9000, 250], BELGA: [7000, 230], BOXAR: [3000, 200],
      SUDIX: [10_000, 250], LOMSA: [7000, 230], PIKON: [3000, 210],
      TAVIR: [10_000, 250], DEMUX: [7000, 230], KETAN: [3000, 210],
    };
    const seen = new Set<string>();
    for (const star of SCENARIO.stars) {
      // Skip the gate itself: its crossing comes from the gate, not the chart.
      for (const wpt of star.waypoints.slice(1)) {
        const want = expected[wpt.name];
        expect(want, `unexpected fix ${wpt.name}`).toBeDefined();
        expect([wpt.altitudeFt, wpt.speedKts], wpt.name).toEqual(want);
        seen.add(wpt.name);
      }
    }
    expect([...seen].sort()).toEqual(Object.keys(expected).sort());
  });

  it('keeps the four routes clear of each other', () => {
    // Only the two north routes are allowed to point at each other, and even
    // they stop with the width of a separation minimum between them.
    for (const star of SCENARIO.stars) {
      for (const other of SCENARIO.stars) {
        if (other === star) continue;
        for (let i = 0; i < star.waypoints.length - 1; i += 1) {
          for (const wpt of other.waypoints) {
            const gap = distanceToSegment(
              wpt.position,
              star.waypoints[i]!.position,
              star.waypoints[i + 1]!.position,
            );
            expect(gap).toBeGreaterThanOrEqual(SEP_HORIZ_NM);
          }
        }
      }
    }
  });
});

describe('flying a STAR', () => {
  it('tracks the route and arrives at the last fix level at the published platform', () => {
    for (const gate of AIRPORT.gates) {
      const { ac, world } = arrival(gate.name);
      const star = ac.star!.route;
      let worstOffRouteNm = 0;

      // Nobody says anything: it flies the whole thing on its own.
      for (let i = 0; i < 30_000 && ac.star; i += 1) {
        step(world, 0.05);
        worstOffRouteNm = Math.max(worstOffRouteNm, offRouteNm(ac, star));
      }

      expect(ac.star).toBeNull();
      // Fly-by turns cut the corner; nothing else should leave the track.
      expect(worstOffRouteNm).toBeLessThan(1.5);
      expect(distance({ x: ac.x, y: ac.y }, star.waypoints[star.waypoints.length - 1]!.position)).toBeLessThan(1);
      // Arrives a little high — the last leg descends and decelerates at once,
      // and they share one energy budget (§4.3), so the descent gives way. The
      // south routes give way further than the north ones: their last leg now
      // loses 4000 ft rather than 2000, so the descent is the half of the budget
      // under pressure for longer. It is levelled off within a minute of the fix
      // either way, and a hundred feet at a downwind platform is nothing.
      expect(ac.altitudeFt - platformFor(star).altitudeFt).toBeGreaterThanOrEqual(0);
      expect(ac.altitudeFt - platformFor(star).altitudeFt).toBeLessThan(150);
      expect(Math.abs(ac.iasKts - platformFor(star).speedKts)).toBeLessThan(2);
      expect(world.messages.some((m) => m.text.includes('end of the arrival'))).toBe(true);
    }
  });

  it('meets each published crossing altitude on the way down', () => {
    const { ac, world } = arrival('RIMOL');
    const star = ac.star!.route;

    for (const wpt of star.waypoints.slice(1)) {
      // Fly to abeam this fix, then check the published altitude was made good.
      let closest = Number.POSITIVE_INFINITY;
      for (let i = 0; i < 30_000; i += 1) {
        step(world, 0.05);
        const range = distance({ x: ac.x, y: ac.y }, wpt.position);
        if (range > closest) break;
        closest = range;
      }
      expect(ac.altitudeFt).toBeCloseTo(wpt.altitudeFt!, -2);
    }
    expect(ac.iasKts).toBeCloseTo(platformFor(star).speedKts, 0);
    expect(world.stats.violations).toBe(0);
  });

  it('descends continuously rather than diving and levelling', () => {
    const gate = AIRPORT.gates.find((candidate) => candidate.name === 'TEMBA')!;
    const { ac, world } = arrival('TEMBA');
    const firstCrossingFt = ac.star!.route.waypoints[1]!.altitudeFt!;
    run(world, 120);
    // Entry altitude down towards the first published crossing over the first
    // half of the route: a gentle steady descent, still short of that level.
    expect(ac.vsFpm).toBeLessThan(-150);
    expect(ac.vsFpm).toBeGreaterThan(-900);
    expect(ac.altitudeFt).toBeLessThan(gate.entryAltitudeFt);
    expect(ac.altitudeFt).toBeGreaterThan(firstCrossingFt);
  });
});

describe('taking an aircraft off its STAR', () => {
  it('drops the route on a vector, and keeps the descent to the next published level', () => {
    const { ac, world } = arrival('VANDA');
    const okpurAltFt = ac.star!.route.waypoints[1]!.altitudeFt!;
    const entrySpeedKts = ac.star!.route.waypoints[0]!.speedKts!;
    run(world, 60);
    expect(ac.star).not.toBeNull();

    adjustHeading(world, ac, 1);
    pilotActs(world);

    expect(ac.star).toBeNull();
    // Nothing was said about height or speed, so what the chart publishes next
    // stands: the descent to OKPUR's level, and 250 kt — the reduction to the
    // platform speed belongs to the leg after it, which this aircraft has not
    // reached.
    expect(ac.targetAltitudeFt).toBe(okpurAltFt);
    expect(ac.targetIasKts).toBe(entrySpeedKts);

    const headingAfter = ac.targetHeadingDeg;
    run(world, 60);
    expect(ac.targetHeadingDeg).toBe(headingAfter); // no longer being steered by the route
  });

  it('keeps the lateral track when only an altitude is assigned', () => {
    const { ac, world } = arrival('KOVAL');
    run(world, 60);
    const star = ac.star!.route;

    adjustAltitude(world, ac, -1);
    pilotActs(world);
    expect(ac.star).not.toBeNull();
    expect(ac.star!.altitudeManual).toBe(true);
    const assigned = ac.targetAltitudeFt;

    run(world, 240);
    expect(ac.star).not.toBeNull();
    expect(offRouteNm(ac, star)).toBeLessThan(1.5);
    // Levelled at what the controller gave, not at the published profile.
    expect(ac.targetAltitudeFt).toBe(assigned);
    expect(ac.altitudeFt).toBeCloseTo(assigned, -2);
  });

  it('keeps the lateral track and the published descent when only a speed is assigned', () => {
    const gate = AIRPORT.gates.find((candidate) => candidate.name === 'RIMOL')!;
    const { ac, world } = arrival('RIMOL');
    run(world, 60);

    adjustSpeed(world, ac, -1);
    pilotActs(world);
    expect(ac.star).not.toBeNull();
    expect(ac.star!.speedManual).toBe(true);
    expect(ac.star!.altitudeManual).toBe(false);

    run(world, 180);
    expect(ac.iasKts).toBeCloseTo(240, 0);
    // Still descending on the published profile, below the handover level.
    expect(ac.altitudeFt).toBeLessThan(gate.entryAltitudeFt);
  });
});

describe('rejoining a STAR', () => {
  /** Vector the aircraft off its route and fly it well clear of it. */
  function vectorAway(world: ReturnType<typeof quietWorld>, ac: Aircraft, steps = 3, flyS = 200): void {
    for (let i = 0; i < steps; i += 1) adjustHeading(world, ac, 1);
    pilotActs(world, ac);
    run(world, flyS);
  }

  /** Aim at an exact heading, which `adjustHeading`'s 10° steps cannot reach. */
  function steer(world: ReturnType<typeof quietWorld>, ac: Aircraft, headingDeg: number): void {
    issue(world, ac, { kind: 'heading', headingDeg });
    pilotActs(world, ac);
  }

  /**
   * Point it at the middle of the last leg, crossing it well inside 45°. Aimed
   * twice with the turn flown in between, because a 100° turn carries the
   * aircraft far enough that a heading computed before it is stale after it.
   */
  function aimAtTheEnd(world: ReturnType<typeof quietWorld>, ac: Aircraft): void {
    const route = ac.rejoin!.nav.route;
    const a = route.waypoints[route.waypoints.length - 2]!.position;
    const b = route.waypoints[route.waypoints.length - 1]!.position;
    const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    steer(world, ac, bearing({ x: ac.x, y: ac.y }, midpoint));
    run(world, 60);
    steer(world, ac, bearing({ x: ac.x, y: ac.y }, midpoint));
  }

  function flyToEstablished(world: ReturnType<typeof quietWorld>, ac: Aircraft, limitS = 900): void {
    for (let elapsed = 0; elapsed < limitS; elapsed += 5) {
      run(world, 5);
      if (ac.star) return;
    }
    throw new Error('never rejoined the route');
  }

  it('remembers the route a vector took it off, and gives it back on R', () => {
    const { ac, world } = arrival('VANDA');
    run(world, 60);
    const star = ac.star!.route;

    vectorAway(world, ac);
    // The whole nav is parked, not just the name: the raised profile of a
    // stacked delivery and the sequencing index both have to survive (§4.5a).
    expect(ac.star).toBeNull();
    expect(ac.rejoin!.nav.route).toBe(star);
    expect(ac.rejoin!.leg).toBeNull();

    aimAtTheEnd(world, ac);
    resumeArrival(world, ac);
    pilotActs(world, ac);
    expect(ac.rejoin!.leg).not.toBeNull();

    flyToEstablished(world, ac);
    expect(ac.star!.route).toBe(star);
    expect(offRouteNm(ac, star)).toBeLessThan(STAR_REJOIN_XTK_NM);
    // The published profile has all three axes back.
    expect(ac.star!.altitudeManual).toBe(false);
    expect(ac.star!.speedManual).toBe(false);
    // And flies it: the aircraft descends onto the published profile and the
    // profile takes the vertical back once it is there.
    let onProfile = false;
    for (let i = 0; i < 600 && ac.star && !onProfile; i += 1) {
      run(world, 1);
      onProfile = starOwnsVertical(ac);
    }
    expect(onProfile).toBe(true);
  });

  it('takes the first leg the assigned heading crosses, and none behind it', () => {
    const star = SCENARIO.stars[0]!;
    const nav = joinStar(star);
    const a = star.waypoints[1]!.position;
    const b = star.waypoints[2]!.position;
    const course = bearing(a, b);
    const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    // 5 NM to the left of the leg, so a heading 90° right of its course crosses it.
    const offset = headingVector(normalizeHeading(course - 90));
    const ac = makeAircraft({ x: midpoint.x + offset.x * 5, y: midpoint.y + offset.y * 5 });

    expect(rejoinLegIndex(nav, ac, normalizeHeading(course + 90))).toBe(2);
    // Away from the route it reaches nothing at all, and a track parallel to a
    // leg never crosses that one however far it runs.
    expect(rejoinLegIndex(nav, ac, normalizeHeading(course - 90))).toBeNull();
    expect(rejoinLegIndex(nav, ac, course)).not.toBe(2);
    // Legs already flown are not candidates: the scan starts at `nav.index`.
    nav.index = 3;
    expect(rejoinLegIndex(nav, ac, normalizeHeading(course + 90))).not.toBe(2);
  });

  it('joins a later leg when the heading cuts the corner, which is the shortcut', () => {
    const { ac, world } = arrival('VANDA');
    run(world, 60);
    const legLeft = ac.star!.index;

    vectorAway(world, ac);
    aimAtTheEnd(world, ac);
    resumeArrival(world, ac);
    pilotActs(world, ac);

    // Aimed across the arc, the ray reaches a leg further down the route first,
    // and the published fixes between are cut out — which is the point.
    expect(ac.rejoin!.leg!).toBeGreaterThan(legLeft);
    flyToEstablished(world, ac);
    expect(ac.star!.index).toBeGreaterThan(legLeft);
  });

  it('re-casts the ray when the aircraft is turned while armed', () => {
    const { ac, world } = arrival('VANDA');
    run(world, 60);
    vectorAway(world, ac);
    aimAtTheEnd(world, ac);
    resumeArrival(world, ac);
    pilotActs(world, ac);
    expect(ac.rejoin!.leg).not.toBeNull();

    // A turn does not disarm — aiming the intercept is what it is for — but it
    // is the only thing that moves the ray, so a turn away drops the leg.
    steer(world, ac, normalizeHeading(ac.targetHeadingDeg + 140));
    expect(ac.rejoin!.leg).toBeNull();
    expect(ac.star).toBeNull();
  });

  it('gives up when it flies past the end of the leg it was joining', () => {
    const { ac, world } = arrival('VANDA');
    run(world, 60);
    vectorAway(world, ac);
    aimAtTheEnd(world, ac);
    resumeArrival(world, ac);
    pilotActs(world, ac);
    const route = ac.rejoin!.nav.route;
    const end = route.waypoints[ac.rejoin!.leg!]!;

    // Put it beyond the leg's end fix, still armed. The leg's own end is the
    // range limit, so there is nothing left to intercept (§4.5a).
    const beyond = headingVector(bearing(route.waypoints[ac.rejoin!.leg! - 1]!.position, end.position));
    ac.x = end.position.x + beyond.x * 5;
    ac.y = end.position.y + beyond.y * 5;
    run(world, PHYSICS_DT);

    expect(ac.rejoin!.leg).toBeNull();
    expect(ac.star).toBeNull();
  });

  it('holds its level rather than climbing when it rejoins from below the profile', () => {
    const { ac, world } = arrival('VANDA');
    run(world, 60);
    // Vectored off and descended well under the profile in the same breath,
    // which `R` then hands back — the aircraft must not be hauled up to meet it.
    for (let i = 0; i < 3; i += 1) adjustHeading(world, ac, 1);
    for (let i = 0; i < 5; i += 1) adjustAltitude(world, ac, -1);
    pilotActs(world, ac);
    run(world, 200);

    aimAtTheEnd(world, ac);
    resumeArrival(world, ac);
    pilotActs(world, ac);
    flyToEstablished(world, ac);
    expect(ac.star!.rejoining).toBe(-1);

    const atRejoinFt = ac.altitudeFt;
    let highestFt = ac.altitudeFt;
    let previousFt = ac.altitudeFt;
    let worstJumpFt = 0;
    for (let i = 0; i < 24_000 && ac.star; i += 1) {
      run(world, PHYSICS_DT);
      highestFt = Math.max(highestFt, ac.altitudeFt);
      worstJumpFt = Math.max(worstJumpFt, Math.abs(ac.altitudeFt - previousFt));
      previousFt = ac.altitudeFt;
    }
    // It waits for the descending profile to come down to it and never gains a
    // foot, and nothing snaps when it does (§4.3).
    expect(highestFt).toBeLessThan(atRejoinFt + 10);
    expect(worstJumpFt).toBeLessThan(10);
  });

  it('descends on the published gradient, not at the rate of a level assignment', () => {
    // Same route, same seed, same point on the descent: one arrival never
    // touched, one vectored off and given the route back. "Resume the arrival"
    // has to mean it descends like the arrival — given the joining fix's level
    // as a plain assignment instead, it dives at the full kinematic rate and
    // levels off early, which is the dive-and-drive §4.5 exists to avoid.
    const untouched = arrival('RIMOL');
    run(untouched.world, 420);
    expect(untouched.ac.star).not.toBeNull();

    const { ac, world } = arrival('RIMOL');
    run(world, 60);
    vectorAway(world, ac);
    aimAtTheEnd(world, ac);
    resumeArrival(world, ac);
    pilotActs(world, ac);

    run(world, 30);
    // Both are descending towards the same published crossing.
    expect(ac.targetAltitudeFt).toBe(untouched.ac.targetAltitudeFt);
    // Within half the untouched rate of it, rather than the ~1400 fpm a plain
    // "descend 7000" produces from up here.
    const gradientFpm = Math.abs(untouched.ac.vsFpm);
    expect(Math.abs(ac.vsFpm)).toBeLessThan(gradientFpm * 1.5);
  });

  it('hands the published profile back to an aircraft still on the route', () => {
    const { ac, world } = arrival('KOVAL');
    run(world, 60);
    adjustAltitude(world, ac, -1);
    adjustSpeed(world, ac, -1);
    pilotActs(world, ac);
    expect(ac.star!.altitudeManual).toBe(true);
    expect(ac.star!.speedManual).toBe(true);
    const before = { x: ac.x, y: ac.y };

    resumeArrival(world, ac);
    pilotActs(world, ac);
    expect(ac.star!.altitudeManual).toBe(false);
    expect(ac.star!.speedManual).toBe(false);
    // Nothing lateral changed, and nothing snapped vertically.
    expect(distance({ x: ac.x, y: ac.y }, before)).toBeLessThan(0.5);

    let previousFt = ac.altitudeFt;
    let worstJumpFt = 0;
    for (let i = 0; i < 4000 && ac.star; i += 1) {
      run(world, PHYSICS_DT);
      worstJumpFt = Math.max(worstJumpFt, Math.abs(ac.altitudeFt - previousFt));
      previousFt = ac.altitudeFt;
    }
    expect(worstJumpFt).toBeLessThan(10);
  });
});
