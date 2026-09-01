/**
 * VABB's standard arrivals — the five RWY 27 STARs, as published.
 *
 * Source: AIP Supplement 84/2020, §6.1–6.5 (cited in `airport.ts`). The fix
 * sequences, the tracks and the published speeds are the supplement's tabular
 * coding; the coordinates are its own table, via `fixes.ts`.
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
 * there is that **the chart gives them different levels**. IGBAN 2A crosses EMROS
 * at FL80 and POKON 2A at FL110: 3000 ft apart, published, on the same fix. That
 * is how a real merge is deconflicted, and it is why this field needs no special
 * handling in the traffic generator.
 *
 * Where the chart publishes *no* altitude the level is chosen here, and chosen to
 * carry that separation through — the three flows arrive at OLGUS 1500 ft apart
 * and the two southern ones at MB395 3000 ft apart. Each such choice is marked
 * `designed` below. The speeds are all the chart's.
 */
import type { StarSpec } from '../../types.js';
import { ENTRY_FT, ENTRY_KTS } from './airport.js';
import { VABB_FIXES as F } from './fixes.js';

export const VABB_STARS: readonly StarSpec[] = [
  {
    // IGBAN 2A: the northern stream. AKTIV feeds it from 73 NM out, outside the
    // airspace, so IGBAN itself is the gate.
    name: 'IGBAN2A',
    gate: 'IGBAN',
    entryAltitudeFt: ENTRY_FT,
    entrySpeedKts: ENTRY_KTS,
    fixes: [
      { name: 'MB392', at: F.MB392, altitudeFt: 10_000, speedKts: 230 },
      { name: 'EMROS', at: F.EMROS, altitudeFt: 8000, speedKts: 220 },
      { name: 'OLGUS', at: F.OLGUS, altitudeFt: 6000, speedKts: 210 },
    ],
  },
  {
    // POKON 2A joins the northern stream at EMROS, 3000 ft above IGBAN 2A the
    // whole way in — the chart's own FL110 against FL80.
    name: 'POKON2A',
    gate: 'POKON',
    entryAltitudeFt: ENTRY_FT,
    entrySpeedKts: ENTRY_KTS,
    fixes: [
      { name: 'MB379', at: F.MB379, altitudeFt: 12_000, speedKts: 230 },
      { name: 'EMROS', at: F.EMROS, altitudeFt: 11_000, speedKts: 230 },
      { name: 'OLGUS', at: F.OLGUS, altitudeFt: 9000, speedKts: 210 },
    ],
  },
  {
    // EMRAK 2A is the shortest route in and joins only at OLGUS, between the other
    // two: 1500 ft above IGBAN 2A and 1500 below POKON 2A. designed — the chart
    // publishes no altitude at OLGUS on any of the three.
    name: 'EMRAK2A',
    gate: 'EMRAK',
    entryAltitudeFt: ENTRY_FT,
    entrySpeedKts: ENTRY_KTS,
    fixes: [{ name: 'OLGUS', at: F.OLGUS, altitudeFt: 7500, speedKts: 230 }],
  },
  {
    // KETOR 2A: the southern stream, round the south of the field.
    name: 'KETOR2A',
    gate: 'KETOR',
    entryAltitudeFt: ENTRY_FT,
    entrySpeedKts: ENTRY_KTS,
    fixes: [
      { name: 'MB393', at: F.MB393, altitudeFt: 11_000, speedKts: 230 },
      { name: 'LIKTA', at: F.LIKTA, altitudeFt: 10_000, speedKts: 230 },
      { name: 'MB395', at: F.MB395, altitudeFt: 8000, speedKts: 210 },
    ],
  },
  {
    // MOLGO 2A joins the southern stream at LIKTA, 3000 ft below KETOR 2A —
    // designed, mirroring the split the chart makes on the northern pair. The
    // chart's own @FL90 at DUGED is what sets the level it arrives on.
    name: 'MOLGO2A',
    gate: 'MOLGO',
    entryAltitudeFt: ENTRY_FT,
    entrySpeedKts: ENTRY_KTS,
    fixes: [
      { name: 'DUGED', at: F.DUGED, altitudeFt: 9000, speedKts: 230 },
      { name: 'LIKTA', at: F.LIKTA, altitudeFt: 7000, speedKts: 230 },
      { name: 'MB395', at: F.MB395, altitudeFt: 5000, speedKts: 210 },
    ],
  },
];
