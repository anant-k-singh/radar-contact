/**
 * The five arrival charts, as this sector flies them.
 *
 * Each is one published STAR reduced to what an en-route controller owns: the
 * TMA entry fix, the handoff ten miles past it, and one `entries` stub per
 * enroute transition feeding them. Everything inside the entry fix belongs to
 * `fields/vabb/stars.ts` and is not repeated here — this field stops where that
 * one starts, and they share the crossing.
 *
 * ## The crossings are Approach's, read off Approach
 *
 * `KETOR_CROSSING` and the four beside it are copied from `fields/vabb/stars.ts`
 * exactly: 17,000/280 at POKON down to 12,000/250 at EMRAK. A number the
 * boundary is shared on is read off the other field and never invented at this
 * one, and `tests/center.test.ts` pins that both ways round. The five differ
 * from each other because a route's length decides what it can be given — POKON
 * has 44 miles of first leg inside the TMA where EMRAK has 25.
 *
 * ## The entry levels, and the two that are observed
 *
 * Ordered by **how far each has to run**, which is VABB South's rule and comes
 * out at 138 to 170 ft/NM across all twelve — near enough one profile that the
 * level a controller sees at the boundary reads as how much room that aircraft
 * has. The southern nine are VABB South's, moved down for the ten miles the ring
 * lost. OPAKA is the steepest at 170 and that is EMRAK's 12,000 handover showing
 * through rather than a choice.
 *
 * AKTIV's and OPAKA's are **observed rather than derived**, the way VABB's and
 * LSGG's altitudes are, from live tracks on the two airways:
 *
 * | | at the ring | further in | handed over |
 * | --- | --- | --- | --- |
 * | AKTIV, over Bharuch | 28,925 | 20,025 at AKTIV (72.9 NM) | 15,000 |
 * | OPAKA, over Manmad | 30,875 | 26,675 at ~130 NM, 22,625 at ~110 | 12,000 |
 *
 * Both come out at 29,000, and both fly the gradient the real tracks fly.
 * EXOLU's and BOFIN's are over the sea to the north-west where there is nothing
 * to observe, so they are taken by the same ft/NM as the rest.
 */
import { alongLeg, entryGate, meetsRange } from '../../geometry.js';
import type { FixAt } from '../../geometry.js';
import type { Ft } from '../../../sim/units.js';
import type { StarSpec } from '../../types.js';
import { INNER_RANGE_NM } from './airport.js';
import { VABB_AREA_FIXES as F } from './fixes.js';

/**
 * Where the handoff sits: on the inner arc, which is the boundary itself.
 *
 * VABB South states this as ten miles down the runway transition, which agrees
 * with its boundary because KETOR is 60.0 NM out and the arc is at 50. Mumbai's
 * five TMA fixes are not on one arc, though — MOLGO is 63.2 — so a fixed inset
 * puts four handoffs on the boundary and MOLGO's 3.2 NM outside it, drawing that
 * route stopping short of the circle every other one reaches. Taking the
 * crossing instead makes the handoff line and the airspace edge the same thing,
 * and the inset falls out of it at 10.0 to 13.2 NM — still the run the ten miles
 * were for.
 */
const handoff = (from: FixAt, to: FixAt) => meetsRange(INNER_RANGE_NM, from, to);

/**
 * How far back from the merge fix each invented holding fix sits.
 *
 * VABB South's fifty miles, unchanged — measured from the merge rather than from
 * the gate, so every stream's last chance to hold is the same distance out
 * whatever its entry had to run. The shortest leg it has to fit on is
 * EPKOS → MOLGO at 86.9 NM.
 */
const HOLDING_FIX_INSET_NM = 50;

/** What `fields/vabb/stars.ts` hands each of the five gates over at. */
const POKON_CROSSING = { altitudeFt: 17_000, speedKts: 280 } as const;
const IGBAN_CROSSING = { altitudeFt: 15_000, speedKts: 260 } as const;
const KETOR_CROSSING = { altitudeFt: 15_000, speedKts: 260 } as const;
const MOLGO_CROSSING = { altitudeFt: 14_000, speedKts: 260 } as const;
const EMRAK_CROSSING = { altitudeFt: 12_000, speedKts: 250 } as const;

/**
 * One holding fix, 50 NM back up the leg the entry arrives down.
 *
 * The level is the profile's own interpolated value there rounded **up** to the
 * next 1000 ft, so it is a level a controller can hold at and the route still
 * descends monotonically through it; the speed is that interpolation to the
 * nearest 10 kt, which is 270 on every one. VABB's rule for RCPO, RCKE and RCEM,
 * applied unchanged.
 *
 * The outer end of the leg is the **gate** rather than the published fix, which
 * VABB South can use because its transitions are all long. Four of these are
 * not: AKTIV is 12.6 NM from IGBAN and EXOLU 39 from POKON, so measuring off the
 * published fix would ask for fifty miles of a twelve-mile leg. It costs nothing
 * to measure off the gate instead — `clipToRange` and `extendToRange` both keep
 * the published track, so the gate, the published fix and the merge are
 * collinear and it is the same line either way. For the same reason the
 * published fix does not need to be a waypoint at all.
 */
const holdingFix = (name: string, mergeFix: FixAt, altitudeFt: Ft) => ({
  name,
  at: alongLeg(HOLDING_FIX_INSET_NM, mergeFix, entryGate),
  altitudeFt,
  speedKts: 270,
});

export const VABB_AREA_STARS: readonly StarSpec[] = [
  {
    name: 'KETOR2A',
    fixes: [
      { name: 'KETOR', at: F.KETOR, ...KETOR_CROSSING },
      { name: 'RCKT', at: handoff(F.KETOR, F.MB393), ...KETOR_CROSSING },
    ],
    entries: [
      {
        name: 'DARMI',
        gate: 'DARMI',
        entryAltitudeFt: 29_000,
        entrySpeedKts: 280,
        fixes: [holdingFix('RCDA', F.KETOR, 23_000)],
      },
      {
        name: 'GUNDI',
        gate: 'GUNDI',
        entryAltitudeFt: 30_000,
        entrySpeedKts: 280,
        fixes: [holdingFix('RCGU', F.KETOR, 24_000)],
      },
      {
        name: 'BISET',
        gate: 'BISET',
        entryAltitudeFt: 31_000,
        entrySpeedKts: 280,
        fixes: [holdingFix('RCBI', F.KETOR, 24_000)],
      },
      {
        name: 'ERVIS',
        gate: 'ERVIS',
        entryAltitudeFt: 32_000,
        entrySpeedKts: 280,
        fixes: [holdingFix('RCER', F.KETOR, 24_000)],
      },
      {
        // VABB South's SUGID transition, starting a leg later — see `airport.ts`.
        name: 'AROTA',
        gate: 'AROTA',
        entryAltitudeFt: 33_000,
        entrySpeedKts: 280,
        fixes: [holdingFix('RCAR', F.KETOR, 23_000)],
      },
      // The longest way in of the six, and therefore the highest.
      {
        name: 'KABSO',
        gate: 'KABSO',
        entryAltitudeFt: 34_000,
        entrySpeedKts: 280,
        fixes: [holdingFix('RCKA', F.KETOR, 23_000)],
      },
    ],
  },
  {
    name: 'MOLGO2A',
    fixes: [
      { name: 'MOLGO', at: F.MOLGO, ...MOLGO_CROSSING },
      { name: 'RCMG', at: handoff(F.MOLGO, F.DUGED), ...MOLGO_CROSSING },
    ],
    // Within 4 NM of each other in length, so the 2000 ft between them is there
    // to keep them apart where they converge rather than because one needs it.
    entries: [
      {
        name: 'EPKOS',
        gate: 'EPKOS',
        entryAltitudeFt: 28_000,
        entrySpeedKts: 280,
        fixes: [holdingFix('RCEP', F.MOLGO, 23_000)],
      },
      {
        // The one entry that bends: it joins at BEDOL, 51 NM in, so BEDOL is its
        // hold rather than an invented fix — there is already one there.
        name: 'AGELA',
        gate: 'AGELA',
        entryAltitudeFt: 30_000,
        entrySpeedKts: 280,
        fixes: [{ name: 'BEDOL', at: F.BEDOL, altitudeFt: 21_000, speedKts: 270 }],
      },
    ],
  },
  {
    name: 'POKON2A',
    fixes: [
      { name: 'POKON', at: F.POKON, ...POKON_CROSSING },
      { name: 'RCPK', at: handoff(F.POKON, F.MB379), ...POKON_CROSSING },
    ],
    entries: [
      {
        name: 'EXOLU',
        gate: 'EXOLU',
        entryAltitudeFt: 31_000,
        entrySpeedKts: 280,
        fixes: [holdingFix('RCEX', F.POKON, 25_000)],
      },
      // 28 NM further out than EXOLU, and the longest run in on the field.
      {
        name: 'BOFIN',
        gate: 'BOFIN',
        entryAltitudeFt: 35_000,
        entrySpeedKts: 280,
        fixes: [holdingFix('RCBO', F.POKON, 25_000)],
      },
    ],
  },
  {
    name: 'IGBAN2A',
    fixes: [
      { name: 'IGBAN', at: F.IGBAN, ...IGBAN_CROSSING },
      { name: 'RCIG', at: handoff(F.IGBAN, F.MB392), ...IGBAN_CROSSING },
    ],
    entries: [
      {
        name: 'AKTIV',
        gate: 'AKTIV',
        entryAltitudeFt: 29_000,
        entrySpeedKts: 280,
        fixes: [holdingFix('RCAK', F.IGBAN, 23_000)],
      },
    ],
  },
  {
    name: 'EMRAK2A',
    fixes: [
      { name: 'EMRAK', at: F.EMRAK, ...EMRAK_CROSSING },
      { name: 'RCEK', at: handoff(F.EMRAK, F.OLGUS), ...EMRAK_CROSSING },
    ],
    entries: [
      {
        name: 'OPAKA',
        gate: 'OPAKA',
        entryAltitudeFt: 29_000,
        entrySpeedKts: 280,
        fixes: [holdingFix('RCOP', F.EMRAK, 22_000)],
      },
    ],
  },
];
