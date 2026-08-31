import { describe, expect, it } from 'vitest';
import { AIRPORT } from '../src/scenario/airport.js';
import { STARS, starForGate, starProfileAt, type Star } from '../src/scenario/stars.js';
import type { Aircraft } from '../src/sim/aircraft.js';
import { adjustAltitude, adjustHeading, adjustSpeed } from '../src/sim/commands.js';
import { MVA_FT, SEP_HORIZ_NM, SPEED_FLOOR_CLEAN_KTS } from '../src/sim/constants.js';
import { createRng } from '../src/sim/rng.js';
import { createArrival, createTrafficState } from '../src/sim/traffic.js';
import { distance, type Point } from '../src/sim/units.js';
import { step } from '../src/sim/world.js';
import { pilotActs, quietWorld, run, SCENARIO } from './helpers.js';

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
    expect(STARS).toHaveLength(AIRPORT.gates.length);
    for (const gate of AIRPORT.gates) {
      const star = starForGate(gate.name)!;
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
      expect(last.altitudeFt!).toBeGreaterThan(MVA_FT);
      expect(last.speedKts!).toBeGreaterThanOrEqual(SPEED_FLOOR_CLEAN_KTS);
      expect(last.dtgNm).toBe(0);
      // Published altitudes only ever come down.
      const altitudes = star.altitudes.map((constraint) => constraint.value);
      expect([...altitudes].sort((a, b) => b - a)).toEqual(altitudes);
    }
  });

  it('publishes 250 kt as far as the first fix, and reduces only after it', () => {
    for (const star of STARS) {
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
    for (const star of STARS) {
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
    for (const star of STARS) {
      for (const other of STARS) {
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
