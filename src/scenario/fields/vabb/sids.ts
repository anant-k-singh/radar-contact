/**
 * VABB's standard departures — the three RWY 27 SIDs, as published.
 *
 * Source: AIP Supplement 84/2020, §7.1–7.3 (cited in `airport.ts`).
 *
 * ## The shape, which is why branching SIDs exist
 *
 * All three start identically: climb on runway heading to 530 ft, then direct
 * **MB364**, 6.5 NM west of the field, at or above 2600. From there they diverge —
 * ANOLI north, RAXET west, VEVAK south — and each of those fans out to the
 * airways. The supplement codes exactly that shape: ANOLI 2A has one "Departure -
 * Enroute Transition" block per exit, each repeating the trunk, which is what
 * `compileSid` produces from a trunk plus `exits`.
 *
 * The initial climb-then-turn is not modelled as a leg. The coding is `VA` to
 * 530 ft then `DF` to MB364 — climb on heading, then turn direct — and a departure
 * here rotates and tracks its first fix, which comes to the same track a few
 * hundred feet later. MB364's own "at or above 2600" is what the chart uses to
 * hold the turn until the aircraft is up, and that is kept.
 *
 * ## What is truncated
 *
 * Six exits leave the airspace long before their published fix: SAKUN 100 NM,
 * ISRIS 100, EXOLU 100, BETKU 96, DARMI 151, GUNDI 130, and PPN is a VOR outside
 * it. Each branch therefore ends at the last published fix on its track — MB381 for
 * the BETKU/EXOLU fan, MB370 for DARMI, ONAPA for GUNDI/ERVIS, MB362 for
 * MABTA/AGELA, SEKVI for the eastern fan, DOGAP for PPN — shortened to
 * `EXIT_RANGE_NM` where that fix is itself too close to the boundary. Two branches
 * whose only fix is outside the airspace (RAXET→SAKUN and RAXET→BISET) are dropped
 * rather than invented: RAXET keeps the DARMI fan, through MB370.
 *
 * ## The crossing restrictions are the chart's own
 *
 * Both trunks that pass under an arrival stream carry a published ceiling, and both
 * are enough:
 *
 * - **ANOLI (−FL100)** runs north from MB364 straight under POKON 2A's leg into
 *   EMROS, which is descending 12,000 → 11,000 there. Held at or below 10,000, the
 *   departure passes about 1800 ft beneath it.
 * - **VEVAK (−FL90)** runs south under KETOR 2A's leg into LIKTA, descending
 *   11,000 → 10,000. Held at or below 9000, it passes about 1100 ft beneath.
 *
 * Further out the separation is the other way round: **XOPAL's +FL120** and
 * **OMGIX's +FL100** put those branches above the arrival tracks they cross. Both
 * senses, both from the chart — see §4.7.
 */
import { clipToRange } from '../../geometry.js';
import type { SidFixSpec, SidSpec } from '../../types.js';
import { VABB_FIXES as F } from './fixes.js';

/** The first fix on every SID, and the only one all three share. */
const MB364: SidFixSpec = { name: 'MB364', at: F.MB364, minAltitudeFt: 2600 };

/**
 * How far out a branch is allowed to end, so there is a leg left to leave on.
 *
 * Four of the seven exits are published within a mile of the 60 NM boundary and one
 * just outside it, which leaves a departure no room to fly out — the route would
 * finish exactly where the airspace does. `clipToRange` shortens the last leg to
 * this range along the *published track*, so the exit heading is the real one and
 * only the distance moves. The three exits already inside are untouched.
 */
const EXIT_RANGE_NM = 55;

export const VABB_SIDS: readonly SidSpec[] = [
  {
    name: 'ANOLI2A',
    fixes: [MB364, { name: 'ANOLI', at: F.ANOLI, maxAltitudeFt: 10_000 }],
    exits: [
      {
        // The eastern fan — AAU, MELAX, NONEN and KAKPO all leave this way.
        name: 'SEKVI',
        fixes: [
          { name: 'XOPAL', at: F.XOPAL, minAltitudeFt: 12_000 },
          { name: 'MB373', at: F.MB373 },
          { name: 'MB365', at: F.MB365 },
          { name: 'SEKVI', at: clipToRange(EXIT_RANGE_NM, F.MB365, F.SEKVI) },
        ],
      },
      // Due north, for ISRIS at 100 NM.
      { name: 'MB361', fixes: [{ name: 'MB361', at: clipToRange(EXIT_RANGE_NM, F.ANOLI, F.MB361) }] },
      // Northwest, for BETKU and EXOLU.
      {
        name: 'MB381',
        fixes: [
          { name: 'MB399', at: F.MB399 },
          { name: 'MB381', at: clipToRange(EXIT_RANGE_NM, F.MB399, F.MB381) },
        ],
      },
    ],
  },
  {
    // West, out over the sea. Nothing above it: the nearest arrival track is
    // POKON 2A's run into EMROS, well to the north.
    name: 'RAXET2A',
    fixes: [MB364, { name: 'RAXET', at: F.RAXET }],
    exits: [
      { name: 'MB370', fixes: [{ name: 'MB370', at: clipToRange(EXIT_RANGE_NM, F.RAXET, F.MB370) }] },
    ],
  },
  {
    name: 'VEVAK2A',
    fixes: [MB364, { name: 'VEVAK', at: F.VEVAK, maxAltitudeFt: 9000 }],
    exits: [
      // East, for PPN — the branch that climbs over the southern arrival stream.
      {
        name: 'DOGAP',
        fixes: [
          { name: 'OMGIX', at: F.OMGIX, minAltitudeFt: 10_000 },
          { name: 'DOGAP', at: F.DOGAP },
        ],
      },
      // Southwest, for GUNDI and ERVIS.
      { name: 'ONAPA', fixes: [{ name: 'ONAPA', at: F.ONAPA }] },
      // South, for MABTA and AGELA.
      { name: 'MB362', fixes: [{ name: 'MB362', at: clipToRange(EXIT_RANGE_NM, F.VEVAK, F.MB362) }] },
    ],
  },
];
