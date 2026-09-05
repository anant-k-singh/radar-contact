/**
 * LSGG's standard arrivals — the nine RWY 22 STARs, as published.
 *
 * Source: STAR charts 01, 03 and 05, cited in `airport.ts`. The fix sequences,
 * tracks and distances are the charts'; the coordinates are `fixes.ts`. The
 * **levels are what Geneva actually flies**, not what the charts print — see
 * below, because here that distinction is forced rather than chosen.
 *
 * ## Three streams onto one final
 *
 * Runway 22 lands south-west, so every arrival finishes north-east of the field,
 * and the published design brings them in as three streams. Only one of them ends
 * at SAPRE; **the two downwind streams stop at the base turn and wait to be
 * vectored**, which is the point below:
 *
 * - **North and west → LIRKO.** AKITO 3R from the north, DJL 2R from Dijon and
 *   LUSAR 2R from the west all merge at LIRKO, run down to SOVAD, and fly the
 *   **right** downwind out to GG514, where the route ends.
 * - **South and east → GOLEB or BIVLO.** BANKO 3R and KINES 2R merge at GOLEB;
 *   BELUS 3R comes up from Chambéry and joins at BIVLO. All three fly the **left**
 *   downwind out to GG512, where the route ends.
 * - **North-east → straight in.** BENOT 2T, ULMES 2R and FRIBU 1R run down the
 *   extended centreline through VADAR or VEROX with no downwind at all.
 *
 * The two downwinds are **exactly 6 NM either side of the final approach course**
 * and dead parallel to it — see `fixes.ts`, where that turns out to be a fact about
 * the published coordinates rather than a design of ours.
 *
 * **The six downwind routes end at the base turn, not at SAPRE.** Both base turns
 * are charted "allowed with ATC clearance only", which is the same statement as
 * VABB's closing `VM` vector: the route is published up to the turn and the
 * sequencing is the controller's. Coding them through to SAPRE turned themselves
 * onto final, which is the one part of the job the field is meant to hand over.
 * Only the three north-east routes run to SAPRE, because those have no downwind
 * and no base turn — they are straight-in, and the IAF is where they genuinely
 * end.
 *
 * Ending there is also what exposed **GG512's 8000**. The two downwinds are
 * symmetric — GG514 is 18.6 NM out and GG512 18.7 — so 8000 against GG514's 7000
 * was an asymmetry nothing had to answer for while SAPRE followed and brought both
 * to 7000. A route that *ends* at GG512 has to be handed over somewhere the
 * approach can be given, and 8000 there is **628 ft above the glideslope**. Both
 * base turns now leave at 7000, which is the level the northern stream already
 * used and the one SAPRE would have imposed a mile later.
 *
 * ## The trunks are shared for forty miles, and that is the field
 *
 * VABB's routes touch at a fix and cross at different levels. LSGG's do something
 * else: AKITO 3R, DJL 2R and LUSAR 2R are **coincident for 40.4 NM**, and BANKO 3R
 * and KINES 2R for 38.7 — same fixes, same levels, one behind the other. There is
 * no vertical split to be had, because there is no lateral separation to
 * deconflict; they are one stream in trail.
 *
 * So what keeps them apart is not the published profile but the **delivery
 * interval**: Center offers a merge group at the rate it would offer a single
 * route, so two arrivals into one trunk are always spaced when they reach it. That
 * is a property of the traffic generator rather than of this file — see
 * `Scenario.mergeGroups` and `traffic.ts` — and it is why `checkStarSeparation`
 * exempts a coincident trunk the way it already exempts a shared last fix.
 *
 * ## Why the levels are observed rather than published
 *
 * Every altitude these charts print is an **"at or above"** — a bar under the
 * number, and only PITOM carries a window (FL150 over 7000). They are a staircase
 * of floors, not a descent profile, and they cannot be flown as one: SUVEL FL110 to
 * BIVLO 7000 is 4.9 NM, which is 821 ft/NM, about 3400 fpm. A STAR writes its
 * altitude straight onto the aircraft (§4.5), so authoring the floors would author
 * that dive.
 *
 * The levels below are therefore the ones the traffic is observed at, as at VABB.
 * Six are read off the live picture — LIRKO 13,000, SOVAD 10,000, GOLEB 16,000,
 * BIVLO 11,000, ESEVA 12,000, VADAR 10,000 — and the rest are interpolated between
 * them on distance to go and rounded to 500 ft. Every one clears its published
 * floor, and nothing descends steeper than 357 ft/NM.
 *
 * The observations are self-checking in a way that is worth recording: **GOLEB
 * 16,000 to BIVLO 11,000 is 321 ft/NM** over 15.6 NM, a continuous 3° descent, and
 * it happens to clear VALBU's 14,000 floor by 800 ft and SUVEL's 11,000 by 1500.
 * Two independently observed levels landing on a textbook gradient that threads two
 * published floors is not what a guess does. That gradient is also why **VALBU
 * itself is no longer on the routes**: it sits 0.01 NM off the direct GOLEB–SUVEL
 * line and turns the track by 0.2°, so it was a level on a straight leg the
 * gradient already covers, and dropping it changes the flown path by nothing.
 *
 * ## The entry levels, and the ceiling
 *
 * A route's length decides what it can be given, as at VABB. The three north-east
 * routes have only 35 NM from the boundary to SAPRE and enter at 12,000–13,000; the
 * other six have 63 to 85 and enter at 19,000–20,000. **LUSAR is the one with a
 * published entry level**, FL200, and it sits *inside* the boundary at 46 NM — so
 * the controller has to be able to hold an arrival at 20,000, which is what sets
 * `CEILING_FT`.
 *
 * No holding fix of ours is needed anywhere. Unlike VABB, whose northern routes ran
 * 44 NM from the boundary with nothing named in between, the longest gap here is
 * FRIBU 1R's 19 NM to VADAR — and VADAR is itself a published holding fix.
 */
import { final } from '../../geometry.js';
import type { StarSpec } from '../../types.js';
import { LSGG_DERIVED as D, LSGG_FIXES as F } from './fixes.js';

/**
 * SAPRE, where the three north-east routes end — and the one fix in this field
 * with no coordinate in any source. The six downwind routes stop at their base
 * turn instead and are vectored in from there.
 *
 * Authored in the runway frame because that is what it turned out to be. It is
 * over-determined four ways by the charts: 6 NM from GG512 on 313°, 6 NM from
 * GG514 on 133°, 17 NM from VADAR on 225° and 16.4 NM from VEROX on 196°. Those
 * four agree to within 0.4 NM, and their consensus lands on the extended
 * centreline — bearing 45.5° against the course reciprocal of 45.6°, and abeam
 * both GG512 and GG514 to a tenth of a mile.
 *
 * 18.7 NM off the threshold at 7000 puts it just outside the 3° glideslope, which
 * reaches 7000 at 17.6 NM. So an arrival levels at the platform and the glideslope
 * comes down to meet it 2 NM later — which is what an IAF is for.
 */
const SAPRE = final(18.7, 0);

/**
 * The platform speed at SAPRE, and the downwind's.
 *
 * The charts publish 220 at the base turn, which is what GG514 and GG512 carried.
 * Both streams are slowed to 210 from GG507/GG525 instead — one deceleration on
 * the downwind rather than one there and another on the base — so the speed is
 * monotonic from the gate to wherever the route ends. A route that slows to 210
 * and then asks for 220 back is not a profile any chart codes, and it is what the
 * earlier pair of numbers produced once GG507 and GG525 came down.
 */
const SAPRE_SPEED = 210;

export const LSGG_STARS: readonly StarSpec[] = [
  // ── North-east: straight down the extended centreline ─────────────────────
  {
    // BENOT 2T. The 2R variant of this chart uses VADAR instead of VEROX; the
    // model allows one STAR per gate, and 2T is the one that keeps VEROX.
    name: 'BENOT2T',
    gate: 'BENOT',
    entryAltitudeFt: 12_000,
    entrySpeedKts: 250,
    fixes: [
      { name: 'NEMOS', at: F.NEMOS, altitudeFt: 12_000, speedKts: 250 },
      { name: 'VEROX', at: F.VEROX, altitudeFt: 10_000, speedKts: 240 },
      { name: 'SAPRE', at: SAPRE, altitudeFt: 7000, speedKts: SAPRE_SPEED },
    ],
  },
  {
    name: 'ULMES2R',
    gate: 'ULMES',
    entryAltitudeFt: 13_000,
    entrySpeedKts: 250,
    fixes: [
      { name: 'ESEVA', at: F.ESEVA, altitudeFt: 12_000, speedKts: 250 },
      { name: 'VADAR', at: F.VADAR, altitudeFt: 10_000, speedKts: 240 },
      { name: 'SAPRE', at: SAPRE, altitudeFt: 7000, speedKts: SAPRE_SPEED },
    ],
  },
  {
    // FRIBU 1R joins ULMES 2R at VADAR, one level below it — the only place in
    // the north-east stream where two routes are laterally together and both
    // still descending.
    name: 'FRIBU1R',
    gate: 'FRIBU',
    entryAltitudeFt: 13_000,
    entrySpeedKts: 250,
    fixes: [
      { name: 'VADAR', at: F.VADAR, altitudeFt: 10_000, speedKts: 240 },
      { name: 'SAPRE', at: SAPRE, altitudeFt: 7000, speedKts: SAPRE_SPEED },
    ],
  },

  // ── North and west: merge at LIRKO, right downwind ────────────────────────
  {
    name: 'AKITO3R',
    gate: 'AKITO',
    entryAltitudeFt: 20_000,
    entrySpeedKts: 280,
    fixes: [
      { name: 'GG518', at: F.GG518, altitudeFt: 17_000, speedKts: 280 },
      { name: 'BOLGI', at: F.BOLGI, altitudeFt: 14_000, speedKts: 270 },
      { name: 'LIRKO', at: F.LIRKO, altitudeFt: 13_000, speedKts: 250 },
      { name: 'DINIG', at: F.DINIG, altitudeFt: 11_500, speedKts: 250 },
      { name: 'SOVAD', at: F.SOVAD, altitudeFt: 10_000, speedKts: 250 },
      { name: 'GG507', at: F.GG507, altitudeFt: 8500, speedKts: 210 },
      { name: 'GG514', at: F.GG514, altitudeFt: 7000, speedKts: 210 },
    ],
  },
  {
    name: 'DJL2R',
    gate: 'DJL',
    entryAltitudeFt: 20_000,
    entrySpeedKts: 280,
    fixes: [
      { name: 'GG517', at: F.GG517, altitudeFt: 19_000, speedKts: 280 },
      { name: 'LIRKO', at: F.LIRKO, altitudeFt: 13_000, speedKts: 250 },
      { name: 'DINIG', at: F.DINIG, altitudeFt: 11_500, speedKts: 250 },
      { name: 'SOVAD', at: F.SOVAD, altitudeFt: 10_000, speedKts: 250 },
      { name: 'GG507', at: F.GG507, altitudeFt: 8500, speedKts: 210 },
      { name: 'GG514', at: F.GG514, altitudeFt: 7000, speedKts: 210 },
    ],
  },
  {
    // LUSAR 2R is the one route whose entry level is published: FL200, at a fix
    // 46 NM out and so inside the boundary. LUSAR to SAUNI at 313 ft/NM is a 3°
    // descent, so on that stretch the published floors *are* the profile.
    name: 'LUSAR2R',
    gate: 'RCLU',
    entryAltitudeFt: 20_000,
    entrySpeedKts: 280,
    fixes: [
      // The published LUSAR, 46.4 NM out: the gate is on the boundary 8.6 NM
      // further up this leg (`extendToRange`), so the fix stays on the route.
      { name: 'LUSAR', at: F.LUSAR, altitudeFt: 20_000, speedKts: 280 },
      // 17,000, not the published floor of FL160. Every other level on this field
      // sits above its floor, and SAUNI on its own was the anomaly; 17,000 is also
      // what the descent from FL200 to LIRKO wants — 234 ft/NM in and 284 out,
      // against 313 and 213 for the floor.
      { name: 'SAUNI', at: F.SAUNI, altitudeFt: 17_000, speedKts: 270 },
      { name: 'LIRKO', at: F.LIRKO, altitudeFt: 13_000, speedKts: 250 },
      { name: 'DINIG', at: F.DINIG, altitudeFt: 11_500, speedKts: 250 },
      { name: 'SOVAD', at: F.SOVAD, altitudeFt: 10_000, speedKts: 250 },
      { name: 'GG507', at: F.GG507, altitudeFt: 8500, speedKts: 210 },
      { name: 'GG514', at: F.GG514, altitudeFt: 7000, speedKts: 210 },
    ],
  },

  // ── South and east: merge at GOLEB and BIVLO, left downwind ───────────────
  {
    name: 'BANKO3R',
    gate: 'RCBA',
    entryAltitudeFt: 19_000,
    entrySpeedKts: 280,
    fixes: [
      // The published BANKO, 46.6 NM out; the gate is 8.4 NM further up this leg.
      { name: 'BANKO', at: F.BANKO, altitudeFt: 19_000, speedKts: 280 },
      { name: 'GG520', at: F.GG520, altitudeFt: 18_000, speedKts: 280 },
      { name: 'GOLEB', at: F.GOLEB, altitudeFt: 16_000, speedKts: 270 },
      { name: 'SUVEL', at: F.SUVEL, altitudeFt: 12_500, speedKts: 250 },
      { name: 'BIVLO', at: F.BIVLO, altitudeFt: 11_000, speedKts: 250 },
      { name: 'GG525', at: F.GG525, altitudeFt: 9500, speedKts: 210 },
      { name: 'GG512', at: F.GG512, altitudeFt: 7000, speedKts: 210 },
    ],
  },
  {
    // KINES 2R comes up the Tarentaise and joins BANKO 3R at GOLEB, 38.7 NM from
    // the end — the longest shared trunk on the field.
    name: 'KINES2R',
    gate: 'KINES',
    entryAltitudeFt: 20_000,
    entrySpeedKts: 280,
    fixes: [
      { name: 'GG519', at: F.GG519, altitudeFt: 19_000, speedKts: 280 },
      { name: 'ROCCA', at: F.ROCCA, altitudeFt: 17_500, speedKts: 270 },
      { name: 'GOLEB', at: F.GOLEB, altitudeFt: 16_000, speedKts: 270 },
      { name: 'SUVEL', at: F.SUVEL, altitudeFt: 12_500, speedKts: 250 },
      { name: 'BIVLO', at: F.BIVLO, altitudeFt: 11_000, speedKts: 250 },
      { name: 'GG525', at: F.GG525, altitudeFt: 9500, speedKts: 210 },
      { name: 'GG512', at: F.GG512, altitudeFt: 7000, speedKts: 210 },
    ],
  },
  {
    // BELUS 3R runs up the Rhône through Chambéry and joins the other two at
    // BIVLO. PITOM is the field's only published window, FL150 over 7000.
    name: 'BELUS3R',
    gate: 'RCBE',
    entryAltitudeFt: 19_000,
    entrySpeedKts: 280,
    fixes: [
      // The published BELUS, 40.0 NM out; the gate is 15 NM further up this leg,
      // which is the longest of the three extensions.
      { name: 'BELUS', at: F.BELUS, altitudeFt: 19_000, speedKts: 280 },
      { name: 'RILTI', at: D.RILTI, altitudeFt: 18_000, speedKts: 280 },
      { name: 'CBY', at: F.CBY, altitudeFt: 16_000, speedKts: 270 },
      { name: 'GG502', at: F.GG502, altitudeFt: 14_000, speedKts: 250 },
      { name: 'PITOM', at: F.PITOM, altitudeFt: 12_000, speedKts: 250 },
      { name: 'BIVLO', at: F.BIVLO, altitudeFt: 11_000, speedKts: 250 },
      { name: 'GG525', at: F.GG525, altitudeFt: 9500, speedKts: 210 },
      { name: 'GG512', at: F.GG512, altitudeFt: 7000, speedKts: 210 },
    ],
  },
];
