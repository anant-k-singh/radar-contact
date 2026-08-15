import { describe, expect, it } from 'vitest';
import { AIRPORT } from '../src/scenario/airport.js';
import { STARS, starForGate, type Star } from '../src/scenario/stars.js';
import type { Aircraft } from '../src/sim/aircraft.js';
import { adjustAltitude, adjustHeading, adjustSpeed } from '../src/sim/commands.js';
import {
  ENTRY_SPEED_KTS,
  SEP_HORIZ_NM,
  STAR_ARRIVAL_SPEED_KTS,
  STAR_PLATFORM_ALT_FT,
} from '../src/sim/constants.js';
import { createRng } from '../src/sim/rng.js';
import { createArrival, createTrafficState } from '../src/sim/traffic.js';
import { distance, type Point } from '../src/sim/units.js';
import { step } from '../src/sim/world.js';
import { pilotActs, quietWorld, run } from './helpers.js';

/** A fresh arrival at `gateName`, on its STAR, in an otherwise empty world. */
function arrival(gateName: string): { ac: Aircraft; world: ReturnType<typeof quietWorld> } {
  const gate = AIRPORT.gates.find((candidate) => candidate.name === gateName)!;
  const ac = createArrival(createRng(5), createTrafficState(), gate, [], 0);
  return { ac, world: quietWorld(ac) };
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
      expect(star.waypoints[0]!.speedKts).toBe(ENTRY_SPEED_KTS);

      const last = star.waypoints[star.waypoints.length - 1]!;
      expect(last.altitudeFt).toBe(STAR_PLATFORM_ALT_FT);
      expect(last.speedKts).toBe(STAR_ARRIVAL_SPEED_KTS);
      expect(last.dtgNm).toBe(0);
      // Published altitudes only ever come down.
      const altitudes = star.altitudes.map((constraint) => constraint.value);
      expect([...altitudes].sort((a, b) => b - a)).toEqual(altitudes);
    }
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
  it('tracks the route and arrives at the last fix level at 5000 ft and 230 kt', () => {
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
      expect(ac.altitudeFt).toBeCloseTo(STAR_PLATFORM_ALT_FT, -2);
      expect(ac.iasKts).toBeCloseTo(STAR_ARRIVAL_SPEED_KTS, 0);
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
    expect(ac.iasKts).toBeCloseTo(STAR_ARRIVAL_SPEED_KTS, 0);
    expect(world.stats.violations).toBe(0);
  });

  it('descends continuously rather than diving and levelling', () => {
    const { ac, world } = arrival('TEMBA');
    run(world, 120);
    // 9000 → 7000 over the first half of the route: a gentle steady descent.
    expect(ac.vsFpm).toBeLessThan(-150);
    expect(ac.vsFpm).toBeGreaterThan(-900);
    expect(ac.altitudeFt).toBeLessThan(9000);
    expect(ac.altitudeFt).toBeGreaterThan(7000);
  });
});

describe('taking an aircraft off its STAR', () => {
  it('drops the route on a vector, and keeps the descent to the next published level', () => {
    const { ac, world } = arrival('VANDA');
    run(world, 60);
    expect(ac.star).not.toBeNull();

    adjustHeading(world, ac, 1);
    pilotActs(world);

    expect(ac.star).toBeNull();
    // Nothing was said about height or speed, so the published descent to the
    // next level and the published reduction both stand.
    expect(ac.targetAltitudeFt).toBe(7000);
    expect(ac.targetIasKts).toBe(STAR_ARRIVAL_SPEED_KTS);

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
    const { ac, world } = arrival('RIMOL');
    run(world, 60);

    adjustSpeed(world, ac, -1);
    pilotActs(world);
    expect(ac.star).not.toBeNull();
    expect(ac.star!.speedManual).toBe(true);
    expect(ac.star!.altitudeManual).toBe(false);

    run(world, 180);
    expect(ac.iasKts).toBeCloseTo(240, 0);
    expect(ac.altitudeFt).toBeLessThan(9000); // still descending on the profile
  });
});
