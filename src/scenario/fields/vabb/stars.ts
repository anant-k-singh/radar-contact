/**
 * VABB's standard arrivals — the five RWY 27 STARs, as published.
 *
 * Source: AIP Supplement 84/2020, §6.1–6.5 (cited in `airport.ts`). The fix
 * sequences and the tracks are the supplement's tabular coding; the coordinates are
 * its own table, via `fixes.ts`. The **levels are what Mumbai actually flies**, not
 * what the supplement codes — see below.
 *
 * ## Two flows, and they merge
 *
 * Runway 27 lands westbound, so every arrival finishes east of the field, and the
 * published design brings them in as two streams that each converge on one point:
 *
 * - **North and east → EMROS → OLGUS.** IGBAN 2A comes down from the north
 *   through MB392; POKON 2A comes in from the northwest through MB379 and joins it
 *   *at EMROS*; EMRAK 2A comes in from the east-northeast and joins *at OLGUS*.
 * - **South → LIKTA → MB395.** KETOR 2A from the southwest through MB393 and
 *   MOLGO 2A from the south-southeast through DUGED, merging at LIKTA.
 *
 * Both streams end with what the coding calls a `VM` — a vector, heading 180° from
 * OLGUS and 360° from MB395 — which is precisely what the simulation does when a
 * STAR runs out: `leaveStar` holds the heading until the controller intervenes. So
 * the routes end where the real ones do, and the sequencing onto the ILS is the
 * player's, as it is in Mumbai.
 *
 * ## Shared fixes are the point, not a problem
 *
 * Three routes reach OLGUS and two reach EMROS, and a STAR writes its published
 * altitude straight onto the aircraft (§4.5) — so what stops two arrivals meeting
 * there is that **each route crosses at a different level**. That is how a real
 * merge is deconflicted, and it is why this field needs no special handling in the
 * traffic generator.
 *
 * ## Why the levels are observed rather than coded
 *
 * The supplement codes "AT OR ABOVE FL120 AT 250KT" at every entry fix, an altitude
 * at only two of the four shared fixes (EMROS at FL80 on IGBAN 2A and FL110 on
 * POKON 2A; FL100 at LIKTA on KETOR 2A), and ends every route with a `VM` vector
 * that leaves OLGUS and MB395 to the controller. In practice Mumbai rarely flies the
 * coded profile at all and assigns by situation, so the levels here are the ones the
 * traffic is observed at:
 *
 * | Route | Handover | | | |
 * | --- | --- | --- | --- | --- |
 * | IGBAN 2A | 15,000 / 260 | MB392 10,000 | EMROS 7000 | OLGUS 6000 |
 * | POKON 2A | 17,000 / 280 | MB379 12,000 | EMROS 9000 | OLGUS 8000 |
 * | EMRAK 2A | 12,000 / 250 | | | OLGUS 7000 |
 * | KETOR 2A | 15,000 / 260 | MB393 11,000 | LIKTA 9000 | MB395 7000 |
 * | MOLGO 2A | 14,000 / 260 | DUGED 10,000 | LIKTA 7000 | MB395 5500 |
 *
 * At the shared fixes every gap is at or above `SEP_VERT_FT`, and the order of the
 * two northern flows and the two southern ones never swaps between the pair of
 * fixes they share. The three-way split at OLGUS is exactly 1000 ft between
 * neighbours, which is the tightest thing on either field. OLGUS and MB395 are each
 * route's *last* fix, where `checkStarSeparation` stops requiring a vertical split
 * because the queue onto the ILS is the player's from there — the split is kept
 * anyway so an untouched arrival is still separated.
 *
 * **EMRAK 2A is the one that cannot be raised.** It is 25 NM from the boundary to
 * OLGUS, its only fix, so 12,000 is already 197 ft/NM — the steepest gradient on the
 * field. The other four enter 2000–5000 ft higher because they have 30 to 44 miles
 * of first leg to lose it in. Nothing in the model would stop a steeper profile
 * being authored: a STAR writes its altitude straight onto the aircraft (§4.5), so
 * it would simply be flown, at whatever rate the geometry implies.
 *
 * Two consequences outside this file. The 17,000 handover at POKON is what sets
 * `CEILING_FT`, since the controller has to be able to hold an arrival at the level
 * it arrives on. And POKON 2A descending to 9000 at EMROS is 2000 ft lower over
 * ANOLI 2A's northbound trunk than the coded FL110 was, which is why `sids.ts` holds
 * ANOLI at 9000 rather than its published 10,000.
 */
import type { StarSpec } from '../../types.js';
import { VABB_FIXES as F } from './fixes.js';

export const VABB_STARS: readonly StarSpec[] = [
  {
    // IGBAN 2A: the northern stream. AKTIV feeds it from 73 NM out, outside the
    // airspace, so IGBAN itself is the gate.
    name: 'IGBAN2A',
    gate: 'IGBAN',
    entryAltitudeFt: 15_000,
    entrySpeedKts: 260,
    fixes: [
      { name: 'MB392', at: F.MB392, altitudeFt: 10_000, speedKts: 230 },
      { name: 'EMROS', at: F.EMROS, altitudeFt: 7000, speedKts: 220 },
      { name: 'OLGUS', at: F.OLGUS, altitudeFt: 6000, speedKts: 210 },
    ],
  },
  {
    // POKON 2A joins the northern stream at EMROS, 2000 ft above IGBAN 2A and
    // staying above it all the way to OLGUS.
    name: 'POKON2A',
    gate: 'POKON',
    entryAltitudeFt: 17_000,
    entrySpeedKts: 280,
    fixes: [
      { name: 'MB379', at: F.MB379, altitudeFt: 12_000, speedKts: 250 },
      { name: 'EMROS', at: F.EMROS, altitudeFt: 9000, speedKts: 220 },
      { name: 'OLGUS', at: F.OLGUS, altitudeFt: 8000, speedKts: 210 },
    ],
  },
  {
    // EMRAK 2A is the shortest route in and joins only at OLGUS, slotted between
    // the other two: 1000 ft above IGBAN 2A and 1000 below POKON 2A.
    name: 'EMRAK2A',
    gate: 'EMRAK',
    entryAltitudeFt: 12_000,
    entrySpeedKts: 250,
    fixes: [{ name: 'OLGUS', at: F.OLGUS, altitudeFt: 7000, speedKts: 220 }],
  },
  {
    // KETOR 2A: the southern stream, round the south of the field.
    name: 'KETOR2A',
    gate: 'KETOR',
    entryAltitudeFt: 15_000,
    entrySpeedKts: 260,
    fixes: [
      { name: 'MB393', at: F.MB393, altitudeFt: 11_000, speedKts: 250 },
      { name: 'LIKTA', at: F.LIKTA, altitudeFt: 9000, speedKts: 220 },
      { name: 'MB395', at: F.MB395, altitudeFt: 7000, speedKts: 210 },
    ],
  },
  {
    // MOLGO 2A joins the southern stream at LIKTA, 2000 ft below KETOR 2A and
    // 1500 below it at MB395.
    name: 'MOLGO2A',
    gate: 'MOLGO',
    entryAltitudeFt: 14_000,
    entrySpeedKts: 260,
    fixes: [
      { name: 'DUGED', at: F.DUGED, altitudeFt: 10_000, speedKts: 230 },
      { name: 'LIKTA', at: F.LIKTA, altitudeFt: 7000, speedKts: 220 },
      { name: 'MB395', at: F.MB395, altitudeFt: 5500, speedKts: 220 },
    ],
  },
];
