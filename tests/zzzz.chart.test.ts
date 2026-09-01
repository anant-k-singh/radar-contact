/**
 * The ZZZZ chart, fix by fix.
 *
 * A snapshot on purpose. The routes are generated from the runway frame now
 * rather than written out as coordinates, which is what lets a second field reuse
 * the same builders — and it means a change to the frame, to the compiler or to
 * one of the offsets in  can move a fix without any behavioural
 * test noticing. These are the published positions, verified against the
 * hand-authored geometry they replaced.
 *
 * Nothing generic belongs here: this is what *this* field's chart says. The rules
 * every field must satisfy are asserted over the whole registry elsewhere.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_SCENARIO } from '../src/scenario/registry.js';

const ZZZZ = DEFAULT_SCENARIO;
/** Rounded to the foot, and with negative zero normalised away. */
const nm = (v: number) => Number(v.toFixed(6)) + 0;
const at = (p: { x: number; y: number }) => [nm(p.x), nm(p.y)];

describe('the ZZZZ chart', () => {
  it('sets the runway and the airport reference point', () => {
    expect(ZZZZ.icao).toBe('ZZZZ');
    expect(ZZZZ.elevationFt).toBe(0);
    expect(at(ZZZZ.arp)).toEqual([0, 0]);
    expect(ZZZZ.runway.id).toBe('18');
    expect(ZZZZ.runway.courseDeg).toBe(180);
    expect(ZZZZ.runway.lengthNm).toBe(1.6);
    expect(at(ZZZZ.runway.threshold)).toEqual([0, 0.8]);
    expect(at(ZZZZ.runway.farEnd)).toEqual([0, -0.8]);
  });

  it('places the four entry gates on the boundary', () => {
    expect(ZZZZ.gates.map((g) => g.name)).toEqual(['KOVAL', 'TEMBA', 'RIMOL', 'VANDA']);
    const byName = new Map(ZZZZ.gates.map((g) => [g.name, g]));
    expect(at(byName.get('KOVAL')!.position)).toEqual([32.13938, 38.302222]);
    expect(byName.get('KOVAL')!.inboundHeadingDeg).toBeCloseTo(220, 9);
    expect(at(byName.get('TEMBA')!.position)).toEqual([38.302222, -32.13938]);
    expect(byName.get('TEMBA')!.inboundHeadingDeg).toBeCloseTo(310, 9);
    expect(at(byName.get('RIMOL')!.position)).toEqual([-38.302222, -32.13938]);
    expect(byName.get('RIMOL')!.inboundHeadingDeg).toBeCloseTo(50, 9);
    expect(at(byName.get('VANDA')!.position)).toEqual([-32.13938, 38.302222]);
    expect(byName.get('VANDA')!.inboundHeadingDeg).toBeCloseTo(140, 9);
  });

  it('publishes each arrival route, fix by fix', () => {
    expect(ZZZZ.stars.map((s) => s.name)).toEqual(['VANDA1A', 'KOVAL1A', 'RIMOL1A', 'TEMBA1A']);
    const byName = new Map(ZZZZ.stars.map((s) => [s.name, s]));

    const vanda1a = byName.get('VANDA1A')!;
    expect(vanda1a.lengthNm).toBeCloseTo(43.392, 6);
    expect(vanda1a.waypoints.map((w) => [w.name, at(w.position), Number(w.dtgNm.toFixed(6)), w.altitudeFt, w.speedKts])).toEqual([
      ['VANDA', [-32.13938, 38.302222], 43.392, 11000, 250],
      ['OKPUR', [-26.06969, 27.151111], 30.696, 9000, 250],
      ['ALVOR', [-20, 16], 18, 7000, 230],
      ['ARDIS', [-2, 16], 0, 3000, 200],
    ]);

    const koval1a = byName.get('KOVAL1A')!;
    expect(koval1a.lengthNm).toBeCloseTo(43.392, 6);
    expect(koval1a.waypoints.map((w) => [w.name, at(w.position), Number(w.dtgNm.toFixed(6)), w.altitudeFt, w.speedKts])).toEqual([
      ['KOVAL', [32.13938, 38.302222], 43.392, 11000, 250],
      ['NIVEL', [26.06969, 27.151111], 30.696, 9000, 250],
      ['BELGA', [20, 16], 18, 7000, 230],
      ['BOXAR', [2, 16], 0, 3000, 200],
    ]);

    const rimol1a = byName.get('RIMOL1A')!;
    expect(rimol1a.lengthNm).toBeCloseTo(58.202154, 6);
    expect(rimol1a.waypoints.map((w) => [w.name, at(w.position), Number(w.dtgNm.toFixed(6)), w.altitudeFt, w.speedKts])).toEqual([
      ['RIMOL', [-38.302222, -32.13938], 58.202154, 13000, 250],
      ['SUDIX', [-22.151111, -18.586989], 37.118376, 10000, 250],
      ['LOMSA', [-6, -5.034598], 16.034598, 7000, 230],
      ['PIKON', [-6, 11], 0, 3000, 210],
    ]);

    const temba1a = byName.get('TEMBA1A')!;
    expect(temba1a.lengthNm).toBeCloseTo(58.202154, 6);
    expect(temba1a.waypoints.map((w) => [w.name, at(w.position), Number(w.dtgNm.toFixed(6)), w.altitudeFt, w.speedKts])).toEqual([
      ['TEMBA', [38.302222, -32.13938], 58.202154, 13000, 250],
      ['TAVIR', [22.151111, -18.586989], 37.118376, 10000, 250],
      ['DEMUX', [6, -5.034598], 16.034598, 7000, 230],
      ['KETAN', [6, 11], 0, 3000, 210],
    ]);
  });

  it('publishes each departure route, with the turn read off the geometry', () => {
    expect(ZZZZ.sids.map((s) => s.name)).toEqual(['SABAR1A', 'KIROS1A', 'RAMOX1A']);
    const byName = new Map(ZZZZ.sids.map((s) => [s.name, s]));

    const sabar1a = byName.get('SABAR1A')!;
    expect(sabar1a.turn).toBe('right');
    expect(sabar1a.topFt).toBe(14_000);
    expect(sabar1a.lengthNm).toBeCloseTo(39.2, 6);
    expect(sabar1a.waypoints.map((w) => [w.name, at(w.position), Number(w.alongNm.toFixed(6)), w.maxAltitudeFt, w.minAltitudeFt])).toEqual([
      ['RWY18', [0.0, -0.8], 0, undefined, undefined],
      ['NORVU', [0, -4], 3.2, undefined, undefined],
      ['MORVA', [-8, -4], 11.2, 4000, undefined],
      ['SABAR', [-36, -4], 39.2, undefined, 14000],
    ]);

    const kiros1a = byName.get('KIROS1A')!;
    expect(kiros1a.turn).toBe('left');
    expect(kiros1a.topFt).toBe(14_000);
    expect(kiros1a.lengthNm).toBeCloseTo(39.2, 6);
    expect(kiros1a.waypoints.map((w) => [w.name, at(w.position), Number(w.alongNm.toFixed(6)), w.maxAltitudeFt, w.minAltitudeFt])).toEqual([
      ['RWY18', [0.0, -0.8], 0, undefined, undefined],
      ['NORVU', [0, -4], 3.2, undefined, undefined],
      ['TELMU', [8, -4], 11.2, 4000, undefined],
      ['KIROS', [36, -4], 39.2, undefined, 14000],
    ]);

    const ramox1a = byName.get('RAMOX1A')!;
    expect(ramox1a.turn).toBe('straight');
    expect(ramox1a.topFt).toBe(14_000);
    expect(ramox1a.lengthNm).toBeCloseTo(35.2, 6);
    expect(ramox1a.waypoints.map((w) => [w.name, at(w.position), Number(w.alongNm.toFixed(6)), w.maxAltitudeFt, w.minAltitudeFt])).toEqual([
      ['RWY18', [0.0, -0.8], 0, undefined, undefined],
      ['NORVU', [0, -4], 3.2, undefined, undefined],
      ['RAMOX', [0, -36], 35.2, undefined, 14000],
    ]);
  });
});
