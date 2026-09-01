/**
 * The VABB chart, fix by fix.
 *
 * A snapshot, for the same reason ZZZZ has one — but of a different kind of claim.
 * ZZZZ's positions are *designed*, generated from the runway frame, so its snapshot
 * guards against the frame or the compiler moving one. VABB's are *transcribed*:
 * every position is a published WGS84 coordinate converted into the local frame, so
 * this file pins the transcription and the conversion together, and a value that
 * drifts means one of the two changed.
 *
 * Generated from the compiled field once it validated clean, and cross-checked
 * against the ranges and bearings the AIP's own tabular coding implies.
 *
 * Nothing generic belongs here. The rules every field must satisfy are asserted over
 * the whole registry in `scenario.test.ts`; this is what *this* chart says.
 */
import { describe, expect, it } from 'vitest';
import { VABB_FIXES } from '../src/scenario/fields/vabb/fixes.js';
import { scenarioById } from '../src/scenario/registry.js';
import { bearing, magnitude } from '../src/sim/units.js';

const VABB = scenarioById('VABB')!;
const CTX = { runway: VABB.runway, arp: VABB.arp };
const nm = (v: number) => Number(v.toFixed(6)) + 0;
const at = (p: { x: number; y: number }) => [nm(p.x), nm(p.y)];
const published = (name: keyof typeof VABB_FIXES) => VABB_FIXES[name](CTX);

describe('the VABB chart', () => {
  it('sets the runway and the airport reference point', () => {
    expect(VABB.icao).toBe('VABB');
    expect(VABB.elevationFt).toBe(40);
    expect(at(VABB.arp)).toEqual([0, 0]);
    expect(VABB.runway.id).toBe('27');
    expect(VABB.runway.courseDeg).toBe(270);
    // Landing westbound: the threshold is the east end, so arrivals finish east of
    // the field and departures leave over the sea.
    expect(at(VABB.runway.threshold)).toEqual([0.99, 0]);
    expect(at(VABB.runway.farEnd)).toEqual([-0.99, 0]);
    expect(VABB.airspace.radiusNm).toBe(60);
  });

  it('draws 14/32 where the aerodrome chart puts its thresholds', () => {
    expect(VABB.inactiveRunways).toEqual([
      { id: '14/32', ends: [{ x: -0.344, y: 0.268 }, { x: 0.535, y: -0.59 }] },
    ]);
  });

  it('keeps the published coordinate of every entry fix', () => {
    // The gates are placed on the boundary, but what they are placed *along* is the
    // real leg to the real fix, and the real fix is still written down. These are
    // the only thing that makes the placement checkable, and they are also the
    // reason the airspace is 60 NM: four of the five are within 0.6 NM of it.
    expect(
      (['MOLGO', 'IGBAN', 'POKON', 'KETOR', 'EMRAK'] as const).map((name) => [
        name,
        at(published(name)),
        Number(magnitude(published(name)).toFixed(2)),
      ]),
    ).toEqual([
      ['MOLGO', [29.431953, -55.866717], 63.15],
      ['IGBAN', [18.633155, 57.324283], 60.28],
      ['POKON', [-44.731111, 40.825117], 60.56],
      ['KETOR', [-44.903416, -39.83155], 60.02],
      ['EMRAK', [56.989331, 19.733783], 60.31],
    ]);
  });

  it('places each gate where its own inbound leg crosses the boundary', () => {
    expect(VABB.gates.map((g) => [g.name, at(g.position), nm(g.bearingDeg), g.weight])).toEqual([
      ['MOLGO', [28.201578, -52.959145], 151.963996, 34],
      ['IGBAN', [18.610513, 57.040765], 18.06979, 22],
      ['POKON', [-44.355437, 40.405386], 312.331814, 19],
      ['KETOR', [-44.885959, -39.815206], 228.426003, 13],
      ['EMRAK', [56.714048, 19.583584], 70.950005, 12],
    ]);

    for (const gate of VABB.gates) {
      // Exactly on the boundary, which is what makes the outermost range ring the
      // edge of the airspace rather than a decoration.
      expect(magnitude(gate.position)).toBeCloseTo(VABB.airspace.radiusNm, 6);
      // Moved *along the published leg*, not radially — so the arrival still enters
      // from the sector the chart says it does. MOLGO is clipped hardest, 3.2 NM,
      // and its bearing shifts by a quarter of a degree.
      const trueBearing = bearing(VABB.arp, published(gate.name as 'MOLGO'));
      expect(Math.abs(gate.bearingDeg - trueBearing)).toBeLessThan(0.3);
      expect(gate.entryAltitudeFt).toBe(12_000);
      expect(gate.entrySpeedKts).toBe(250);
      expect(gate.inboundHeadingDeg).toBeCloseTo((gate.bearingDeg + 180) % 360, 6);
    }
  });

  it('publishes the five arrivals, merging into two streams', () => {
    expect(
      VABB.stars.map((star) => [
        star.name,
        nm(star.lengthNm),
        star.waypoints.map((w) => [w.name, at(w.position), w.altitudeFt, w.speedKts]),
      ]),
    ).toEqual([
      ['IGBAN2A', 68.632689, [
        ['IGBAN', [18.610513, 57.040765], 12000, 250],
        ['MB392', [16.101035, 25.618617], 10000, 230],
        ['EMROS', [15.701932, 7.239117], 8000, 220],
        ['OLGUS', [34.427681, 7.423783], 6000, 210],
      ]],
      ['POKON2A', 93.511864, [
        ['POKON', [-44.355437, 40.405386], 12000, 250],
        ['MB379', [-14.86794, 7.459783], 12000, 230],
        ['EMROS', [15.701932, 7.239117], 11000, 230],
        ['OLGUS', [34.427681, 7.423783], 9000, 210],
      ]],
      ['EMRAK2A', 25.38785, [
        ['EMRAK', [56.714048, 19.583584], 12000, 250],
        ['OLGUS', [34.427681, 7.423783], 7500, 230],
      ]],
      ['KETOR2A', 85.370164, [
        ['KETOR', [-44.885959, -39.815206], 12000, 250],
        ['MB393', [-14.252904, -11.134383], 11000, 230],
        ['LIKTA', [16.21097, -9.860717], 10000, 230],
        ['MB395', [29.114434, -9.298217], 8000, 210],
      ]],
      ['MOLGO2A', 58.373015, [
        ['MOLGO', [28.201578, -52.959145], 12000, 250],
        ['DUGED', [16.597789, -25.53755], 9000, 230],
        ['LIKTA', [16.21097, -9.860717], 7000, 230],
        ['MB395', [29.114434, -9.298217], 5000, 210],
      ]],
    ]);
  });

  it('shares the merge fixes between routes, at the same place and different levels', () => {
    // The thing that made this field worth transcribing. A fix on two STARs is one
    // fix — same coordinate — and what keeps the two streams apart is the level.
    const byName = new Map(VABB.stars.map((star) => [star.name, star]));
    const fix = (star: string, name: string) =>
      byName.get(star)!.waypoints.find((w) => w.name === name)!;

    for (const name of ['EMROS', 'OLGUS'] as const) {
      expect(at(fix('IGBAN2A', name).position)).toEqual(at(fix('POKON2A', name).position));
    }
    expect(at(fix('KETOR2A', 'LIKTA').position)).toEqual(at(fix('MOLGO2A', 'LIKTA').position));

    // EMROS: the chart's own FL80 against FL110.
    expect(fix('POKON2A', 'EMROS').altitudeFt! - fix('IGBAN2A', 'EMROS').altitudeFt!).toBe(3000);
    // LIKTA: the same 3000 ft split on the southern pair.
    expect(fix('KETOR2A', 'LIKTA').altitudeFt! - fix('MOLGO2A', 'LIKTA').altitudeFt!).toBe(3000);
    // OLGUS: three flows terminate there, stacked 1500 ft apart.
    expect(
      [fix('IGBAN2A', 'OLGUS'), fix('EMRAK2A', 'OLGUS'), fix('POKON2A', 'OLGUS')].map(
        (w) => w.altitudeFt,
      ),
    ).toEqual([6000, 7500, 9000]);
  });

  it('flattens the three departures into seven ways out, all through MB364', () => {
    expect(VABB.sids.map((sid) => [sid.name, sid.turn, nm(sid.lengthNm)])).toEqual([
      ['ANOLI2A/SEKVI', 'right', 76.75385],
      ['ANOLI2A/MB361', 'right', 61.250264],
      ['ANOLI2A/MB381', 'right', 59.047793],
      ['RAXET2A/MB370', 'left', 58.674102],
      ['VEVAK2A/DOGAP', 'left', 62.381985],
      ['VEVAK2A/ONAPA', 'left', 44.117843],
      ['VEVAK2A/MB362', 'left', 61.929617],
    ]);
    for (const sid of VABB.sids) {
      expect(sid.waypoints[1]!.name).toBe('MB364');
      expect(at(sid.waypoints[1]!.position)).toEqual([-6.507865, -0.269717]);
      expect(sid.waypoints[1]!.minAltitudeFt).toBe(2600);
      expect(sid.topFt).toBe(14_000);
    }
  });

  it('ends every departure inside the boundary, on its published track', () => {
    // Four of the seven exits are published within a mile of the boundary and one
    // outside it, so their last leg is shortened along the real track. The three
    // already well inside keep their published position exactly.
    const byName = new Map(VABB.sids.map((sid) => [sid.name, sid]));
    for (const [route, name, clipped] of [
      ['ANOLI2A/SEKVI', 'SEKVI', true],
      ['ANOLI2A/MB361', 'MB361', true],
      ['ANOLI2A/MB381', 'MB381', true],
      ['RAXET2A/MB370', 'MB370', true],
      ['VEVAK2A/DOGAP', 'DOGAP', false],
      ['VEVAK2A/ONAPA', 'ONAPA', false],
      ['VEVAK2A/MB362', 'MB362', true],
    ] as const) {
      const last = byName.get(route)!.waypoints.at(-1)!;
      expect(last.name).toBe(name);
      expect(magnitude(last.position)).toBeLessThan(VABB.airspace.radiusNm);
      if (clipped) expect(magnitude(last.position)).toBeCloseTo(55, 6);
      else expect(at(last.position)).toEqual(at(published(name)));
    }
  });

  it('keeps the chart restrictions in both senses', () => {
    const byName = new Map(VABB.sids.map((sid) => [sid.name, sid]));
    const wpt = (sid: string, name: string) =>
      byName.get(sid)!.waypoints.find((w) => w.name === name)!;

    // Under: the two trunks that pass beneath an arrival stream close to the field.
    expect(wpt('ANOLI2A/SEKVI', 'ANOLI').maxAltitudeFt).toBe(10_000);
    expect(wpt('VEVAK2A/DOGAP', 'VEVAK').maxAltitudeFt).toBe(9000);
    // Over: the two branches that cross an arrival track well out, where the arrival
    // is below them. These are the chart's own "at or above".
    expect(wpt('ANOLI2A/SEKVI', 'XOPAL').minAltitudeFt).toBe(12_000);
    expect(wpt('VEVAK2A/DOGAP', 'OMGIX').minAltitudeFt).toBe(10_000);
  });

  it("reads each branch's turn off the track it flies", () => {
    // ANOLI turns right off 270° and VEVAK left, before either splits, so their
    // branches agree.
    expect(new Set(VABB.sids.filter((s) => s.chart === 'ANOLI2A').map((s) => s.turn))).toEqual(
      new Set(['right']),
    );
    expect(new Set(VABB.sids.filter((s) => s.chart === 'VEVAK2A').map((s) => s.turn))).toEqual(
      new Set(['left']),
    );
  });
});
