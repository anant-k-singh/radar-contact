/**
 * VABB's standard arrivals — one STAR from each of the five entry gates.
 *
 * Charts: `docs/charts/vabb/NW,N,NE stars.png` (EMRAK 2A, IGBAN 2A, POKON 2A) and
 * `SW,S stars.png` (KETOR 2A, MOLGO 2A), both RWY 27.
 *
 * ## What is the chart's, and what is not
 *
 * The **gates, the chart names, the handover crossing and which sector each route
 * serves are the chart's.** All five publish "AT OR ABOVE FL120 AT 250KT" at their
 * convergence fix, and that fix is the gate.
 *
 * The **terminal 25 NM is designed, not transcribed**, and one decision drives all
 * of it: the published routes *merge*. IGBAN 2A, POKON 2A and EMRAK 2A all reach
 * OLGUS; KETOR 2A and MOLGO 2A both reach MB395. Two arrivals reaching a merge fix
 * together are co-altitude, because a STAR writes the altitude straight onto the
 * aircraft (§4.5) — so authoring the merges literally would hand the player pairs
 * that cannot be separated, and would need Center to know about merge fixes before
 * it offered anything. Splitting them is the simpler field and the solvable one.
 *
 * So each route keeps its own terminal fixes. Where a chart name was not already
 * spoken for it is used — EMROS and OLGUS on IGBAN 2A, DUGED, LIKTA and MB395 on
 * MOLGO 2A, MB379 and MB393 as the reporting points they are. The rest are minted
 * in AAI's own register for an unnamed procedure point, MB3xx, and are marked
 * below.
 *
 * ## The three shapes
 *
 * Runway 27 lands westbound, so every route has to finish **east** of the field,
 * and which shape a gate gets follows from which side of the field it is on.
 *
 * - **IGBAN (north) and MOLGO (south-southeast)** are already on the approach side.
 *   They run straight in to a corner well abeam, then turn across the approach on a
 *   leg descending 7000 → 3000 that stops 2 NM short of the extended centreline.
 *   The two end pointing at each other 4 NM apart, which is the sequencing problem.
 * - **POKON (west-northwest) and KETOR (west-southwest)** are on the *departure*
 *   side, so they have to come round the field — north-about and south-about, which
 *   is what the real POKON→EMROS and KETOR→LIKTA legs do too. Each joins a downwind
 *   7 NM abeam where its own straight-in track reaches the offset, then runs east
 *   along it. Turn base when the gap in the sequence is there.
 * - **EMRAK (east-northeast)** arrives already lined up and gets the straight-in:
 *   a long descent to a platform 25 NM out and 3 NM north of the centreline.
 *
 * Every crossing here stands on its own — nothing is shared between routes or
 * derived from a common constant, so one fix can be retuned without dragging the
 * others.
 */
import { final, joinsDownwind } from '../../geometry.js';
import type { StarSpec } from '../../types.js';
import { ENTRY_FT, ENTRY_KTS } from './airport.js';

/**
 * Where the two approach-side routes turn across the final, in NM from the
 * threshold. The glideslope is 5453 ft here, so a platform at 3000 sits well under
 * it and the localizer is intercepted from below.
 */
const CORNER_ALONG_NM = 17;
/** How far out to the side those routes turn inbound. */
const CORNER_ABEAM_NM = 20;
/** How close to the extended centreline they stop. */
const MERGE_ABEAM_NM = 2;
/** Offset of the two downwind legs either side of the final approach course. */
const DOWNWIND_NM = 7;
/**
 * Where the downwinds end, in NM from the threshold. The 3° path is at 3861 ft
 * here, so 3000 is under it with room, and it is 5 NM clear of the approach-side
 * platforms.
 */
const DOWNWIND_END_NM = 12;

export const VABB_STARS: readonly StarSpec[] = [
  {
    name: 'IGBAN2A',
    gate: 'IGBAN',
    entryAltitudeFt: ENTRY_FT,
    entrySpeedKts: ENTRY_KTS,
    fixes: [
      { name: 'MB392', fraction: 0.5, altitudeFt: 9000, speedKts: 250 },
      { name: 'EMROS', at: final(CORNER_ALONG_NM, CORNER_ABEAM_NM), altitudeFt: 7000, speedKts: 230 },
      { name: 'OLGUS', at: final(CORNER_ALONG_NM, MERGE_ABEAM_NM), altitudeFt: 3000, speedKts: 200 },
    ],
  },
  {
    name: 'MOLGO2A',
    gate: 'MOLGO',
    entryAltitudeFt: ENTRY_FT,
    entrySpeedKts: ENTRY_KTS,
    fixes: [
      { name: 'DUGED', fraction: 0.5, altitudeFt: 9000, speedKts: 250 },
      { name: 'LIKTA', at: final(CORNER_ALONG_NM, -CORNER_ABEAM_NM), altitudeFt: 7000, speedKts: 230 },
      { name: 'MB395', at: final(CORNER_ALONG_NM, -MERGE_ABEAM_NM), altitudeFt: 3000, speedKts: 200 },
    ],
  },
  {
    name: 'POKON2A',
    gate: 'POKON',
    entryAltitudeFt: ENTRY_FT,
    entrySpeedKts: ENTRY_KTS,
    fixes: [
      { name: 'MB379', fraction: 0.5, altitudeFt: 10_000, speedKts: 250 },
      // MB377/MB378 are minted: the chart's own names here are EMROS and OLGUS,
      // which IGBAN 2A has, because the published routes merge and these do not.
      { name: 'MB377', at: joinsDownwind(DOWNWIND_NM), altitudeFt: 7000, speedKts: 230 },
      { name: 'MB378', at: final(DOWNWIND_END_NM, DOWNWIND_NM), altitudeFt: 3000, speedKts: 210 },
    ],
  },
  {
    name: 'KETOR2A',
    gate: 'KETOR',
    entryAltitudeFt: ENTRY_FT,
    entrySpeedKts: ENTRY_KTS,
    fixes: [
      { name: 'MB393', fraction: 0.5, altitudeFt: 10_000, speedKts: 250 },
      // MB371/MB372 are minted, for the same reason: MOLGO 2A has LIKTA and MB395.
      { name: 'MB371', at: joinsDownwind(-DOWNWIND_NM), altitudeFt: 7000, speedKts: 230 },
      { name: 'MB372', at: final(DOWNWIND_END_NM, -DOWNWIND_NM), altitudeFt: 3000, speedKts: 210 },
    ],
  },
  {
    name: 'EMRAK2A',
    gate: 'EMRAK',
    entryAltitudeFt: ENTRY_FT,
    entrySpeedKts: ENTRY_KTS,
    fixes: [
      // Two reporting points rather than one: this is the longest single run in
      // from a gate, and the descent reads better with a step in the middle of it.
      // Both are minted — the chart's only fix between EMRAK and the field is
      // OLGUS, which IGBAN 2A has.
      { name: 'MB386', fraction: 0.35, altitudeFt: 9000, speedKts: 250 },
      { name: 'MB387', fraction: 0.7, altitudeFt: 6000, speedKts: 230 },
      { name: 'MB388', at: final(25, 3), altitudeFt: 4000, speedKts: 210 },
    ],
  },
];
