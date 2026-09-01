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
 * ## The RC fixes are invented, and say so
 *
 * `RCPO`, `RCKE` and `RCEM` are **not published**. Those three routes run 42 to
 * 44 NM from the boundary to their first published fix — EMRAK 2A has only one,
 * 25 NM in — with nothing named in between, so there is nowhere to send an
 * arrival that has to wait: a hold needs a fix, and Mumbai's coding leaves the
 * delay to the enroute sectors outside this airspace. So each of the three gets
 * one, 20 NM inside the boundary on its first leg (EMRAK 2A's at 15, since its
 * whole route is 25), and the track is untouched, because the fix is on the line
 * between two published points. IGBAN 2A and MOLGO 2A need none: MB392 and DUGED
 * are 30 NM in, close enough to the boundary to be the fix a delayed arrival is
 * held at, and a fix of ours beside a published one is furniture on the chart
 * and another name in the log for nothing.
 *
 * The `RC` prefix is not an ICAO five-letter name and is not meant to be — it
 * marks the fix as this simulator's, so nothing here can be mistaken for the
 * chart. Each crossing level is the profile's own interpolated value at that
 * point rounded **up** to the next 1000 ft, so the fix is a level a controller
 * can hold at and the route still descends monotonically through it. The speed
 * is the same interpolation to the nearest 10 kts — a STAR fix has to publish
 * both, and taking it off the profile is what keeps the fix invisible to an
 * arrival that is not held there. RCEM is the exception on both counts: 10,000
 * is 500 ft above the interpolation, held there so the fix sits on a round level
 * rather than a hundred feet under the profile of the steepest route in.
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
 * | IGBAN 2A | 15,000 / 260 | MB392 10,000 | EMROS 6000 | OLGUS 5000 |
 * | POKON 2A | 17,000 / 280 | MB379 12,000 | EMROS 8000 | OLGUS 7000 |
 * | EMRAK 2A | 12,000 / 250 | | | OLGUS 6000 |
 * | KETOR 2A | 15,000 / 260 | MB393 11,000 | LIKTA 8000 | MB395 6000 |
 * | MOLGO 2A | 14,000 / 260 | DUGED 10,000 | LIKTA 6000 | MB395 5000 |
 *
 * At the shared fixes every gap is at or above `SEP_VERT_FT`, and the order of the
 * two northern flows and the two southern ones never swaps between the pair of
 * fixes they share. The three-way split at OLGUS is exactly 1000 ft between
 * neighbours, and so is the two-way one at MB395 — the tightest thing on either
 * field. OLGUS and MB395 are each
 * route's *last* fix, where `checkStarSeparation` stops requiring a vertical split
 * because the queue onto the ILS is the player's from there — the split is kept
 * anyway so an untouched arrival is still separated.
 *
 * **EMRAK 2A is the one that cannot be raised.** It is 25 NM from the boundary to
 * OLGUS, its only published fix, so 12,000 down to 6000 is 236 ft/NM — the steepest
 * gradient on the field. The other four enter 2000–5000 ft higher because they have 30 to 44 miles
 * of first leg to lose it in. Nothing in the model would stop a steeper profile
 * being authored: a STAR writes its altitude straight onto the aircraft (§4.5), so
 * it would simply be flown, at whatever rate the geometry implies.
 *
 * Two consequences outside this file. The 17,000 handover at POKON is what sets
 * `CEILING_FT`, since the controller has to be able to hold an arrival at the level
 * it arrives on. And POKON 2A descending to 8000 at EMROS is 3000 ft lower over
 * ANOLI 2A's northbound trunk than the coded FL110 was, which is why `sids.ts` holds
 * ANOLI at 9000 rather than its published 10,000.
 */
import { alongLeg, entryGate } from '../../geometry.js';
import type { StarSpec } from '../../types.js';
import { VABB_FIXES as F } from './fixes.js';

/**
 * How far inside the boundary a holding fix sits.
 *
 * Every gate is on the 60 NM boundary, so this is a range as well as a distance
 * along the leg: RCPO and RCKE are 40 NM from the field. Far enough in that a
 * hold there is inside the airspace with room to turn, far enough out that the
 * aircraft has not yet reached the merge it is being held for.
 */
const HOLDING_FIX_INSET_NM = 20;

/**
 * EMRAK 2A's, which is 5 NM closer in.
 *
 * Its whole route is 25 NM, so the standard inset would leave a fix with 5 NM to
 * lose the last of the descent into OLGUS. Fifteen leaves ten, which is what the
 * held aircraft has to rejoin into.
 */
const EMRAK_HOLDING_INSET_NM = 15;

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
      { name: 'EMROS', at: F.EMROS, altitudeFt: 6000, speedKts: 220 },
      { name: 'OLGUS', at: F.OLGUS, altitudeFt: 5000, speedKts: 210 },
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
      {
        name: 'RCPO',
        at: alongLeg(HOLDING_FIX_INSET_NM, entryGate, F.MB379),
        altitudeFt: 15_000,
        speedKts: 270,
      },
      { name: 'MB379', at: F.MB379, altitudeFt: 12_000, speedKts: 250 },
      { name: 'EMROS', at: F.EMROS, altitudeFt: 8000, speedKts: 220 },
      { name: 'OLGUS', at: F.OLGUS, altitudeFt: 7000, speedKts: 210 },
    ],
  },
  {
    // EMRAK 2A is the shortest route in and joins only at OLGUS, slotted between
    // the other two: 1000 ft above IGBAN 2A and 1000 below POKON 2A.
    name: 'EMRAK2A',
    gate: 'EMRAK',
    entryAltitudeFt: 12_000,
    entrySpeedKts: 250,
    fixes: [
      {
        name: 'RCEM',
        at: alongLeg(EMRAK_HOLDING_INSET_NM, entryGate, F.OLGUS),
        altitudeFt: 10_000,
        speedKts: 230,
      },
      { name: 'OLGUS', at: F.OLGUS, altitudeFt: 6000, speedKts: 220 },
    ],
  },
  {
    // KETOR 2A: the southern stream, round the south of the field.
    name: 'KETOR2A',
    gate: 'KETOR',
    entryAltitudeFt: 15_000,
    entrySpeedKts: 260,
    fixes: [
      {
        name: 'RCKE',
        at: alongLeg(HOLDING_FIX_INSET_NM, entryGate, F.MB393),
        altitudeFt: 14_000,
        speedKts: 260,
      },
      { name: 'MB393', at: F.MB393, altitudeFt: 11_000, speedKts: 250 },
      { name: 'LIKTA', at: F.LIKTA, altitudeFt: 8000, speedKts: 220 },
      { name: 'MB395', at: F.MB395, altitudeFt: 6000, speedKts: 210 },
    ],
  },
  {
    // MOLGO 2A joins the southern stream at LIKTA, 2000 ft below KETOR 2A and
    // 1000 below it at MB395.
    name: 'MOLGO2A',
    gate: 'MOLGO',
    entryAltitudeFt: 14_000,
    entrySpeedKts: 260,
    fixes: [
      { name: 'DUGED', at: F.DUGED, altitudeFt: 10_000, speedKts: 230 },
      { name: 'LIKTA', at: F.LIKTA, altitudeFt: 6000, speedKts: 220 },
      { name: 'MB395', at: F.MB395, altitudeFt: 5000, speedKts: 220 },
    ],
  },
];
