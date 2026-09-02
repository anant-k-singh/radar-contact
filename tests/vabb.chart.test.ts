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
import { createRng } from '../src/sim/rng.js';
import { createArrival } from '../src/sim/traffic.js';
import { createWorld, step } from '../src/sim/world.js';
import { bearing, distance, magnitude } from '../src/sim/units.js';
import { labelSpot } from '../src/render/mapLayer.js';
import { isInsideAirspace } from '../src/scenario/airspace.js';
import { createProjection, STATS_GUTTER_PX, toScreen } from '../src/render/project.js';

/** Distance from a point to the nearest of a ring's segments. */
function distanceToRing(
  ring: readonly { x: number; y: number }[],
  p: { x: number; y: number },
): number {
  let nearest = Infinity;
  for (let i = 1; i < ring.length; i++) {
    const a = ring[i - 1]!;
    const b = ring[i]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    let t = lenSq === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    nearest = Math.min(nearest, Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy));
  }
  return nearest;
}

/** Signed area of a closed ring: positive is counter-clockwise in this frame. */
function signedArea(ring: readonly { x: number; y: number }[]): number {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
    sum += ring[j]!.x * ring[i]!.y - ring[i]!.x * ring[j]!.y;
  return sum / 2;
}

/** Whether a ring encloses a point — the usual crossing count. */
function encloses(ring: readonly { x: number; y: number }[], p: { x: number; y: number }): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)
      inside = !inside;
  }
  return inside;
}

/** Unsigned area of a closed ring, in square NM — the shoelace formula. */
function ringArea(ring: readonly { x: number; y: number }[]): number {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
    sum += ring[j]!.x * ring[i]!.y - ring[i]!.x * ring[j]!.y;
  return Math.abs(sum) / 2;
}

const VABB = scenarioById('VABB')!;
const CTX = { runway: VABB.runway, arp: VABB.arp };

/**
 * The final approach corridor, where terrain is kept at any size (10–25 NM off
 * the threshold, 1 NM either side of the course). RWY 27 lands westbound, so
 * along-track from the threshold runs +x and `threshold.x - point.x` is negative
 * out along the approach — hence the sign.
 */
const APPROACH_CORRIDOR_XTK_NM = 1;
function inApproachCorridor(ring: readonly { x: number; y: number }[]): boolean {
  return ring.some((point) => {
    const alongNm = point.x - VABB.runway.threshold.x;
    return alongNm >= 0 && alongNm <= 25 && Math.abs(point.y) <= APPROACH_CORRIDOR_XTK_NM;
  });
}
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
      expect(gate.inboundHeadingDeg).toBeCloseTo((gate.bearingDeg + 180) % 360, 6);
      // Every handover is inside the assignable band, so the controller can hold an
      // arrival at the level it arrives on.
      expect(gate.entryAltitudeFt).toBeLessThanOrEqual(VABB.airspace.ceilingFt);
      expect(gate.entryAltitudeFt).toBeGreaterThan(VABB.airspace.mvaFt);
    }
    // The handover levels differ per gate: a long route enters high and has the
    // miles to lose it, and EMRAK 2A — 25 NM from the boundary to its only fix —
    // has to be given the height off lower or it cannot get down (§4.5).
    expect(
      VABB.gates.map((gate) => [gate.name, gate.entryAltitudeFt, gate.entrySpeedKts]),
    ).toEqual([
      ['MOLGO', 14_000, 260],
      ['IGBAN', 15_000, 260],
      ['POKON', 17_000, 280],
      ['KETOR', 15_000, 260],
      ['EMRAK', 12_000, 250],
    ]);
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
        ['IGBAN', [18.610513, 57.040765], 15000, 260],
        ['MB392', [16.101035, 25.618617], 10000, 230],
        ['EMROS', [15.701932, 7.239117], 6000, 210],
        ['OLGUS', [34.427681, 7.423783], 5000, 210],
      ]],
      ['POKON2A', 93.511864, [
        ['POKON', [-44.355437, 40.405386], 17000, 280],
        ['RCPO', [-31.017065, 25.502774], 15000, 270],
        ['MB379', [-14.86794, 7.459783], 12000, 250],
        ['EMROS', [15.701932, 7.239117], 8000, 210],
        ['OLGUS', [34.427681, 7.423783], 7000, 210],
      ]],
      ['EMRAK2A', 25.38785, [
        ['EMRAK', [56.714048, 19.583584], 12000, 250],
        ['RCEM', [43.546509, 12.399163], 10000, 230],
        ['OLGUS', [34.427681, 7.423783], 6000, 210],
      ]],
      ['KETOR2A', 85.370164, [
        ['KETOR', [-44.885959, -39.815206], 15000, 260],
        ['RCKE', [-30.286261, -26.145941], 14000, 260],
        ['MB393', [-14.252904, -11.134383], 11000, 250],
        ['LIKTA', [16.21097, -9.860717], 8000, 210],
        ['MB395', [29.114434, -9.298217], 6000, 210],
      ]],
      ['MOLGO2A', 58.373015, [
        ['MOLGO', [28.201578, -52.959145], 14000, 260],
        ['DUGED', [16.597789, -25.53755], 10000, 230],
        ['LIKTA', [16.21097, -9.860717], 6000, 210],
        ['MB395', [29.114434, -9.298217], 5000, 210],
      ]],
    ]);
  });

  it('puts a holding fix on the three arrivals with room for one', () => {
    // RC__ is not published — see `stars.ts`. The three longest routes have 30 to 44
    // NM from the boundary to their first published fix, so without these there is
    // nothing in the outer half of the airspace to hold an arrival at; the other two
    // reach a real fix soon enough to hold there instead. Pinned because both the
    // position and the level are derived: the fix sits on the published leg, and its
    // crossing is that leg's own profile at that point, rounded up to a level —
    // except EMRAK 2A's, which is stated: it is the shortest route in and 10,000 is
    // 500 ft *above* its own profile there, bought back over the remaining 10 NM.
    const held: Record<string, { insetNm: number; altitudeFt?: number }> = {
      POKON2A: { insetNm: 20 },
      EMRAK2A: { insetNm: 15, altitudeFt: 10_000 },
      KETOR2A: { insetNm: 20 },
    };
    for (const star of VABB.stars) {
      const gate = star.waypoints[0]!;
      const rc = star.waypoints[1]!;
      const expected = held[star.name];
      if (expected === undefined) {
        expect(rc.name.startsWith('RC')).toBe(false);
        continue;
      }
      const next = star.waypoints[2]!;
      expect(rc.name).toBe(`RC${gate.name.slice(0, 2)}`);

      // The gates are on the 60 NM boundary, so the inset is a range as well as a
      // distance along the leg — and the fix is still exactly on the published track.
      expect(distance(gate.position, rc.position)).toBeCloseTo(expected.insetNm, 6);
      expect(distance(gate.position, rc.position) + distance(rc.position, next.position))
        .toBeCloseTo(distance(gate.position, next.position), 6);

      const fraction = expected.insetNm / distance(gate.position, next.position);
      const interpolatedFt =
        gate.altitudeFt! + (next.altitudeFt! - gate.altitudeFt!) * fraction;
      expect(rc.altitudeFt).toBe(expected.altitudeFt ?? Math.ceil(interpolatedFt / 1000) * 1000);
      // Stated or derived, a holding level has to be one the route can descend
      // through — at or above the profile, and below the level before it.
      expect(rc.altitudeFt!).toBeGreaterThanOrEqual(interpolatedFt);
      expect(rc.altitudeFt!).toBeLessThan(gate.altitudeFt!);
      const interpolatedKts = gate.speedKts! + (next.speedKts! - gate.speedKts!) * fraction;
      expect(rc.speedKts).toBe(Math.round(interpolatedKts / 10) * 10);
    }
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

    // Every shared fix is crossed at a different level, and the order of the flows
    // never swaps: POKON 2A is above IGBAN 2A at both of theirs, KETOR 2A above
    // MOLGO 2A at both of theirs.
    expect(fix('POKON2A', 'EMROS').altitudeFt! - fix('IGBAN2A', 'EMROS').altitudeFt!).toBe(2000);
    expect(fix('KETOR2A', 'LIKTA').altitudeFt! - fix('MOLGO2A', 'LIKTA').altitudeFt!).toBe(2000);
    expect(fix('KETOR2A', 'MB395').altitudeFt! - fix('MOLGO2A', 'MB395').altitudeFt!).toBe(1000);
    // OLGUS: three flows terminate there, stacked exactly 1000 ft apart — the
    // tightest split on the field, and the reason it is worth pinning.
    expect(
      [fix('IGBAN2A', 'OLGUS'), fix('EMRAK2A', 'OLGUS'), fix('POKON2A', 'OLGUS')].map(
        (w) => w.altitudeFt,
      ),
    ).toEqual([5000, 6000, 7000]);
  });

  it('carries terrain, as bands of high ground east of the field', () => {
    // Scenery like the coastline, and pinned the same way: the contours are
    // generalised from third-party data, so what is asserted is that they arrive
    // in the local frame at the right scale and in the right order, not what any
    // one point is.
    const bands = VABB.terrain;
    // Minimum safe altitudes, not ground elevations — the source contours are
    // keyed by elevation and these are that plus 2000 ft of obstacle clearance.
    // The first version of this data printed the elevations, understating every
    // band; the bands published as MSA 5,000' and 6,000' are the 5000 and 6000 here.
    expect(bands.map((band) => band.levelFt)).toEqual([3000, 4000, 5000, 6000]);
    // Above the field, or it is not a safe altitude over anything.
    for (const band of bands) expect(band.levelFt).toBeGreaterThan(VABB.elevationFt);

    // Low to high, which is the order `mapLayer` relies on to fill each band over
    // the one below.
    for (let i = 1; i < bands.length; i++)
      expect(bands[i]!.levelFt).toBeGreaterThan(bands[i - 1]!.levelFt);

    for (const band of bands) {
      // A whole number of thousands: rounded up at conversion, and what lets the
      // band be labelled.
      expect(band.levelFt % 1000).toBe(0);
      expect(band.rings.length).toBeGreaterThan(0);

      for (const ring of band.rings) {
        // Closed, and enough points to bound an area.
        expect(ring.length).toBeGreaterThanOrEqual(4);
        expect(ring[0]).toEqual(ring[ring.length - 1]);
        // Kept only if it reaches inside the boundary; the overhang past it is
        // trimmed by `mapLayer`'s clip rather than here.
        expect(ring.some((point) => magnitude(point) < 61)).toBe(true);

        // Two area floors, because the field is generalised two ways. Away from
        // the approach the brush sets the floor: nothing survives it under about
        // a third of a square mile. In the final approach corridor no peak is
        // dropped at any size, so a ring there is allowed to be tiny — that
        // exemption is the whole point, and a single floor for the field is what
        // deleted the peaks this corridor exists to keep.
        expect(ringArea(ring)).toBeGreaterThan(inApproachCorridor(ring) ? 0.002 : 0.3);
      }
    }

    // Largest ring first *among the brush-generalised rings*, so a small high ring
    // is never buried by a big one. The corridor peaks are appended after them and
    // are deliberately out of that order: they are kept for their position, not
    // their size, and `mapLayer` draws every ring of a band with one fill.
    for (const band of bands) {
      const areas = band.rings.filter((ring) => !inApproachCorridor(ring)).map(ringArea);
      for (let i = 1; i < areas.length; i++)
        expect(areas[i]!).toBeLessThanOrEqual(areas[i - 1]!);
    }

    // The inner final is bare on purpose. A 0.34 sq NM cell at 9 NM read as MSA
    // 3000 once the blanket obstacle clearance was added, and a 3° glideslope is
    // at 2906 ft there — so shading it made every correctly flown ILS a terrain
    // violation. Inside 10 NM the published approach owns the vertical.
    for (const band of bands) {
      for (const ring of band.rings) {
        for (const point of ring) {
          const alongNm = point.x - VABB.runway.threshold.x;
          if (Math.abs(point.y) > APPROACH_CORRIDOR_XTK_NM) continue;
          if (alongNm < 0) continue;
          expect(alongNm).toBeGreaterThanOrEqual(10);
        }
      }
    }

    // Every outer ring winds the same way. `mapLayer` fills with nonzero winding,
    // where a reversed ring *subtracts* — which is how an earlier generalisation
    // pass silently erased whole bands while every other assertion here passed.
    // A hole is allowed to wind the other way, but it has to be enclosed by one
    // of the band's own rings, which is what makes it a hole rather than a bug.
    for (const band of bands) {
      const outer = band.rings.filter((ring) => signedArea(ring) > 0);
      expect(outer.length).toBeGreaterThan(0);
      for (const ring of band.rings)
        if (signedArea(ring) < 0)
          expect(outer.some((o) => encloses(o, ring[0]!))).toBe(true);
    }

    // Every callout's foot is inside the ring it points at, and inside the drawn
    // airspace.
    //
    // Two bugs live here, both of which shipped. The foot used to be the average
    // of the ring's vertices, which for a long concave ring is usually not inside
    // it at all — for the largest band here it fell 23 NM outside the polygon and
    // printed on the boundary arc, reading as a compass tick. And `labelSpot`
    // works on unclipped rings, so without the airspace predicate it can anchor
    // in the part of a ring that overhangs the boundary, where the fill has been
    // clipped away and the leader points at bare background.
    const inAirspace = (point: { x: number; y: number }) =>
      isInsideAirspace(VABB.airspace, point);
    for (const band of bands)
      for (const ring of band.rings) {
        const spot = labelSpot(ring, inAirspace);
        if (spot === null) continue;
        expect(encloses(ring, spot)).toBe(true);
        expect(inAirspace(spot)).toBe(true);
        // The clearance it reports is really the distance to the edge, so the
        // gate upstream is deciding on a true figure.
        expect(spot.clearanceNm).toBeGreaterThan(0);
        expect(Math.abs(spot.clearanceNm - distanceToRing(ring, spot))).toBeLessThan(0.3);
      }

    // Every band gets exactly one callout — the figure names a step in the ramp,
    // so repeating it per ring would be noise. All four have to qualify: the
    // highest band's best patch clears only 0.41 NM, and a foot-clearance gate
    // tuned to the escarpment silently dropped the one band most worth pointing
    // at.
    const anchored = bands.filter((band) =>
      band.rings.some((ring) => {
        const spot = labelSpot(ring, inAirspace);
        return spot !== null && spot.clearanceNm >= 0.25;
      }),
    );
    expect(anchored.length).toBe(bands.length);

    // A callout's figure sits just outside the boundary, not at the edge of the
    // canvas. Running the leader to the canvas edge drew a full-width rule across
    // the scope and put the figures under the stats panel; what it has to do is
    // leave the airspace.
    const projection = createProjection(VABB.airspace, 1158, 1134);
    const radiusPx = VABB.airspace.radiusNm * projection.pxPerNm;
    for (const band of bands) {
      let best: ReturnType<typeof labelSpot> = null;
      for (const ring of band.rings) {
        const spot = labelSpot(ring, inAirspace);
        if (spot !== null && (best === null || spot.clearanceNm > best.clearanceNm)) best = spot;
      }
      if (best === null) continue;
      const foot = toScreen(projection, best);
      // The foot is inside the circle and the figure is outside it, so the leader
      // crosses the boundary exactly once.
      expect(Math.hypot(foot.x - projection.cx, foot.y - projection.cy)).toBeLessThan(radiusPx);
      // And the exit is close to the arc rather than out at the canvas edge — the
      // half-width at the label's own height, which is what makes the figures
      // follow the curve instead of forming a column.
      const dy = Math.abs(foot.y - projection.cy);
      const halfWidth = Math.sqrt(Math.max(0, radiusPx * radiusPx - dy * dy));
      const exitX = projection.cx + halfWidth + 6;
      expect(exitX).toBeGreaterThan(foot.x);
      expect(exitX).toBeLessThan(1158 - STATS_GUTTER_PX + 40);
    }

    // The Ghats are east of the field, and the high ground is the eastern end of
    // that: every 4000 ft ring sits well to the east of the ARP.
    const high = bands[bands.length - 1]!;
    for (const ring of high.rings)
      for (const point of ring) expect(point.x).toBeGreaterThan(20);
  });

  it('carries a coastline, as scenery inside the boundary', () => {
    // Scenery, so nothing about it is a rule the simulation enforces — but it is
    // data, and data can drift. Pinned loosely: the shape is OSM's, not this
    // repository's, so what is asserted is that it arrives in the local frame at
    // the right scale rather than what any individual point is.
    const chains = VABB.coastline;
    expect(chains.length).toBe(4);

    const points = chains.flat();
    expect(points.length).toBeGreaterThan(300);
    // Trimmed to just past the 60 NM boundary, where `mapLayer` clips it.
    for (const point of points) expect(magnitude(point)).toBeLessThan(62);

    // The mainland chain crosses the whole scope, north edge to south edge.
    const mainland = chains[0]!;
    expect(mainland[0]!.y).toBeGreaterThan(58);
    expect(mainland[mainland.length - 1]!.y).toBeLessThan(-58);

    // The field sits between the sea and the harbour: the nearest coast west of
    // the ARP is a few miles out, which is the whole reason RWY 27 departs over
    // water. Anything that broke the projection would move this by tens of miles.
    const west = points.filter((point) => point.x < 0 && Math.abs(point.y) < 2);
    const nearest = Math.min(...west.map((point) => Math.abs(point.x)));
    expect(nearest).toBeGreaterThan(1);
    expect(nearest).toBeLessThan(6);
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
      // A thousand above the field's own assignable ceiling, which VABB's 17,000
      // handover at POKON is what sets.
      expect(sid.topFt).toBe(18_000);
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
    // ANOLI is 9000 rather than its published 10,000, because POKON 2A is flown 2000
    // ft lower into EMROS than the supplement codes — the one altitude on this field
    // that is not the chart's, pinned here so it cannot drift back silently.
    expect(wpt('ANOLI2A/SEKVI', 'ANOLI').maxAltitudeFt).toBe(9000);
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

describe('terrain violations at VABB', () => {
  // The accounting lives in `world.ts`, and only a field with terrain exercises
  // it — ZZZZ has none, so `tests/separation.test.ts` can only test the geometry.
  const overTheGhats = (): { x: number; y: number; levelFt: number } => {
    // Take a point genuinely inside the highest band rather than guessing one, so
    // this cannot rot if the outlines are regenerated.
    const band = [...VABB.terrain].sort((a, b) => b.levelFt - a.levelFt)[0]!;
    const ring = band.rings[0]!;
    let x = 0;
    let y = 0;
    for (const point of ring) {
      x += point.x;
      y += point.y;
    }
    return { x: x / ring.length, y: y / ring.length, levelFt: band.levelFt };
  };

  it('counts an aircraft below the MSA, and logs why', () => {
    const spot = overTheGhats();
    const world = createWorld(VABB, 7);
    world.traffic.nextSpawnAtS = Number.POSITIVE_INFINITY;
    world.traffic.nextDepartureAtS = Number.POSITIVE_INFINITY;
    world.departureFlowPerHour = 0;
    world.messages = [];

    const ac = world.aircraft[0] ?? null;
    expect(ac).toBeNull();

    const intruder = createArrival(VABB, createRng(1), world.traffic, VABB.gates[0]!, [], 0);
    intruder.star = null;
    intruder.x = spot.x;
    intruder.y = spot.y;
    intruder.altitudeFt = spot.levelFt - 1000;
    intruder.targetAltitudeFt = intruder.altitudeFt;
    world.aircraft = [intruder];

    step(world, 0.05);

    expect(world.separation.terrain).toHaveLength(1);
    expect(world.separation.terrain[0]!.msaFt).toBe(spot.levelFt);
    expect(world.separation.alerts.get(intruder.id)).toBe('violation');
    expect(world.stats.violations).toBe(1);
    expect(world.stats.violationSeconds).toBeGreaterThan(0);
    expect(world.messages.some((m) => m.text.startsWith('TERRAIN:'))).toBe(true);

    // Standing in the same place is one violation, not one per tick.
    step(world, 0.05);
    expect(world.stats.violations).toBe(1);

    // Climbing above it clears the alert and stops the clock.
    intruder.altitudeFt = spot.levelFt + 500;
    step(world, 0.05);
    const seconds = world.stats.violationSeconds;
    expect(world.separation.terrain).toHaveLength(0);
    // `ac.alert` is a 1 Hz radar sample rather than an instantaneous truth (§5),
    // so the report is what clears first; the target's colour follows on the next
    // sweep.
    expect(world.separation.alerts.get(intruder.id)).toBeUndefined();
    step(world, 0.05);
    expect(world.stats.violationSeconds).toBeCloseTo(seconds, 6);
  });

  it('leaves an aircraft over the sea alone', () => {
    // West of the field is water: RWY 27 departs over it, and nothing is shaded.
    const world = createWorld(VABB, 7);
    world.traffic.nextSpawnAtS = Number.POSITIVE_INFINITY;
    world.traffic.nextDepartureAtS = Number.POSITIVE_INFINITY;
    world.departureFlowPerHour = 0;
    const ac = createArrival(VABB, createRng(1), world.traffic, VABB.gates[0]!, [], 0);
    ac.star = null;
    ac.x = -30;
    ac.y = 0;
    ac.altitudeFt = 3000;
    world.aircraft = [ac];

    step(world, 0.05);
    expect(world.separation.terrain).toHaveLength(0);
    expect(world.stats.violations).toBe(0);
  });
});
