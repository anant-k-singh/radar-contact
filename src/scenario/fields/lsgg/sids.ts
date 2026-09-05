/**
 * LSGG's standard departures — five of the published RWY 22 SIDs.
 *
 * Source: the RNAV 1 SID sheets cited in `airport.ts`. Every one of them opens the
 * same way, which is the field's defining departure fact: **runway heading 223° to
 * PAS, then turn when passing 7000 but not before PAS.** Passeiry is a VOR-DME
 * 6.4 NM off the departure end, out over the Rhône valley, and it exists so that
 * everything leaving Geneva climbs clear of the terrain on runway track before it
 * turns back across the basin.
 *
 * One `SidSpec` per chart rather than one trunk with several exits, because each is
 * its own published sheet with its own name and number. `SidSpec.exits` exists so
 * that one chart's fan compiles to one route per branch; here there are five charts,
 * and the shared PAS leg is a coincidence of geography rather than a shared
 * identity.
 *
 * **KONIL 1R is published and deliberately not flown here.** It leaves north-east
 * inside SOSAL, running parallel to the right downwind 3 NM off it before crossing
 * the base leg — and it is the one way out this model cannot make work, because the
 * separation it needs comes from the tactical control the real sector has and this
 * simulator does not give a departure. SOSAL 1L leaves in the same direction and
 * carries the traffic instead. It is also the rarest departure on the live picture,
 * so dropping it costs the field almost nothing.
 *
 * ## The turns are derived, and four of five agree with the chart's own word
 *
 * `compileSid` reads the turn off the geometry rather than taking it declared, so
 * it is a check on the transcription: BEVEN left, DIPIR right, MEDAM left and
 * SOSAL left are exactly what their charts say. **DEPUL comes out
 * `straight`** where its chart says "turn right on track 233°" — and that is the
 * derivation working, not failing. 233° against a 223° runway is ten degrees,
 * inside `STRAIGHT_OUT_DEG`, and a ten-degree divergence is what straight out looks
 * like on a scope.
 *
 * ## The levels are observed, for the same reason the arrivals' are
 *
 * Every altitude these sheets print is an **"at or above"** floor, and departures
 * off 22 are nowhere near them by the time they get there — TINAM's published FL100
 * sits 33 NM into the climb, where the traffic is at 18,000. Authoring the floors
 * would not merely understate the climb, it would break the field: at SOSAL's
 * crossing of the left downwind the published floor puts the departure at 9100
 * where arrivals are descending through 9900, a 232 ft conflict that does not exist
 * in the air.
 *
 * So `minAltitudeFt` carries the level the traffic is **observed** at, and each
 * fix's comment keeps the published floor beside it so the chart value is not lost.
 * Four points are read directly off the live picture — DIPIR at GG617 and KELUK,
 * and the dropped KONIL at GG603 and GLEND — and they calibrate a climb of about
 * 600 ft/NM to 15 NM and 450 beyond it, which is what places the rest. The fitted
 * curve reproduces the two outer observations to within 150 ft.
 *
 * With those levels every one of the eleven places a SID passes within
 * `SEP_HORIZ_NM` of a STAR clears by **at least 2000 ft**, and nine of the eleven
 * put the departure over the arrival — which is the shape of a field where the
 * departures climb out of a valley and the arrivals spend twenty miles on a
 * descending downwind.
 *
 * ## What the weights are for
 *
 * `rng.pick` over five SIDs would send an equal share out of each. The real split
 * runs from DIPIR's 29% to BEVEN's 7%, derived the same way the gate weights are —
 * every nonstop destination by monthly frequency, mapped onto the bearing it leaves
 * on. They no longer sum to 100 — KONIL's 7 left with it — and nothing requires
 * that they do, since `pickWeighted` normalises.
 */
import { clipToRange } from '../../geometry.js';
import type { SidFixSpec, SidSpec } from '../../types.js';
import { LSGG_DERIVED as D, LSGG_FIXES as F } from './fixes.js';

/**
 * The first fix on every SID, and the turn gate every chart states in words:
 * "when passing 7000, but not before PAS".
 */
const PAS: SidFixSpec = { name: 'PAS', at: F.PAS, minAltitudeFt: 7000, turnAtOrAboveFt: 7000 };

/**
 * How far out a route is allowed to end, so there is a leg left to leave on.
 *
 * Five of the six exits are 25 to 38 NM out and need no help. MEDAM 1A is the
 * exception and it runs a long way: VANAS is 53.8 NM out and MEDAM 67.8, both past
 * anywhere a departure can be handed over, so the route is truncated on the leg
 * that crosses this range. The published fixes stay in `fixes.ts`, and the leg is
 * still aimed at the real place.
 */
const EXIT_RANGE_NM = 50;

export const LSGG_SIDS: readonly SidSpec[] = [
  {
    // DIPIR 1A, chart 22-04. North-west over the Jura — the busiest way out, and
    // the one that carries London, Paris, Amsterdam and Brussels.
    name: 'DIPIR1A',
    weight: 29,
    fixes: [
      PAS,
      // No altitude is published on this sheet at all beyond the initial climb
      // clearance FL090; both of these are observed.
      { name: 'GG617', at: D.GG617, minAltitudeFt: 15_000 },
      { name: 'KELUK', at: F.KELUK, minAltitudeFt: 18_000 },
      { name: 'DIPIR', at: F.DIPIR, minAltitudeFt: 19_500 },
    ],
  },
  {
    // DEPUL, south-west down the Rhône. Spain, Portugal and the Maghreb.
    name: 'DEPUL1A',
    weight: 22,
    fixes: [
      PAS,
      { name: 'ARGIS', at: F.ARGIS, minAltitudeFt: 15_000 }, // published +FL130
      { name: 'DEPUL', at: F.DEPUL, minAltitudeFt: 17_500 }, // published +FL150
    ],
  },
  {
    // MEDAM 1A, chart 22-07. South-east into the Alps, climbing over ground whose
    // MSA reaches 12,000 — which is why its published floors are the field's
    // steepest, and the one SID where they are nearly what is flown.
    name: 'MEDAM1A',
    weight: 18,
    fixes: [
      PAS,
      { name: 'GG619', at: D.GG619, minAltitudeFt: 10_000 }, // published +FL100
      { name: 'GG616', at: D.GG616, minAltitudeFt: 13_000 }, // published +FL120
      { name: 'ESAPI', at: F.ESAPI, minAltitudeFt: 15_000 }, // published +FL140
      { name: 'ALPOZ', at: D.ALPOZ, minAltitudeFt: 18_000 }, // published +FL180
      // Truncated: VANAS is 53.8 NM out and MEDAM 67.8, so the route ends where
      // its own leg crosses EXIT_RANGE_NM.
      { name: 'VANAS', at: clipToRange(EXIT_RANGE_NM, D.ALPOZ, F.VANAS), minAltitudeFt: 21_000 },
    ],
  },
  {
    // SOSAL 1L, chart 22-09. North-east up the lake. Zurich, Vienna, Munich, and
    // the one that crosses the left downwind — 14,400 over arrivals at 9900.
    name: 'SOSAL1L',
    weight: 17,
    fixes: [
      PAS,
      // GG602 carries a charted MAX IAS 220 rather than an altitude.
      { name: 'GG602', at: F.GG602, minAltitudeFt: 7000 },
      { name: 'TINAM', at: F.TINAM, minAltitudeFt: 18_500 }, // published +FL100, 33 NM into the climb
      { name: 'MOLUS', at: F.MOLUS, minAltitudeFt: 21_000 },
      { name: 'SOSAL', at: F.SOSAL, minAltitudeFt: 21_000 },
    ],
  },
  {
    // BEVEN, due south. The one crossing where the departure passes *under* the
    // arrival: it goes beneath BELUS 3R's descent into PITOM by about 3000 ft.
    name: 'BEVEN1A',
    weight: 7,
    fixes: [
      PAS,
      { name: 'GG611', at: D.GG611, minAltitudeFt: 11_500 }, // published +FL100
      { name: 'RUMIL', at: F.RUMIL, minAltitudeFt: 14_000 }, // published +FL120
      { name: 'GG622', at: D.GG622, minAltitudeFt: 16_000 }, // published +FL150
      { name: 'BEVEN', at: F.BEVEN, minAltitudeFt: 19_000 },
    ],
  },
];
