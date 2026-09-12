/**
 * The fixes the full area sector is built from.
 *
 * Most of them are already transcribed: `fields/vabb/fixes.ts` has the five TMA
 * entry fixes and the runway transitions inside them, and
 * `fields/vabbSouth/fixes.ts` has the ten enroute transition fixes feeding KETOR
 * and MOLGO from the south. Both are AIP Supplement 84/2020's own WGS84 waypoint
 * table read at the same ARP datum, so they compose without conversion and this
 * file adds only what neither carries: the **four northern transitions**.
 *
 * ## Why these four are stated as a track and a distance
 *
 * They are the one thing on this field not read off a coordinate table. AKTIV,
 * EXOLU, BOFIN and OPAKA are on the RWY 27 STAR chart for EMRAK 2A / IGBAN 2A /
 * POKON 2A, which publishes a magnetic track and a distance for every leg but no
 * waypoint table — and the supplement's table, which does carry them, is the
 * half of the source that was transcribed for the southern sector only.
 *
 * So each is stated the way the chart states it: **one leg back from a fix whose
 * coordinate is published**, using that leg's own printed track and distance.
 * That is deliberately not the chaining `fields/vabb/fixes.ts` warns about — a
 * chain accumulates and put five gates 9–18° out, and this is a single step from
 * an exact anchor. VAR is 0.75° W (2010), so the printed magnetic track is the
 * true one to within a degree (§3.1 A3), and a degree at 40 NM is 0.7 NM — the
 * same order as the flat-frame residual the southern file documents.
 *
 * The four legs, and the anchor each is measured from:
 *
 * | Fix | Published leg | Track | Distance |
 * | --- | --- | --- | --- |
 * | AKTIV | AKTIV → IGBAN | 197° | 12.6 NM |
 * | EXOLU | EXOLU → POKON | 133° | 39.0 |
 * | BOFIN | BOFIN → POKON | 202° | 60.2 |
 * | OPAKA | OPAKA → EMRAK | 255° | 40.0 |
 *
 * **If the supplement's table is ever read for these four, replace the four
 * `backAlong` calls with `at(...)` and nothing else moves** — they are only ever
 * used to aim a leg the gate is then placed on.
 *
 * ## The check that does hold
 *
 * The anchors and everything inside them are transcribed, so the north chart's
 * own trunk legs audit exactly as the southern file's do. Recomputed from the
 * published coordinates in `fields/vabb/fixes.ts`:
 *
 * | Leg | Published | Computed | Δ dist | Δ track |
 * | --- | --- | --- | --- | --- |
 * | IGBAN → MB392 | 31.7 NM / 185° | 31.81 / 184.57° | +0.11 | −0.43° |
 * | MB392 → EMROS | 18.3 / 182° | 18.38 / 181.24° | +0.08 | −0.76° |
 * | POKON → MB379 | 44.7 / 139° | 44.78 / 138.17° | +0.08 | −0.83° |
 * | MB379 → EMROS | 30.6 / 091° | 30.57 / 090.41° | −0.03 | −0.59° |
 * | EMRAK → OLGUS | 25.7 / 242° | 25.70 / 241.38° | 0.00 | −0.62° |
 * | EMROS → OLGUS | 18.8 / 090° | 18.73 / 089.43° | −0.07 | −0.57° |
 *
 * Worst case a tenth of a mile and eight tenths of a degree, which is the same
 * residual at half the range.
 */
import { headingVector, type Deg, type Nm } from '../../../sim/units.js';
import type { FixAt } from '../../geometry.js';
import { VABB_FIXES } from '../vabb/fixes.js';
import { VABB_SOUTH_FIXES } from '../vabbSouth/fixes.js';

/**
 * The fix `distNm` back up a published `trackDeg` leg ending at `to`.
 *
 * A chart states a leg as the track flown *along* it, so this reverses it: the
 * fix is where an aircraft on that track would have been `distNm` earlier.
 */
const backAlong =
  (to: FixAt, trackDeg: Deg, distNm: Nm): FixAt =>
  (ctx) => {
    const end = to(ctx);
    const v = headingVector(trackDeg);
    return { x: end.x - v.x * distNm, y: end.y - v.y * distNm };
  };

const V = VABB_FIXES;

export const VABB_AREA_FIXES = {
  ...VABB_SOUTH_FIXES,

  // ── The five TMA entry fixes, and the first fix inside each ───────────────
  // Read from outside the boundary this time. That the two fields agree about
  // them is the point: VABB spawns its arrivals at these, and this one delivers
  // ten miles past them.
  POKON: V.POKON,
  MB379: V.MB379,
  IGBAN: V.IGBAN,
  MB392: V.MB392,
  EMRAK: V.EMRAK,
  OLGUS: V.OLGUS,

  // ── The four enroute transitions from the north and east ──────────────────
  /** A474, Q16, Q2, W10S, W158, W77 — Delhi and the north Indian corridor. */
  AKTIV: backAlong(V.IGBAN, 197, 12.6),
  /** L301, M638, W14 — the Gulf and Europe, in over the sea. */
  EXOLU: backAlong(V.POKON, 133, 39.0),
  /** G210, W13S, W16S — Ahmedabad, Jaipur and the north-west overland. */
  BOFIN: backAlong(V.POKON, 202, 60.2),
  /** G450, L505, Q20, W18 — Kolkata, the north-east and Southeast Asia. */
  OPAKA: backAlong(V.EMRAK, 255, 40.0),
} as const satisfies Record<string, FixAt>;
