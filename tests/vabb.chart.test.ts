/**
 * The VABB chart, fix by fix.
 *
 * A snapshot, for the same reason ZZZZ has one — but of a different kind of claim.
 * ZZZZ's positions are *designed*, generated from the runway frame, so its snapshot
 * guards against the frame or the compiler moving one. VABB's are *transcribed*:
 * every position here is a published WGS84 coordinate converted into the local
 * frame, so this file pins the transcription and the conversion together, and a
 * value that drifts means one of the two changed.
 *
 * Generated from the compiled field once it validated clean, and cross-checked
 * against the ranges and bearings the AIP's own tabular coding implies.
 *
 * Nothing generic belongs here. The rules every field must satisfy are asserted
 * over the whole registry in `scenario.test.ts`; this is what *this* chart says.
 */
import { describe, expect, it } from 'vitest';
import { scenarioById } from '../src/scenario/registry.js';

const VABB = scenarioById('VABB')!;
const nm = (v: number) => Number(v.toFixed(6)) + 0;
const at = (p: { x: number; y: number }) => [nm(p.x), nm(p.y)];
const range = (p: { x: number; y: number }) => Math.hypot(p.x, p.y);

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
  });

  it('draws 14/32 where the aerodrome chart puts its thresholds', () => {
    expect(VABB.inactiveRunways).toEqual([
      { id: '14/32', ends: [{ x: -0.344, y: 0.268 }, { x: 0.535, y: -0.59 }] },
    ]);
  });

  it('puts the five entry gates at their published coordinates', () => {
    expect(VABB.gates.map((g) => [g.name, at(g.position), nm(g.bearingDeg), g.weight])).toEqual([
      ['MOLGO', [29.431953, -55.866717], 152.218641, 34],
      ['IGBAN', [18.633155, 57.324283], 18.00666, 22],
      ['POKON', [-44.731111, 40.825117], 312.386027, 19],
      ['KETOR', [-44.903416, -39.83155], 228.425389, 13],
      ['EMRAK', [56.989331, 19.733783], 70.900487, 12],
    ]);
    for (const gate of VABB.gates) {
      expect(gate.inboundHeadingDeg).toBeCloseTo((gate.bearingDeg + 180) % 360, 6);
      // All five charts publish the same handover.
      expect(gate.entryAltitudeFt).toBe(12_000);
      expect(gate.entrySpeedKts).toBe(250);
    }
  });

  it('finds all five convergence fixes on a 60 NM arc', () => {
    // Not a coincidence and not a design choice of ours: these are the TMA entry
    // fixes, and it is why the airspace here is 60-odd miles across. Four are
    // within 0.6 NM of 60; MOLGO is the outlier at 63.2.
    const ranges = VABB.gates.map((g) => range(g.position));
    for (const r of ranges) expect(r).toBeGreaterThan(59.5);
    expect(Math.max(...ranges)).toBeLessThan(63.5);
    // And they are inside the airspace at their true positions, not pulled onto it.
    for (const gate of VABB.gates) {
      expect(range(gate.position)).toBeLessThan(VABB.airspace.radiusNm);
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
      ['IGBAN2A', 68.91711, [
        ['IGBAN', [18.633155, 57.324283], 12000, 250],
        ['MB392', [16.101035, 25.618617], 10000, 230],
        ['EMROS', [15.701932, 7.239117], 8000, 220],
        ['OLGUS', [34.427681, 7.423783], 6000, 210],
      ]],
      ['POKON2A', 94.075162, [
        ['POKON', [-44.731111, 40.825117], 12000, 250],
        ['MB379', [-14.86794, 7.459783], 12000, 230],
        ['EMROS', [15.701932, 7.239117], 11000, 230],
        ['OLGUS', [34.427681, 7.423783], 9000, 210],
      ]],
      ['EMRAK2A', 25.701443, [
        ['EMRAK', [56.989331, 19.733783], 12000, 250],
        ['OLGUS', [34.427681, 7.423783], 7500, 230],
      ]],
      ['KETOR2A', 85.394077, [
        ['KETOR', [-44.903416, -39.83155], 12000, 250],
        ['MB393', [-14.252904, -11.134383], 11000, 230],
        ['LIKTA', [16.21097, -9.860717], 10000, 230],
        ['MB395', [29.114434, -9.298217], 8000, 210],
      ]],
      ['MOLGO2A', 61.530197, [
        ['MOLGO', [29.431953, -55.866717], 12000, 250],
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
      ['ANOLI2A/SEKVI', 'right', 77.074904],
      ['ANOLI2A/MB361', 'right', 65.823801],
      ['ANOLI2A/MB381', 'right', 63.997394],
      ['RAXET2A/MB370', 'left', 64.731727],
      ['VEVAK2A/DOGAP', 'left', 62.381985],
      ['VEVAK2A/ONAPA', 'left', 44.117843],
      ['VEVAK2A/MB362', 'left', 67.718937],
    ]);
    for (const sid of VABB.sids) {
      expect(sid.waypoints[1]!.name).toBe('MB364');
      expect(at(sid.waypoints[1]!.position)).toEqual([-6.507865, -0.269717]);
      expect(sid.waypoints[1]!.minAltitudeFt).toBe(2600);
      expect(sid.topFt).toBe(14_000);
    }
  });

  it('keeps the chart restrictions in both senses', () => {
    const byName = new Map(VABB.sids.map((sid) => [sid.name, sid]));
    const wpt = (sid: string, name: string) =>
      byName.get(sid)!.waypoints.find((w) => w.name === name)!;

    // Under: the two trunks that pass beneath an arrival stream close to the field.
    expect(wpt('ANOLI2A/SEKVI', 'ANOLI').maxAltitudeFt).toBe(10_000);
    expect(wpt('VEVAK2A/DOGAP', 'VEVAK').maxAltitudeFt).toBe(9000);
    // Over: the two branches that cross an arrival track well out, where the
    // arrival is below them. These are the chart's own "at or above".
    expect(wpt('ANOLI2A/SEKVI', 'XOPAL').minAltitudeFt).toBe(12_000);
    expect(wpt('VEVAK2A/DOGAP', 'OMGIX').minAltitudeFt).toBe(10_000);
  });

  it("reads each branch's turn off the track it flies", () => {
    // ANOLI turns right off 270° and VEVAK left, before either splits, so their
    // branches agree. RAXET's trunk runs within 7° of the runway course — straight
    // out — and its single branch takes its own turn from the leg to MB370.
    expect(new Set(VABB.sids.filter((s) => s.chart === 'ANOLI2A').map((s) => s.turn))).toEqual(
      new Set(['right']),
    );
    expect(new Set(VABB.sids.filter((s) => s.chart === 'VEVAK2A').map((s) => s.turn))).toEqual(
      new Set(['left']),
    );
  });
});
