/**
 * VABB AREA — the whole en-route sector feeding Mumbai, in every direction.
 *
 * `fields/vabbSouth/airport.ts` is the southern half of this job: a wedge from
 * 125° to 285° flying the eight transitions into KETOR and MOLGO. That left the
 * other three gates — IGBAN, POKON and EMRAK, 53 % of Mumbai's arrivals — with
 * no sector above them, which §15.0 records as the work remaining. This is the
 * position that works all five.
 *
 * ## Sources
 *
 * The same AIP Supplement 84/2020, and it is not in this repository and must not
 * be (publisher's copyright, AGPL-3.0 project). §6.3 and §6.4 are the southern
 * transition tables; the northern four come off the RWY 27 STAR chart for
 * EMRAK 2A / IGBAN 2A / POKON 2A. `fixes.ts` records which coordinates are read
 * from a table and which four are stated as a published track and distance, and
 * why that distinction matters.
 *
 * ## The shape, and why it is a ring
 *
 * Twelve transitions arrive on bearings all the way round the compass, so there
 * is no wedge to cut: the sector is an **annulus**, 50 to 150 NM, with the hole
 * in the middle being VABB's own TMA. A full ring is not a `sector` spanning
 * 000 → 360 — every sector branch takes its span as
 * `normalizeHeading(toDeg - fromDeg)`, and that is 0 for a full turn — so it is
 * its own member of `AirspaceShape`. It cost the same six branches the wedge did
 * plus `checkSectorExit`, and every one of them is the simpler case, because a
 * ring has no radials.
 *
 * The inner arc is VABB South's, for VABB South's reason: ten miles inside the
 * TMA entry fixes, so the controller owns KETOR, MOLGO, POKON, IGBAN and EMRAK
 * themselves and can hold on them, with ten miles left to settle a sequence
 * before Approach takes it. The overlap with `?airport=VABB` is deliberate.
 *
 * ## The outer arc, and why 150 rather than VABB South's 160
 *
 * The north is short and the south is long, and no one ring sits naturally on
 * both: AKTIV is 72.9 NM out where BISET is 206.4. Every ring therefore clips
 * some legs in and extends others out, and 150 is the one that spends least —
 * **DARMI at 151.3, AROTA at 150.3 and EPKOS at 150.3 are already on it**, so
 * the three furthest-out southern entries move by about a mile between them. At
 * 160 those three cost nine miles each and, far worse, all four northern gates
 * push out 50–87 NM instead of 50–77.
 *
 * One entry changes shape for it. **AROTA is 150.25 NM out — a quarter of a mile
 * outside the ring — and it is a waypoint rather than a gate**, which
 * `validateScenario` rejects. So VABB South's SUGID transition is this field's
 * AROTA transition: the gate sits on the ring essentially at AROTA and runs one
 * straight leg to KETOR, and the SUGID → AROTA leg beyond it is not truncated so
 * much as **outside this sector** — at a 150 NM boundary it is the next one's.
 * The cost is the only entry that turned on its way in; SUGID stays in `fixes.ts`
 * because it is still where that traffic comes from.
 */
import { clipToRange, extendToRange } from '../../geometry.js';
import type { AirspaceSpec, DeliveryGateSpec, EntryGateSpec } from '../../types.js';
import { VABB_AREA_FIXES as F } from './fixes.js';

/**
 * Set by the highest handover, as every ceiling is. BOFIN has the longest run in
 * of the twelve and is taken at FL350, so the controller has to be able to hold
 * one there; the 2000 ft above it is the room a stack needs.
 */
export const CEILING_FT = 37_000;

/**
 * The floor, and it is a delivery level rather than a terrain figure — the
 * *lowest* handover this time, which is the mirror of the rule the ceiling comes
 * from. EMRAK is given to Approach at 12,000 because it is 25 NM from there to
 * OLGUS and there is nowhere else to lose the height, and below that is
 * Approach's airspace rather than this one's.
 */
export const FLOOR_FT = 12_000;

/** Where the transitions are picked up. */
export const OUTER_RANGE_NM = 150;

/** Where they are handed to Approach — ten miles inside the five TMA fixes. */
export const INNER_RANGE_NM = 50;

export const VABB_AREA_AIRSPACE: AirspaceSpec = {
  radiusNm: OUTER_RANGE_NM,
  shape: { kind: 'annulus', innerNm: INNER_RANGE_NM },
  mvaFt: FLOOR_FT,
  ceilingFt: CEILING_FT,
  /** Every 25 NM from the handoff line out; the 150 NM ring *is* the boundary. */
  rangeRingsNm: [75, 100, 125, 150],
};

/**
 * Twelve gates, one per published enroute transition, each where its own leg
 * crosses the 150 NM arc.
 *
 * ## The weights
 *
 * These are **VABB's own gate weights, sub-divided** — the same rule VABB South
 * follows, applied to all five streams instead of two. `fields/vabb/airport.ts`
 * derives MOLGO 34, IGBAN 22, POKON 19, KETOR 13 and EMRAK 12 from CSMIA's
 * published market share, so the twelve entries here must total exactly those
 * five figures; a sector may say where inside a stream its traffic comes from,
 * but not renegotiate how much of it there is.
 *
 * Within a stream the split follows the route network. The southern eleven are
 * VABB South's own proportions rescaled from its 72:28 onto 34:13. IGBAN and
 * EMRAK have a single transition each and take their stream whole. POKON's 19
 * splits toward EXOLU, which carries the Gulf and Europe — `fields/vabb` names
 * that gate's traffic as Dubai, Doha, Abu Dhabi, Muscat and Europe — against
 * BOFIN's overland north-west.
 *
 * They sum to 100 so they read as percentages, though nothing requires it.
 */
export const VABB_AREA_GATES: readonly EntryGateSpec[] = [
  // ── MOLGO's stream, 34 % — the peninsula ──────────────────────────────────
  /** 138°, published 209.6 NM, inbound via BEDOL. Bengaluru, Chennai, Kochi. */
  { name: 'AGELA', at: clipToRange(OUTER_RANGE_NM, F.BEDOL, F.AGELA), weight: 23 },
  /** 152°, published 150.3 NM — on the ring to a third of a mile. */
  { name: 'EPKOS', at: clipToRange(OUTER_RANGE_NM, F.MOLGO, F.EPKOS), weight: 11 },

  // ── IGBAN's stream, 22 % — Delhi and the north Indian corridor ────────────
  /** 017°, published 72.9 NM, the furthest inside the ring of the twelve. */
  { name: 'AKTIV', at: extendToRange(OUTER_RANGE_NM, F.AKTIV, F.IGBAN), weight: 22 },

  // ── POKON's stream, 19 % — in over the sea from the north-west ────────────
  /** 313°, published 99.6 NM. The Gulf and Europe via L301/M638/W14. */
  { name: 'EXOLU', at: extendToRange(OUTER_RANGE_NM, F.EXOLU, F.POKON), weight: 13 },
  /** 360°, published 99.2 NM. Ahmedabad and Jaipur, overland. */
  { name: 'BOFIN', at: extendToRange(OUTER_RANGE_NM, F.BOFIN, F.POKON), weight: 6 },

  // ── KETOR's stream, 13 % — in over the sea from the south and west ────────
  /** 175°, published 120.3 NM. The Gulf via Q12/R461/W17. */
  { name: 'KABSO', at: extendToRange(OUTER_RANGE_NM, F.KABSO, F.KETOR), weight: 5 },
  /** 198°, published 128.5 NM, tracking almost due north. */
  { name: 'ERVIS', at: extendToRange(OUTER_RANGE_NM, F.ERVIS, F.KETOR), weight: 2 },
  /** 215°, published 129.8 NM. */
  { name: 'GUNDI', at: extendToRange(OUTER_RANGE_NM, F.GUNDI, F.KETOR), weight: 2 },
  /** 239°, published 151.3 NM — clipped by 1.3, where VABB South extends it. */
  { name: 'DARMI', at: clipToRange(OUTER_RANGE_NM, F.KETOR, F.DARMI), weight: 2 },
  /** 254°, published 206.4 NM, the furthest out. */
  { name: 'BISET', at: clipToRange(OUTER_RANGE_NM, F.KETOR, F.BISET), weight: 1 },
  /** 271°, published 150.3 NM. VABB South's SUGID transition — see the header. */
  { name: 'AROTA', at: clipToRange(OUTER_RANGE_NM, F.KETOR, F.AROTA), weight: 1 },

  // ── EMRAK's stream, 12 % — the north-east and Southeast Asia ──────────────
  /** 073°, published 100.3 NM. Kolkata and the east via G450/L505/Q20/W18. */
  { name: 'OPAKA', at: extendToRange(OUTER_RANGE_NM, F.OPAKA, F.EMRAK), weight: 12 },
];

/**
 * What Approach has asked for, per gate (§3.2a) — and the whole objective.
 *
 * **Derived, never chosen**, by the rule VABB South states: the receiving field's
 * capacity cut by its own gate weights. VABB works to about 30 arrivals an hour
 * and weights its five gates 34 / 22 / 19 / 13 / 12 %, so the agreements are
 * 10.2, 6.6, 5.7, 3.9 and 3.6, rounded to the rates a controller would be given.
 *
 * What is different here from the southern sector is the total. These five sum to
 * **31 an hour, which is Mumbai's entire arrival capacity** — this position is
 * the whole of what feeds the field, not a slice of it. That is also why the
 * arrival flow is 33: a few percent over, so the surplus has to go into speed,
 * track miles and the hold. Setting it far above what the field below accepts
 * would be a fail state rather than a puzzle, and setting it below would leave
 * the sector nothing to do.
 */
export const VABB_AREA_DELIVERY: readonly DeliveryGateSpec[] = [
  { fixName: 'RCMG', targetRatePerHour: 10 },
  { fixName: 'RCIG', targetRatePerHour: 7 },
  { fixName: 'RCPK', targetRatePerHour: 6 },
  { fixName: 'RCKT', targetRatePerHour: 4 },
  { fixName: 'RCEK', targetRatePerHour: 4 },
];
