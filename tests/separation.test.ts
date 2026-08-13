import { describe, expect, it } from 'vitest';
import { analyzeSeparation, inTrailSpacing } from '../src/sim/separation.js';
import { makeAircraft, onFinalApproach } from './helpers.js';

describe('separation minima', () => {
  it('flags a violation only when both 3 NM and 1000 ft are breached', () => {
    const a = makeAircraft({ x: 0, y: 20, altitudeFt: 6000, headingDeg: 180 });
    const b = makeAircraft({ x: 2, y: 20, altitudeFt: 6000, headingDeg: 180 });
    b.id = 2;

    const report = analyzeSeparation([a, b]);
    expect(report.alerts.get(a.id)).toBe('violation');
    expect(report.alerts.get(b.id)).toBe('violation');
    expect(report.pairs[0]!.horizNm).toBeCloseTo(2, 6);
  });

  it('accepts 2 NM laterally when 1500 ft apart vertically', () => {
    const a = makeAircraft({ x: 0, y: 20, altitudeFt: 6000, headingDeg: 180 });
    const b = makeAircraft({ x: 2, y: 20, altitudeFt: 7500, headingDeg: 180 });
    b.id = 2;

    const report = analyzeSeparation([a, b]);
    expect(report.alerts.get(a.id)).toBeUndefined();
    expect(report.pairs).toHaveLength(0);
  });

  it('warns before a predicted conflict, while still legally separated', () => {
    // Converging head-on, 8 NM apart at the same level: legal now, not in 90 s.
    const a = makeAircraft({ x: 0, y: 20, altitudeFt: 6000, headingDeg: 90, iasKts: 250 });
    const b = makeAircraft({ x: 8, y: 20, altitudeFt: 6000, headingDeg: 270, iasKts: 250 });
    b.id = 2;

    const report = analyzeSeparation([a, b]);
    expect(report.pairs[0]!.level).toBe('warning');
    expect(report.alerts.get(a.id)).toBe('warning');
  });

  it('raises the red tier inside 1.5 NM and 500 ft', () => {
    const a = makeAircraft({ x: 0, y: 20, altitudeFt: 6000, headingDeg: 180 });
    const b = makeAircraft({ x: 1, y: 20, altitudeFt: 6200, headingDeg: 180 });
    b.id = 2;

    expect(analyzeSeparation([a, b]).pairs[0]!.red).toBe(true);
  });
});

describe('in-trail spacing on final', () => {
  const lead = makeAircraft({ ...onFinalApproach(6), altitudeFt: 1900, headingDeg: 180, phase: 'gs' });
  const follower = makeAircraft({
    ...onFinalApproach(10),
    altitudeFt: 3000,
    headingDeg: 180,
    phase: 'loc',
  });
  follower.id = 2;

  it('measures nose-to-tail distance along the localizer', () => {
    const { spacing, leader } = inTrailSpacing([lead, follower]);
    expect(spacing.get(follower.id)).toBeCloseTo(4, 6);
    expect(leader.get(follower.id)).toBe(lead);
    expect(spacing.get(lead.id)).toBeUndefined();
  });

  it('leaves legally spaced traffic on the same localizer alone', () => {
    // 4 NM in trail: fine under the in-trail rule, and exempt from the
    // lateral/vertical test that would otherwise apply (IF 6.11.7).
    const report = analyzeSeparation([lead, follower]);
    expect(report.pairs).toHaveLength(0);
    expect(report.alerts.get(follower.id)).toBeUndefined();
  });

  it('flags an in-trail bust below 3 NM', () => {
    const tight = makeAircraft({
      ...onFinalApproach(8),
      altitudeFt: 2600,
      headingDeg: 180,
      phase: 'loc',
    });
    tight.id = 3;

    const report = analyzeSeparation([lead, tight]);
    expect(report.inTrail.get(tight.id)).toBeCloseTo(2, 6);
    expect(report.alerts.get(tight.id)).toBe('violation');
    expect(report.pairs).toHaveLength(1);
  });
});
