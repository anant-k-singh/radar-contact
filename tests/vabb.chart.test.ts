/**
 * The VABB chart, fix by fix.
 *
 * A snapshot, for the same reason ZZZZ has one: every position here is derived —
 * the runway frame places the arrival platforms, and the SIDs are chains of
 * published bearings and distances resolved at compile time — so a change to the
 * frame, to the compiler or to one of the offsets can move a fix without any
 * behavioural test noticing. Generated from the compiled field once it validated
 * clean, and checked against the hand-solved geometry it was authored from.
 *
 * Nothing generic belongs here. The rules every field must satisfy are asserted
 * over the whole registry in `scenario.test.ts`; this is what *this* chart says.
 */
import { describe, expect, it } from 'vitest';
import { scenarioById } from '../src/scenario/registry.js';

const VABB = scenarioById('VABB')!;
const nm = (v: number) => Number(v.toFixed(6)) + 0;
const at = (p: { x: number; y: number }) => [nm(p.x), nm(p.y)];

describe('the VABB chart', () => {
  it('sets the runway and the airport reference point', () => {
    expect(VABB.icao).toBe('VABB');
    expect(VABB.elevationFt).toBe(40);
    expect(at(VABB.arp)).toEqual([0, 0]);
    expect(VABB.runway.id).toBe('27');
    expect(VABB.runway.courseDeg).toBe(270);
    // Landing westbound: the threshold is the east end, so arrivals finish east
    // of the field and departures leave over the sea.
    expect(at(VABB.runway.threshold)).toEqual([0.99, 0]);
    expect(at(VABB.runway.farEnd)).toEqual([-0.99, 0]);
  });

  it('draws 14/32 where the aerodrome chart puts its thresholds', () => {
    expect(VABB.inactiveRunways).toEqual([
      { id: '14/32', ends: [{ x: -0.344, y: 0.268 }, { x: 0.535, y: -0.59 }] },
    ]);
  });

  it('places the five entry gates on the boundary, in their charted sectors', () => {
    expect(VABB.gates.map((g) => g.name)).toEqual(['MOLGO', 'IGBAN', 'POKON', 'KETOR', 'EMRAK']);
    const byName = new Map(VABB.gates.map((g) => [g.name, g]));

    // The two near-cardinal gates land on the chords rather than the 60 NM arc,
    // which is why their y is exactly the airspace half-height.
    expect(at(byName.get('MOLGO')!.position)).toEqual([8.816349, -50]);
    expect(at(byName.get('IGBAN')!.position)).toEqual([3.496341, 50]);
    // The other three are on the arc.
    expect(at(byName.get('POKON')!.position)).toEqual([-50.320234, 32.678342]);
    expect(at(byName.get('KETOR')!.position)).toEqual([-52.976856, -28.168294]);
    expect(at(byName.get('EMRAK')!.position)).toEqual([56.381557, 20.521209]);

    for (const gate of VABB.gates) {
      expect(gate.inboundHeadingDeg).toBeCloseTo((gate.bearingDeg + 180) % 360, 6);
      // All five charts publish the same handover.
      expect(gate.entryAltitudeFt).toBe(12_000);
      expect(gate.entrySpeedKts).toBe(250);
    }
  });

  it("weights the gates by where Mumbai's traffic comes from", () => {
    expect(VABB.gates.map((g) => [g.name, g.weight])).toEqual([
      ['MOLGO', 34],
      ['IGBAN', 22],
      ['POKON', 19],
      ['KETOR', 13],
      ['EMRAK', 12],
    ]);
  });

  it('publishes the five arrivals', () => {
    const chart = VABB.stars.map((star) => [
      star.name,
      nm(star.lengthNm),
      star.waypoints.map((w) => [w.name, at(w.position), w.altitudeFt, w.speedKts]),
    ]);
    expect(chart).toEqual([
      ['IGBAN2A', 51.317655, [
        ['IGBAN', [3.496341, 50], 12000, 250],
        ['MB392', [10.74317, 35], 9000, 250],
        ['EMROS', [17.99, 20], 7000, 230],
        ['OLGUS', [17.99, 2], 3000, 200],
      ]],
      ['MOLGO2A', 49.371259, [
        ['MOLGO', [8.816349, -50], 12000, 250],
        ['DUGED', [13.403175, -35], 9000, 250],
        ['LIKTA', [17.99, -20], 7000, 230],
        ['MB395', [17.99, -2], 3000, 200],
      ]],
      ['POKON2A', 70.916506, [
        ['POKON', [-50.320234, 32.678342], 12000, 250],
        ['MB379', [-30.549644, 19.839171], 10000, 250],
        ['MB377', [-10.779055, 7], 7000, 230],
        ['MB378', [12.99, 7], 3000, 210],
      ]],
      ['KETOR2A', 71.244704, [
        ['KETOR', [-52.976856, -28.168294], 12000, 250],
        ['MB393', [-33.07097, -17.584147], 10000, 250],
        ['MB371', [-13.165085, -7], 7000, 230],
        ['MB372', [12.99, -7], 3000, 210],
      ]],
      ['EMRAK2A', 35.080472, [
        ['EMRAK', [56.381557, 20.521209], 12000, 250],
        ['MB386', [45.744512, 14.388786], 9000, 250],
        ['MB387', [35.107467, 8.256363], 6000, 230],
        ['MB388', [25.99, 3], 4000, 210],
      ]],
    ]);
  });

  it('ends the two approach-side arrivals pointing at each other, 4 NM apart', () => {
    // The sequencing problem the field is built around, and the one thing the two
    // designed platforms have to get right.
    const byName = new Map(VABB.stars.map((star) => [star.name, star]));
    const north = byName.get('IGBAN2A')!.waypoints.at(-1)!;
    const south = byName.get('MOLGO2A')!.waypoints.at(-1)!;
    expect(north.position.x).toBeCloseTo(south.position.x, 9);
    expect(north.position.y - south.position.y).toBeCloseTo(4, 9);
  });

  it('flattens the three departures into eight ways out', () => {
    expect(VABB.sids.map((sid) => sid.name)).toEqual([
      'ANOLI2A/SEKVI',
      'ANOLI2A/MB361',
      'ANOLI2A/MB381',
      'RAXET2A/MB370',
      'RAXET2A/SAKUN',
      'VEVAK2A/PPN',
      'VEVAK2A/ONAPA',
      'VEVAK2A/MB362',
    ]);
    // All three charts leave the runway through MB364, at or above 2600.
    for (const sid of VABB.sids) {
      expect(sid.waypoints[1]!.name).toBe('MB364');
      expect(at(sid.waypoints[1]!.position)).toEqual([-7.49, 0]);
      expect(sid.waypoints[1]!.minAltitudeFt).toBe(2600);
      expect(sid.topFt).toBe(14_000);
    }
  });

  it('holds the two trunks that pass under an arrival downwind', () => {
    // MB367 and MB368 are 9.1 NM north and south of MB364, two miles past where
    // the downwinds cross at 7 NM abeam. Both carry the crossing ceiling.
    const byName = new Map(VABB.sids.map((sid) => [sid.name, sid]));
    const north = byName.get('ANOLI2A/MB361')!.waypoints[2]!;
    const south = byName.get('VEVAK2A/ONAPA')!.waypoints[2]!;
    expect([north.name, south.name]).toEqual(['MB367', 'MB368']);
    expect(at(north.position)).toEqual([-7.807585, 9.094457]);
    expect(at(south.position)).toEqual([-7.807585, -9.094457]);
    expect(north.maxAltitudeFt).toBe(4000);
    expect(south.maxAltitudeFt).toBe(4000);
  });

  it('keeps the chart floors that separate the two long branches from above', () => {
    const byName = new Map(VABB.sids.map((sid) => [sid.name, sid]));
    const xopal = byName.get('ANOLI2A/SEKVI')!.waypoints.find((w) => w.name === 'XOPAL')!;
    const omgix = byName.get('VEVAK2A/PPN')!.waypoints.find((w) => w.name === 'OMGIX')!;
    // The chart's own "at or above FL120" and "FL100".
    expect(xopal.minAltitudeFt).toBe(12_000);
    expect(omgix.minAltitudeFt).toBe(10_000);
  });

  it("reads each branch's turn off the track it flies", () => {
    // The ANOLI and VEVAK trunks turn before they split, so their branches agree.
    // RAXET's runs within 7° of the runway course, so its two branches take their
    // own — one leaves southwest and one northwest, and they say so.
    expect(VABB.sids.map((sid) => [sid.name, sid.turn])).toEqual([
      ['ANOLI2A/SEKVI', 'right'],
      ['ANOLI2A/MB361', 'right'],
      ['ANOLI2A/MB381', 'right'],
      ['RAXET2A/MB370', 'left'],
      ['RAXET2A/SAKUN', 'right'],
      ['VEVAK2A/PPN', 'left'],
      ['VEVAK2A/ONAPA', 'left'],
      ['VEVAK2A/MB362', 'left'],
    ]);
  });
});
