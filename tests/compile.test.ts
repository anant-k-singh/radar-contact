/**
 * What `compileScenario` derives, tested on the compiler rather than on a field.
 *
 * The rules a *field* has to satisfy live in `scenario.test.ts`, which runs the
 * validator and flies every route. This file is about the other direction: given
 * a spec, is the compiled `Scenario` the one the author asked for.
 */
import { describe, expect, it } from 'vitest';
import { compileScenario } from '../src/scenario/compile.js';
import { depart } from '../src/scenario/geometry.js';
import { DEFAULT_SCENARIO } from '../src/scenario/registry.js';
import type { ScenarioSpec, SidSpec } from '../src/scenario/types.js';
import { ROTATED_SPEC } from './fixtures/rotatedField.js';

/**
 * A branching SID shaped like a real one: a trunk that carries the turn off the
 * runway, then three ways out of it. VABB's three SIDs are all this shape.
 */
const BRANCHING: SidSpec = {
  name: 'FANOU1A',
  fixes: [
    { name: 'TRUNK', at: depart(4, 0) },
    { name: 'TURNS', at: depart(4, -10), maxAltitudeFt: 4000 },
  ],
  exits: [
    { name: 'NEARR', fixes: [{ name: 'NEARR', at: depart(4, -22) }] },
    { name: 'SOUTH', fixes: [{ name: 'SOUTH', at: depart(-8, -22) }] },
    { name: 'AHEAD', fixes: [{ name: 'MIDDL', at: depart(14, -14) }, { name: 'AHEAD', at: depart(30, -20) }] },
  ],
};

function withSids(spec: ScenarioSpec, sids: readonly SidSpec[]): ScenarioSpec {
  return { ...spec, sids };
}

describe('a SID with several ways out', () => {
  const scenario = compileScenario(withSids(ROTATED_SPEC, [BRANCHING]));

  it('compiles to one flat route per exit', () => {
    expect(scenario.sids.map((sid) => sid.name)).toEqual([
      'FANOU1A/NEARR',
      'FANOU1A/SOUTH',
      'FANOU1A/AHEAD',
    ]);
    // Flat: the sim only ever sees a chain of waypoints and an index into it.
    for (const sid of scenario.sids) {
      expect(sid.waypoints.length).toBeGreaterThan(2);
      expect(sid.chart).toBe('FANOU1A');
    }
  });

  it('gives every branch the same trunk, restrictions and all', () => {
    for (const sid of scenario.sids) {
      expect(sid.waypoints[0]!.name).toBe(`RWY${scenario.runway.id}`);
      expect(sid.waypoints.slice(0, 3).map((wpt) => wpt.name)).toEqual([
        `RWY${scenario.runway.id}`,
        'TRUNK',
        'TURNS',
      ]);
      expect(sid.waypoints[2]!.position).toEqual(scenario.sids[0]!.waypoints[2]!.position);
      expect(sid.waypoints[2]!.maxAltitudeFt).toBe(4000);
      expect(sid.waypoints[2]!.alongNm).toBeCloseTo(scenario.sids[0]!.waypoints[2]!.alongNm, 12);
    }
  });

  it('reads the turn off the shared trunk, so the branches agree with the chart', () => {
    // The trunk carries the turn, so it is found before any branch is reached
    // and all three report what the chart labels.
    expect(new Set(scenario.sids.map((sid) => sid.turn))).toEqual(new Set(['left']));
  });

  it('lets the branches differ when the trunk goes straight out', () => {
    // Nothing forces a trunk to turn. When it does not, the first leg off the
    // runway course is the branch's own, and two branches leaving opposite sides
    // genuinely do turn opposite ways — which is what the label should say.
    const straight = compileScenario(
      withSids(ROTATED_SPEC, [
        {
          name: 'SPLIT1A',
          fixes: [{ name: 'TRUNK', at: depart(4, 0) }],
          exits: [
            { name: 'PORTS', fixes: [{ name: 'PORTS', at: depart(4, -24) }] },
            { name: 'STARB', fixes: [{ name: 'STARB', at: depart(4, 24) }] },
          ],
        },
      ]),
    );
    expect(straight.sids.map((sid) => sid.turn)).toEqual(['left', 'right']);
  });

  it('measures each branch to its own exit fix', () => {
    const byName = new Map(scenario.sids.map((sid) => [sid.name, sid]));
    const ahead = byName.get('FANOU1A/AHEAD')!;
    const near = byName.get('FANOU1A/NEARR')!;
    expect(ahead.waypoints[ahead.waypoints.length - 1]!.name).toBe('AHEAD');
    expect(near.waypoints[near.waypoints.length - 1]!.name).toBe('NEARR');
    expect(ahead.lengthNm).toBeGreaterThan(near.lengthNm);
    // The top of climb is defaulted onto whichever fix each branch ends at.
    expect(ahead.waypoints[ahead.waypoints.length - 1]!.minAltitudeFt).toBe(ahead.topFt);
  });
});

describe('a SID with one way out', () => {
  it('keeps the chart name unchanged, so a recording still resolves it', () => {
    // The shipped field declares no exits. Its compiled names are the chart's,
    // with no branch suffix — which is what `zzzz.chart.test.ts` and every
    // recording made before exits existed are written against.
    for (const sid of DEFAULT_SCENARIO.sids) {
      expect(sid.name).toBe(sid.chart);
      expect(sid.name).not.toContain('/');
    }
  });
});
