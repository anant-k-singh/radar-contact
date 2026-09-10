/**
 * The southern sector's arrival routes: the published enroute transitions, flown
 * from the sector boundary down to the fix Approach is handed the aircraft at.
 *
 * Source: AIP Supplement 84/2020 §6.3 (KETOR 2A) and §6.4 (MOLGO 2A), whose
 * "Enroute Transition Data" tables give each way in as a fix sequence with a
 * track and a distance per leg. Two chart names, eight ways in — which is what
 * `StarSpec.entries` exists for, and it compiles to eight flat routes.
 *
 * ## Two funnels
 *
 * - **Six into KETOR.** BISET, DARMI, ERVIS, GUNDI and KABSO run direct; SUGID
 *   turns left at AROTA. They arrive on bearings from 174° to 273° — a 100° fan
 *   collapsing onto one fix.
 * - **Two into MOLGO.** EPKOS runs direct; AGELA joins at BEDOL.
 *
 * Everything then flies ten more miles down its RWY 27 runway transition to a
 * delivery fix on the handoff arc, and that is where the sector is graded.
 *
 * ## Why BEDOL is not a ninth gate
 *
 * The supplement publishes it as one — MOLGO 2A has AGELA, BEDOL and EPKOS
 * transitions. But BEDOL sits 99.9 NM out, inside this sector's 160 NM boundary,
 * and its leg to MOLGO is on the same 308° track AGELA already arrives down. Its
 * gate would have to be pushed back up that leg to the boundary, landing it
 * within a mile or two of AGELA's own — two gates, one bearing, one track, and a
 * second waypoint called BEDOL at a different place from the published one. It
 * adds no direction the fan does not already have, so the airway is flown as
 * AGELA and BEDOL stays what it is: a fix on it.
 *
 * ## The levels are observed, and the last two are a contract
 *
 * The supplement codes one restriction on every transition — "+FL120 @250" at
 * KETOR and at MOLGO — which is a floor rather than a profile and says nothing
 * about the 150 miles before it. So the entry levels here are cruise levels, and
 * they are **staggered on purpose**: six routes converging on one fix are
 * separated by the only thing that can separate them that far out, which is the
 * level each is cruising at. They descend continuously from there, which is what
 * `starProfileAt` interpolating between two constraints produces.
 *
 * The crossings at KETOR and MOLGO are not observed and not chosen. They are
 * **15,000 / 260 and 14,000 / 260 because that is what `fields/vabb/stars.ts`
 * hands its arrivals over at** — this field delivers what that one expects, and
 * the two must not disagree about the boundary they share. The delivery fixes
 * repeat them, so the last ten miles are flown level, which is what a handover
 * segment looks like.
 *
 * ## The RC fixes
 *
 * `RCKT` and `RCMG` are **not published**, and carry the prefix this simulator
 * uses to say so. Each is 10 NM along its gate's own published runway transition
 * — KETOR → MB393, MOLGO → DUGED — so the track is the chart's and only the fix
 * is ours. They exist because a sector has to be graded somewhere, and the place
 * to grade it is the handoff line rather than the last published fix before it.
 */
import { alongLeg } from '../../geometry.js';
import type { StarSpec } from '../../types.js';
import { VABB_SOUTH_FIXES as F } from './fixes.js';

/**
 * How far down the runway transition the handoff sits — the ten miles that let
 * the sector hold at its own entry fixes. See `airport.ts`.
 */
const HANDOFF_INSET_NM = 10;

/** What `fields/vabb/stars.ts` hands KETOR 2A and MOLGO 2A over at. */
const KETOR_CROSSING = { altitudeFt: 15_000, speedKts: 260 } as const;
const MOLGO_CROSSING = { altitudeFt: 14_000, speedKts: 260 } as const;

export const VABB_SOUTH_STARS: readonly StarSpec[] = [
  {
    name: 'KETOR2A',
    fixes: [
      { name: 'KETOR', at: F.KETOR, ...KETOR_CROSSING },
      { name: 'RCKT', at: alongLeg(HANDOFF_INSET_NM, F.KETOR, F.MB393), ...KETOR_CROSSING },
    ],
    // FL280 to FL370, **in order of how far each has to run**. That ordering is
    // the field's own rule — "a route's own length decides what it can be given"
    // — read the other way round: at an approach field a short route has to be
    // handed over *lower*, and out here a long one can be taken *higher*, which
    // is the same statement about the same gradient. Assigning by bearing
    // instead, which is what the first version did, gave KABSO the lowest level
    // over the longest run and left it descending at 90 ft/NM while DARMI, 33 NM
    // shorter, flew 161.
    //
    // Ordered this way every route flies 128 to 163 ft/NM — near enough one
    // profile — so the level a controller sees at the boundary reads directly as
    // how much room that aircraft has, rather than as an arbitrary number.
    entries: [
      { name: 'DARMI', gate: 'DARMI', entryAltitudeFt: 28_000, entrySpeedKts: 280, fixes: [] },
      { name: 'GUNDI', gate: 'GUNDI', entryAltitudeFt: 29_000, entrySpeedKts: 280, fixes: [] },
      { name: 'BISET', gate: 'BISET', entryAltitudeFt: 31_000, entrySpeedKts: 280, fixes: [] },
      { name: 'ERVIS', gate: 'ERVIS', entryAltitudeFt: 33_000, entrySpeedKts: 280, fixes: [] },
      {
        // The only two-leg transition into KETOR. AROTA is 10.8 NM inside the
        // boundary, so its level is barely off the cruise it entered on.
        name: 'SUGID',
        gate: 'SUGID',
        entryAltitudeFt: 35_000,
        entrySpeedKts: 280,
        fixes: [{ name: 'AROTA', at: F.AROTA, altitudeFt: 33_000, speedKts: 280 }],
      },
      // The longest way in — 145 NM — and therefore the highest.
      { name: 'KABSO', gate: 'KABSO', entryAltitudeFt: 37_000, entrySpeedKts: 280, fixes: [] },
    ],
  },
  {
    name: 'MOLGO2A',
    fixes: [
      { name: 'MOLGO', at: F.MOLGO, ...MOLGO_CROSSING },
      { name: 'RCMG', at: alongLeg(HANDOFF_INSET_NM, F.MOLGO, F.DUGED), ...MOLGO_CROSSING },
    ],
    // The same ordering, over a much smaller spread: these two are within 4 NM
    // of each other in length, so they are 2000 ft apart to keep them separated
    // where they converge rather than because one needs the extra room.
    entries: [
      { name: 'EPKOS', gate: 'EPKOS', entryAltitudeFt: 30_000, entrySpeedKts: 280, fixes: [] },
      {
        // AGELA joins at BEDOL, 61 NM in, and is 2000 ft above EPKOS all the way
        // down to the fix they share.
        name: 'AGELA',
        gate: 'AGELA',
        entryAltitudeFt: 32_000,
        entrySpeedKts: 280,
        fixes: [{ name: 'BEDOL', at: F.BEDOL, altitudeFt: 21_000, speedKts: 270 }],
      },
    ],
  },
];
