/**
 * The VABB area sector, fix by fix.
 *
 * The same kind of claim `vabb.chart.test.ts` makes, over the part of the chart
 * that field does not carry. Most of this sector's positions are transcribed
 * coordinates already pinned there or in the southern sector's own data, so what
 * is pinned here is what is **new**: the four northern transitions, the twelve
 * gates the 150 NM ring puts them on, and the levels the ring's ten fewer miles
 * moved.
 *
 * The four northern fixes are the reason this file matters more than a snapshot
 * usually does. They are the only positions on any field stated as a published
 * track and distance rather than read from a coordinate table (see `fixes.ts`),
 * so this is where that derivation is checked rather than trusted — and it is
 * checked against the chart's own printed figures, which is the only independent
 * statement of them there is.
 *
 * Nothing generic belongs here. The rules every field satisfies are asserted over
 * the registry in `scenario.test.ts`, and the ones every *center* field satisfies
 * in `center.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { boundaryMarginNm } from '../src/scenario/airspace.js';
import { scenarioById } from '../src/scenario/registry.js';
import { agreedGapS, deliveryWindows } from '../src/sim/delivery.js';
import { VABB_FIXES } from '../src/scenario/fields/vabb/fixes.js';
import { VABB_AREA_FIXES } from '../src/scenario/fields/vabbArea/fixes.js';
import { bearing, distance, magnitude, normalizeHeading, type Point } from '../src/sim/units.js';

const FIELD = scenarioById('VABBA')!;
const RUNWAY = FIELD.runway;
const resolve = (name: keyof typeof VABB_AREA_FIXES): Point =>
  VABB_AREA_FIXES[name]({ runway: RUNWAY, arp: FIELD.arp });

const gate = (name: string) => FIELD.gates.find((g) => g.name === name)!;
const route = (name: string) => FIELD.stars.find((s) => s.name === name)!;
const waypoint = (routeName: string, fixName: string) =>
  route(routeName).waypoints.find((w) => w.name === fixName)!;

/** Signed difference between two bearings, in degrees. */
const offBy = (a: number, b: number) => {
  const d = normalizeHeading(a - b);
  return d > 180 ? d - 360 : d;
};

describe('the four northern transitions', () => {
  it('reproduces each published leg, which is what they were stated from', () => {
    // Not an independent check — each fix is *defined* by its leg — but it is
    // the one that fails loudly if `backAlong` or the frame ever changes sense,
    // which for a fix with no coordinate table behind it is the whole guard.
    const legs = [
      ['AKTIV', 'IGBAN', 197, 12.6],
      ['EXOLU', 'POKON', 133, 39.0],
      ['BOFIN', 'POKON', 202, 60.2],
      ['OPAKA', 'EMRAK', 255, 40.0],
    ] as const;
    for (const [from, to, trackDeg, distNm] of legs) {
      const a = resolve(from);
      const b = resolve(to);
      expect(distance(a, b), from).toBeCloseTo(distNm, 2);
      expect(offBy(bearing(a, b), trackDeg), from).toBeCloseTo(0, 2);
    }
  });

  it('puts each where the chart says, relative to the field', () => {
    // AKTIV at 72.9 NM is what `fields/vabb/airport.ts` calls "73 NM out,
    // outside the airspace" for the approach field, computed there from the same
    // leg before this field existed. The other three land within a mile of a
    // 100 NM arc, which is the next boundary out and the reason they are all one
    // leg from their TMA fix.
    const ranges = { AKTIV: 72.87, EXOLU: 99.56, BOFIN: 99.15, OPAKA: 100.25 } as const;
    for (const [name, rangeNm] of Object.entries(ranges)) {
      expect(magnitude(resolve(name as keyof typeof ranges)), name).toBeCloseTo(rangeNm, 2);
    }
  });

  it('leaves the published anchors exactly where the approach field has them', () => {
    // The whole derivation hangs off these four, so a drift here would move the
    // northern half of the sector silently.
    for (const name of ['IGBAN', 'POKON', 'EMRAK', 'OLGUS'] as const) {
      expect(resolve(name), name).toEqual(VABB_FIXES[name]({ runway: RUNWAY, arp: FIELD.arp }));
    }
  });

  it('audits the north chart\'s own trunk legs against the transcription', () => {
    // These four are transcribed rather than derived, so this *is* independent:
    // the chart's printed track and distance against what the coordinates give.
    // Under a mile and under a degree is the flat local frame doing what §3.1 A1
    // documents, not a transcription error.
    const legs = [
      ['IGBAN', 'MB392', 185, 31.7],
      ['MB392', 'EMROS', 182, 18.3],
      ['POKON', 'MB379', 139, 44.7],
      ['EMRAK', 'OLGUS', 242, 25.7],
    ] as const;
    for (const [from, to, trackDeg, distNm] of legs) {
      const a = VABB_FIXES[from]({ runway: RUNWAY, arp: FIELD.arp });
      const b = VABB_FIXES[to]({ runway: RUNWAY, arp: FIELD.arp });
      expect(Math.abs(distance(a, b) - distNm), `${from}->${to} dist`).toBeLessThan(0.2);
      expect(Math.abs(offBy(bearing(a, b), trackDeg)), `${from}->${to} track`).toBeLessThan(1);
    }
  });
});

describe('the 150 NM ring', () => {
  it('puts all twelve gates on it, on the bearing their own leg arrives from', () => {
    const bearings: Record<string, number> = {
      AGELA: 138.1, EPKOS: 151.8, AKTIV: 17.4, EXOLU: 312.8, BOFIN: 359.8, KABSO: 175.1,
      ERVIS: 198.0, GUNDI: 215.5, DARMI: 239.0, BISET: 254.0, AROTA: 270.9, OPAKA: 73.4,
    };
    expect(FIELD.gates).toHaveLength(12);
    for (const [name, brg] of Object.entries(bearings)) {
      expect(magnitude(gate(name).position), name).toBeCloseTo(150, 6);
      expect(bearing(FIELD.arp, gate(name).position), name).toBeCloseTo(brg, 1);
    }
  });

  it('keeps each gate on its published track, however far it had to move', () => {
    // The point of `clipToRange`/`extendToRange`: the *track* is published and
    // only how far along it the route starts changes. So the gate, the published
    // fix and the fix the leg aims at stay collinear — which is also what lets
    // the holding fixes be measured from the gate.
    const legs = [
      ['AKTIV', 'AKTIV', 'IGBAN'], ['EXOLU', 'EXOLU', 'POKON'], ['BOFIN', 'BOFIN', 'POKON'],
      ['OPAKA', 'OPAKA', 'EMRAK'], ['KABSO', 'KABSO', 'KETOR'], ['ERVIS', 'ERVIS', 'KETOR'],
      ['GUNDI', 'GUNDI', 'KETOR'], ['DARMI', 'DARMI', 'KETOR'], ['BISET', 'BISET', 'KETOR'],
      ['AROTA', 'AROTA', 'KETOR'], ['EPKOS', 'EPKOS', 'MOLGO'], ['AGELA', 'AGELA', 'BEDOL'],
    ] as const;
    for (const [gateName, fixName, aimedAt] of legs) {
      const published = resolve(fixName);
      const target = resolve(aimedAt);
      expect(
        Math.abs(offBy(bearing(gate(gateName).position, target), bearing(published, target))),
        gateName,
      ).toBeLessThan(0.01);
    }
  });

  it('moves AROTA a quarter mile rather than leaving it outside the boundary', () => {
    // The one entry the ring changed the shape of. AROTA is 150.25 NM out, so at
    // 150 it cannot be a waypoint — and the SUGID leg beyond it is the next
    // sector's rather than this one's to truncate. See `airport.ts`.
    expect(magnitude(resolve('AROTA'))).toBeCloseTo(150.25, 2);
    // 0.27 rather than 0.25: the gate is walked down the KETOR leg, which does
    // not run through the field, so it gives up slightly more track than range.
    expect(distance(gate('AROTA').position, resolve('AROTA'))).toBeCloseTo(0.27, 2);
    expect(route('KETOR2A/AROTA').waypoints.map((w) => w.name)).toEqual([
      'AROTA', 'RCAR', 'KETOR', 'RCKT',
    ]);
  });
});

describe('the five handovers', () => {
  it('delivers on the inner arc itself, whatever inset that takes', () => {
    // The handoff line *is* the boundary, so all five are on it — which a fixed
    // inset does not give, because Mumbai's TMA fixes are not on one arc. The
    // inset falls out at 10.0 to 13.2 NM, and MOLGO is the one that needs the
    // extra: it is 63.2 NM out where the other four are 60.0 to 60.6.
    const insets = { RCKT: 10.03, RCMG: 13.20, RCPK: 10.63, RCIG: 10.63, RCEK: 10.48 };
    for (const [fixName, insetNm] of Object.entries(insets)) {
      const delivery = FIELD.delivery.find((d) => d.fixName === fixName)!;
      const star = FIELD.stars.find((s) => s.waypoints.at(-1)!.name === fixName)!;
      expect(magnitude(delivery.position), fixName).toBeCloseTo(50, 6);
      expect(distance(star.waypoints.at(-2)!.position, delivery.position), fixName)
        .toBeCloseTo(insetNm, 2);
      // On the boundary rather than outside it, so nothing is handed over from
      // airspace this sector does not own.
      expect(boundaryMarginNm(FIELD.airspace, delivery.position), fixName)
        .toBeGreaterThanOrEqual(0);
    }
  });

  it('carries the crossing across the handoff leg unchanged', () => {
    const crossings = [
      ['KETOR2A/KABSO', 'KETOR', 'RCKT', 15_000, 260],
      ['MOLGO2A/EPKOS', 'MOLGO', 'RCMG', 14_000, 260],
      ['POKON2A/EXOLU', 'POKON', 'RCPK', 17_000, 280],
      ['IGBAN2A/AKTIV', 'IGBAN', 'RCIG', 15_000, 260],
      ['EMRAK2A/OPAKA', 'EMRAK', 'RCEK', 12_000, 250],
    ] as const;
    for (const [routeName, mergeName, deliveryName, altitudeFt, speedKts] of crossings) {
      for (const fixName of [mergeName, deliveryName]) {
        expect(waypoint(routeName, fixName).altitudeFt, fixName).toBe(altitudeFt);
        expect(waypoint(routeName, fixName).speedKts, fixName).toBe(speedKts);
      }
    }
  });

  it('states the agreements as the receiving field\'s capacity, split its way', () => {
    // 30 an hour cut by VABB's own gate weights: 34 / 22 / 19 / 13 / 12 %.
    const agreed = { RCMG: 10, RCIG: 7, RCPK: 6, RCKT: 4, RCEK: 4 };
    for (const [fixName, rate] of Object.entries(agreed)) {
      expect(FIELD.delivery.find((d) => d.fixName === fixName)!.targetRatePerHour, fixName)
        .toBe(rate);
    }
    // The whole of Mumbai's arrival flow, which is what a full ring is for — and
    // the interval the sector is actually graded against, since what the field
    // below accepts is one runway rate rather than five independent ones.
    const total = FIELD.delivery.reduce((sum, d) => sum + d.targetRatePerHour, 0);
    expect(total).toBe(31);
    expect(FIELD.agreedRatePerHour).toBe(31);
    expect(agreedGapS(FIELD.agreedRatePerHour)).toBeCloseTo(116.1, 1);
    // Which the sector is graded on as a count over each window: five in six
    // minutes and seven in twelve, the second of them the real ceiling at 35 an
    // hour against the 33 this field offers itself.
    expect(deliveryWindows(FIELD.agreedRatePerHour)).toEqual([
      { windowS: 360, cap: 5 },
      { windowS: 720, cap: 7 },
    ]);
    // And the streams carry those agreements as their shares, so the flow the
    // player sets arrives in the ratio the gates declared.
    expect(FIELD.arrivalStreams.reduce((sum, s) => sum + s.share, 0)).toBe(total);
  });
});

describe('the profile the ring leaves', () => {
  it('gives every entry a level ordered by how far it has to run', () => {
    const expected: Record<string, [number, number]> = {
      'MOLGO2A/EPKOS': [100.1, 28_000],
      'POKON2A/EXOLU': [100.1, 31_000],
      'EMRAK2A/OPAKA': [100.3, 29_000],
      'IGBAN2A/AKTIV': [100.4, 29_000],
      'KETOR2A/DARMI': [101.7, 29_000],
      'KETOR2A/GUNDI': [102.5, 30_000],
      'MOLGO2A/AGELA': [103.3, 30_000],
      'KETOR2A/BISET': [109.3, 31_000],
      'KETOR2A/ERVIS': [112.9, 32_000],
      'KETOR2A/AROTA': [123.3, 33_000],
      'POKON2A/BOFIN': [128.4, 35_000],
      'KETOR2A/KABSO': [133.9, 34_000],
    };
    for (const [name, [lengthNm, entryFt]] of Object.entries(expected)) {
      expect(route(name).lengthNm, name).toBeCloseTo(lengthNm, 1);
      expect(route(name).waypoints[0]!.altitudeFt, name).toBe(entryFt);
    }
    // Within a chart, longer means higher — the field's own rule, and what makes
    // the level at the boundary read as how much room that aircraft has.
    for (const chart of new Set(FIELD.stars.map((s) => s.chart))) {
      const byLength = FIELD.stars
        .filter((s) => s.chart === chart)
        .sort((a, b) => a.lengthNm - b.lengthNm)
        .map((s) => s.waypoints[0]!.altitudeFt!);
      expect([...byLength].sort((a, b) => a - b), chart).toEqual(byLength);
    }
  });

  it('flies one gradient across all twelve, and EMRAK is the steep one', () => {
    const gradients = FIELD.stars.map((s) => ({
      name: s.name,
      ftPerNm: (s.waypoints[0]!.altitudeFt! - s.waypoints.at(-1)!.altitudeFt!) / s.lengthNm,
    }));
    for (const { name, ftPerNm } of gradients) {
      expect(ftPerNm, name).toBeGreaterThan(130);
      expect(ftPerNm, name).toBeLessThan(175);
    }
    // The outlier, and it is EMRAK's 12,000 handover showing through rather than
    // a number anybody picked: it is the lowest of the five by 2000 ft.
    const steepest = gradients.sort((a, b) => b.ftPerNm - a.ftPerNm)[0]!;
    expect(steepest.name).toBe('EMRAK2A/OPAKA');
    expect(steepest.ftPerNm).toBeCloseTo(169.5, 1);
  });

  it('puts a holding fix exactly 50 NM back up every straight entry', () => {
    const holds: Record<string, [string, number, number]> = {
      'KETOR2A/DARMI': ['RCDA', 108.76, 23_000],
      'KETOR2A/GUNDI': ['RCGU', 108.16, 24_000],
      'KETOR2A/BISET': ['RCBI', 103.20, 24_000],
      'KETOR2A/ERVIS': ['RCER', 100.74, 24_000],
      'KETOR2A/AROTA': ['RCAR', 93.71, 23_000],
      'KETOR2A/KABSO': ['RCKA', 86.83, 23_000],
      'MOLGO2A/EPKOS': ['RCEP', 113.14, 23_000],
      'POKON2A/EXOLU': ['RCEX', 110.56, 25_000],
      'POKON2A/BOFIN': ['RCBO', 90.98, 25_000],
      'IGBAN2A/AKTIV': ['RCAK', 110.27, 23_000],
      'EMRAK2A/OPAKA': ['RCOP', 110.24, 22_000],
    };
    for (const [routeName, [fixName, rangeNm, altitudeFt]] of Object.entries(holds)) {
      const hold = waypoint(routeName, fixName);
      const merge = route(routeName).waypoints.at(-2)!;
      expect(magnitude(hold.position), fixName).toBeCloseTo(rangeNm, 2);
      expect(distance(hold.position, merge.position), fixName).toBeCloseTo(50, 6);
      expect(hold.altitudeFt, fixName).toBe(altitudeFt);
      expect(hold.speedKts, fixName).toBe(270);
    }
    // AGELA is the exception, and it is the published fix doing the job: it is
    // 38.9 NM from MOLGO rather than 50, because that is where BEDOL is.
    const bedol = waypoint('MOLGO2A/AGELA', 'BEDOL');
    expect(distance(bedol.position, waypoint('MOLGO2A/AGELA', 'MOLGO').position))
      .toBeCloseTo(38.9, 1);
    expect(bedol.altitudeFt).toBe(21_000);
  });
});
