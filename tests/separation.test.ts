import { describe, expect, it } from 'vitest';
import { IN_TRAIL_MIN_NM, IN_TRAIL_SEQUENCING_MIN_NM } from '../src/sim/constants.js';
import { analyzeSeparation, inTrailMinimumNm, inTrailSpacing } from '../src/sim/separation.js';
import { geo, makeAircraft, onFinal, RUNWAY } from './helpers.js';

describe('separation minima', () => {
  it('flags a violation only when both 3 NM and 1000 ft are breached', () => {
    const a = makeAircraft({ x: 0, y: 20, altitudeFt: 6000, headingDeg: 180 });
    const b = makeAircraft({ x: 2, y: 20, altitudeFt: 6000, headingDeg: 180 });
    b.id = 2;

    const report = analyzeSeparation(RUNWAY, [a, b]);
    expect(report.alerts.get(a.id)).toBe('violation');
    expect(report.alerts.get(b.id)).toBe('violation');
    expect(report.pairs[0]!.horizNm).toBeCloseTo(2, 6);
  });

  it('accepts 2 NM laterally when 1500 ft apart vertically', () => {
    const a = makeAircraft({ x: 0, y: 20, altitudeFt: 6000, headingDeg: 180 });
    const b = makeAircraft({ x: 2, y: 20, altitudeFt: 7500, headingDeg: 180 });
    b.id = 2;

    const report = analyzeSeparation(RUNWAY, [a, b]);
    expect(report.alerts.get(a.id)).toBeUndefined();
    expect(report.pairs).toHaveLength(0);
  });

  it('warns before a predicted conflict, while still legally separated', () => {
    // Converging head-on, 8 NM apart at the same level: legal now, not in 90 s.
    const a = makeAircraft({ x: 0, y: 20, altitudeFt: 6000, headingDeg: 90, iasKts: 250 });
    const b = makeAircraft({ x: 8, y: 20, altitudeFt: 6000, headingDeg: 270, iasKts: 250 });
    b.id = 2;

    const report = analyzeSeparation(RUNWAY, [a, b]);
    expect(report.pairs[0]!.level).toBe('warning');
    expect(report.alerts.get(a.id)).toBe('warning');
  });

  it('raises the red tier inside 1.5 NM and 500 ft', () => {
    const a = makeAircraft({ x: 0, y: 20, altitudeFt: 6000, headingDeg: 180 });
    const b = makeAircraft({ x: 1, y: 20, altitudeFt: 6200, headingDeg: 180 });
    b.id = 2;

    expect(analyzeSeparation(RUNWAY, [a, b]).pairs[0]!.red).toBe(true);
  });
});

describe('in-trail spacing on final', () => {
  const lead = makeAircraft({ ...onFinal(6), altitudeFt: 1900, headingDeg: 180, phase: 'gs' });
  const follower = makeAircraft({
    ...onFinal(10),
    altitudeFt: 3000,
    headingDeg: 180,
    phase: 'loc',
  });
  follower.id = 2;

  it('measures nose-to-tail distance along the localizer', () => {
    const { spacing, leader } = inTrailSpacing(RUNWAY, [lead, follower]);
    expect(spacing.get(follower.id)).toBeCloseTo(4, 6);
    expect(leader.get(follower.id)).toBe(lead);
    expect(spacing.get(lead.id)).toBeUndefined();
  });

  it('leaves legally spaced traffic on the same localizer alone', () => {
    // 4 NM in trail: fine under the in-trail rule, and exempt from the
    // lateral/vertical test that would otherwise apply.
    const report = analyzeSeparation(RUNWAY, [lead, follower]);
    expect(report.pairs).toHaveLength(0);
    expect(report.alerts.get(follower.id)).toBeUndefined();
  });

  it('requires the 4 NM sequencing gap at 10 NM and beyond', () => {
    // 3.5 NM at 15 NM: legal radar separation, but the gap has to be built out
    // here or it never will be, so it is a bust (§9.3).
    const farLead = makeAircraft({
      ...onFinal(11.5),
      altitudeFt: 3700,
      headingDeg: 180,
      phase: 'loc',
    });
    farLead.id = 4;
    const farFollower = makeAircraft({
      ...onFinal(15),
      altitudeFt: 4800,
      headingDeg: 180,
      phase: 'loc',
    });
    farFollower.id = 5;

    const report = analyzeSeparation(RUNWAY, [farLead, farFollower]);
    expect(report.inTrailMinimum.get(farFollower.id)).toBe(IN_TRAIL_SEQUENCING_MIN_NM);
    expect(report.inTrail.get(farFollower.id)).toBeCloseTo(3.5, 6);
    expect(report.alerts.get(farFollower.id)).toBe('violation');
  });

  it('relaxes to 3 NM inside 10 NM, where the sequence is already set', () => {
    const nearLead = makeAircraft({
      ...onFinal(5),
      altitudeFt: 1600,
      headingDeg: 180,
      phase: 'gs',
    });
    nearLead.id = 6;
    const nearFollower = makeAircraft({
      ...onFinal(8.5),
      altitudeFt: 2700,
      headingDeg: 180,
      phase: 'gs',
    });
    nearFollower.id = 7;

    const report = analyzeSeparation(RUNWAY, [nearLead, nearFollower]);
    expect(report.inTrailMinimum.get(nearFollower.id)).toBe(IN_TRAIL_MIN_NM);
    expect(report.inTrail.get(nearFollower.id)).toBeCloseTo(3.5, 6);
    expect(report.pairs).toHaveLength(0);
  });

  it('switches minimum exactly at 10 NM', () => {
    const at10 = makeAircraft({ ...onFinal(10), headingDeg: 180, phase: 'loc' });
    const justInside = makeAircraft({ ...onFinal(9.9), headingDeg: 180, phase: 'loc' });
    expect(inTrailMinimumNm(geo(at10).alongNm)).toBe(IN_TRAIL_SEQUENCING_MIN_NM);
    expect(inTrailMinimumNm(geo(justInside).alongNm)).toBe(IN_TRAIL_MIN_NM);
  });

  it('flags an in-trail bust below 3 NM', () => {
    const tight = makeAircraft({
      ...onFinal(8),
      altitudeFt: 2600,
      headingDeg: 180,
      phase: 'loc',
    });
    tight.id = 3;

    const report = analyzeSeparation(RUNWAY, [lead, tight]);
    expect(report.inTrail.get(tight.id)).toBeCloseTo(2, 6);
    expect(report.alerts.get(tight.id)).toBe('violation');
    expect(report.pairs).toHaveLength(1);
  });
});

describe('terrain awareness (§9.5)', () => {
  // A square of high ground away from the runway, so nothing here depends on the
  // shipped fields: 10 NM on a side, needing 5000 ft.
  const BAND = [
    {
      levelFt: 5000,
      rings: [
        [
          { x: 20, y: 20 },
          { x: 30, y: 20 },
          { x: 30, y: 30 },
          { x: 20, y: 30 },
          { x: 20, y: 20 },
        ],
      ],
    },
  ];

  it('is the ordinary violation, not a new alert level', () => {
    const ac = makeAircraft({ x: 25, y: 25, altitudeFt: 4000 });
    const report = analyzeSeparation(RUNWAY, [ac], BAND);
    expect(report.alerts.get(ac.id)).toBe('violation');
    expect(report.terrain).toHaveLength(1);
    expect(report.terrain[0]).toMatchObject({ aircraftId: ac.id, msaFt: 5000, belowFt: 1000 });
    // Nothing was added to `pairs` — there is no second aircraft to pair with.
    expect(report.pairs).toHaveLength(0);
  });

  it('clears an aircraft at or above the MSA', () => {
    const at = makeAircraft({ x: 25, y: 25, altitudeFt: 5000 });
    expect(analyzeSeparation(RUNWAY, [at], BAND).terrain).toHaveLength(0);
    const above = makeAircraft({ x: 25, y: 25, altitudeFt: 5001 });
    expect(analyzeSeparation(RUNWAY, [above], BAND).terrain).toHaveLength(0);
  });

  it('catches an aircraft over the middle of a band, not just near its edge', () => {
    // The centre of this band is 5 NM from any edge — ten times the buffer. A rule
    // written as "within TERRAIN_BUFFER_NM of a polygon" misses exactly this case,
    // which is why being inside counts as distance zero.
    const middle = makeAircraft({ x: 25, y: 25, altitudeFt: 3000 });
    expect(analyzeSeparation(RUNWAY, [middle], BAND).terrain).toHaveLength(1);
  });

  it('extends the band by the buffer, and no further', () => {
    // 0.4 NM clear of the western edge: inside the half-mile margin.
    const near = makeAircraft({ x: 19.6, y: 25, altitudeFt: 3000 });
    expect(analyzeSeparation(RUNWAY, [near], BAND).terrain).toHaveLength(1);
    // 0.6 NM clear: outside it.
    const clear = makeAircraft({ x: 19.4, y: 25, altitudeFt: 3000 });
    expect(analyzeSeparation(RUNWAY, [clear], BAND).terrain).toHaveLength(0);
  });

  it('takes the highest band where two overlap', () => {
    const stacked = [
      BAND[0]!,
      {
        levelFt: 7000,
        rings: [
          [
            { x: 24, y: 24 },
            { x: 26, y: 24 },
            { x: 26, y: 26 },
            { x: 24, y: 26 },
            { x: 24, y: 24 },
          ],
        ],
      },
    ];
    const ac = makeAircraft({ x: 25, y: 25, altitudeFt: 6000 });
    const report = analyzeSeparation(RUNWAY, [ac], stacked);
    expect(report.terrain[0]!.msaFt).toBe(7000);
  });

  it('says nothing about a field with no terrain', () => {
    const ac = makeAircraft({ x: 25, y: 25, altitudeFt: 500 });
    expect(analyzeSeparation(RUNWAY, [ac]).terrain).toHaveLength(0);
    expect(analyzeSeparation(RUNWAY, [ac], []).terrain).toHaveLength(0);
  });

  it('exempts an aircraft still on the runway', () => {
    // The roll happens at field elevation by definition, so terrain must not
    // assert a minimum over the aerodrome itself.
    const rolling = makeAircraft({ x: 25, y: 25, altitudeFt: 100 });
    rolling.phase = 'roll';
    expect(analyzeSeparation(RUNWAY, [rolling], BAND).terrain).toHaveLength(0);
  });
});
