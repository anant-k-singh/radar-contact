/**
 * VABB SOUTH — the en-route sector feeding Mumbai's two southern arrival gates.
 *
 * This is the airspace `fields/vabb/airport.ts` says it deliberately leaves out:
 * "the **enroute transitions**, which feed the five entry fixes from 73 to 210 NM
 * out … six of them into KETOR, three into MOLGO". Approach owns the 60 NM
 * circle; this owns the wedge outside it, and the two meet on the same fixes.
 *
 * ## Sources
 *
 * The same AIP Supplement 84/2020 the approach field is transcribed from, and it
 * is not in this repository and must not be (publisher's copyright, AGPL-3.0
 * project). §6.3 and §6.4 are the KETOR 2A and MOLGO 2A enroute transition
 * tables; the WGS84 coordinates are the supplement's own table, via `fixes.ts`,
 * where the leg-by-leg cross-check that warrants the transcription is recorded.
 *
 * ## The shape, and why it is a wedge
 *
 * One en-route controller owns a slice, not a ring. The eight transitions arrive
 * on bearings from 137° to 273°, so the sector is **125° to 285°** — the southern
 * half — between an outer arc at **160 NM** and an inner one at **50 NM**.
 *
 * The inner arc is the part that had to be chosen rather than measured, and it is
 * ten miles *inside* the TMA entry fixes on purpose. KETOR is 60.0 NM from the
 * field and MOLGO 63.1, so putting the handoff line on them would mean the last
 * chance to fix a sequence came before the fix — and there would be nowhere to
 * hold, because a hold needs a fix and the fix would already be the boundary. At
 * 50 NM the controller owns KETOR and MOLGO themselves, can stack traffic on
 * them, and still has ten miles to settle it before the next sector takes it.
 *
 * The consequence is a deliberate ten-mile overlap: `?airport=VABB` spawns its
 * arrivals *at* KETOR and MOLGO, which this field is still flying for another ten
 * miles. Both are right — a transfer of control point inside the receiving unit's
 * lateral boundary is ordinary — and what matters is that the two agree about the
 * crossing, which is why the delivery levels below are VABB's own handovers.
 *
 * ## The outer arc, and what it does to a published fix
 *
 * Five of the eight transitions begin inside 160 NM and three outside it, so both
 * halves of the boundary problem appear at once. `clipToRange` walks a fix that is
 * too far out down its own published leg; `extendToRange` pushes one that is too
 * far in back up the leg it would have arrived on. Either way the **track** is the
 * published one and only where the route starts moves — the coordinate itself
 * stays in `fixes.ts`, untouched.
 */
import { clipToRange, extendToRange } from '../../geometry.js';
import type { AirspaceSpec, DeliveryGateSpec, EntryGateSpec } from '../../types.js';
import { VABB_SOUTH_FIXES as F } from './fixes.js';

/**
 * The top of what the controller may assign, set by the highest handover rather
 * than chosen — the same rule VABB's 17,000 comes from. KABSO is handed over at
 * FL370 because it has the longest run in of the eight, so the sector has to be
 * able to hold an aircraft there.
 */
export const CEILING_FT = 37_000;

/**
 * The floor, and it is a delivery level rather than a terrain figure. This sector
 * hands MOLGO's stream over at 14,000 and KETOR's at 15,000; below that is the
 * next sector's airspace, not this one's, and there is nothing here a controller
 * could usefully do with a lower level.
 */
export const FLOOR_FT = 14_000;

/** Where the transitions are picked up. */
export const OUTER_RANGE_NM = 160;

/**
 * Where the aircraft is handed to Approach — ten miles inside the TMA fixes.
 *
 * `RCKT` lands at 50.03 NM measured along the published KETOR → MB393 track, so
 * the arc and the fix agree to within a twentieth of a mile. `RCMG` is 3.2 NM
 * further out on its own track, which leaves that stream a little run after the
 * fix rather than none.
 */
export const INNER_RANGE_NM = 50;

export const VABB_SOUTH_AIRSPACE: AirspaceSpec = {
  radiusNm: OUTER_RANGE_NM,
  shape: { kind: 'sector', innerNm: INNER_RANGE_NM, fromDeg: 125, toDeg: 285 },
  mvaFt: FLOOR_FT,
  ceilingFt: CEILING_FT,
  /** Every 25 NM from the handoff line out; the 160 NM ring *is* the boundary. */
  rangeRingsNm: [75, 100, 125, 150],
};

/**
 * Eight gates, one per published enroute transition, each where its own leg
 * crosses the 160 NM arc.
 *
 * ## The weights
 *
 * `fields/vabb/airport.ts` splits Mumbai's arrivals MOLGO 34 to KETOR 13 — the
 * southern peninsula against the sea approaches — and that ratio is inherited
 * here, because it is the same traffic counted one sector earlier. Within each
 * group the split follows the route network: AGELA carries B466/N571/W56 off the
 * peninsula and is the single busiest way in, KABSO carries Q12/R461/W17 up from
 * the Gulf, and the four western sea gates share what is left. They sum to 100 so
 * they read as percentages.
 */
export const VABB_SOUTH_GATES: readonly EntryGateSpec[] = [
  // ── MOLGO's stream: the peninsula, 72 % of the sector ─────────────────────
  /** 137°, published 209.7 NM, inbound via BEDOL. Bengaluru, Chennai, Kochi. */
  { name: 'AGELA', at: clipToRange(OUTER_RANGE_NM, F.BEDOL, F.AGELA), weight: 48 },
  /** 152°, published 150.3 NM, direct to MOLGO. Hyderabad, Goa, the south-east. */
  { name: 'EPKOS', at: extendToRange(OUTER_RANGE_NM, F.EPKOS, F.MOLGO), weight: 24 },

  // ── KETOR's stream: in over the sea, 28 % ─────────────────────────────────
  /** 174°, published 120.3 NM, the closest in. The Gulf via Q12/R461/W17. */
  { name: 'KABSO', at: extendToRange(OUTER_RANGE_NM, F.KABSO, F.KETOR), weight: 10 },
  /** 197°, published 128.6 NM, tracking almost due north. */
  { name: 'ERVIS', at: extendToRange(OUTER_RANGE_NM, F.ERVIS, F.KETOR), weight: 5 },
  /** 215°, published 129.8 NM. */
  { name: 'GUNDI', at: extendToRange(OUTER_RANGE_NM, F.GUNDI, F.KETOR), weight: 4 },
  /** 239°, published 151.3 NM. */
  { name: 'DARMI', at: extendToRange(OUTER_RANGE_NM, F.DARMI, F.KETOR), weight: 4 },
  /** 255°, published 206.4 NM — the furthest out, clipped by 46 miles. */
  { name: 'BISET', at: clipToRange(OUTER_RANGE_NM, F.KETOR, F.BISET), weight: 3 },
  /** 273°, published 201.3 NM, and the only one that turns: left at AROTA. */
  { name: 'SUGID', at: clipToRange(OUTER_RANGE_NM, F.AROTA, F.SUGID), weight: 2 },
];

/**
 * What Approach has asked for, per gate (§3.2a) — and the whole objective.
 *
 * A rate is miles-in-trail stated as the receiving controller actually thinks of
 * it: 10 an hour is a six-minute interval, 4 an hour is fifteen. The two are
 * satisfied **independently**, because filling MOLGO's stream while starving
 * KETOR's is not a sector that delivered fourteen an hour — it is one that broke
 * both agreements at once.
 *
 * ## Where these two numbers come from
 *
 * They are **Mumbai's arrival capacity cut by Mumbai's own gate weights**, which
 * is what an acceptance rate is: the receiving field states what it can land, and
 * each feeder fix is told its share of it. VABB works to about 30 arrivals an
 * hour, and `fields/vabb/airport.ts` weights MOLGO at 34 % of them and KETOR at
 * 13 % — derived there from CSMIA's published market share. So 10.2 and 3.9,
 * rounded to the rates a controller would be given.
 *
 * Deriving them rather than choosing them is what keeps the two fields from
 * disagreeing about the boundary they share, the same reason KETOR is handed over
 * at 15,000/260 here because `fields/vabb/stars.ts` expects it. An agreement
 * picked to feel right at this end would be a number Approach had never asked
 * for.
 *
 * They are also **below** the rate their stream is offered at the default flow —
 * 13 an hour into MOLGO and 5 into KETOR — which is the exercise rather than a
 * misconfiguration. A sector handed exactly what the field below can take has
 * nothing to do; the surplus is what has to go into speed, track miles and the
 * hold, and the achieved-against-agreed rows are where failing to place it shows
 * up. Turning the arrival flow down is what makes the sector quiet, and that
 * control belongs to the player.
 */
export const VABB_SOUTH_DELIVERY: readonly DeliveryGateSpec[] = [
  { fixName: 'RCMG', targetRatePerHour: 10 },
  { fixName: 'RCKT', targetRatePerHour: 4 },
];
