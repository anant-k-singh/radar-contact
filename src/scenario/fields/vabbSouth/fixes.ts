/**
 * The published fixes the southern en-route sector is built from.
 *
 * Same source and same conversion as `fields/vabb/fixes.ts` — AIP Supplement
 * 84/2020's own WGS84 waypoint table, transcribed to the second — and the same
 * reason for taking coordinates rather than chaining the charts' leg bearings:
 * a chain accumulates, and at 160 NM it accumulates badly.
 *
 * What is here that VABB's file does not carry is the **enroute transition**
 * fixes. `fields/vabb/airport.ts` names them as the thing that field deliberately
 * leaves out — "six of them into KETOR, three into MOLGO" — and this is the field
 * that flies them, so this is where they are written down. The supplement's
 * §6.3 and §6.4 transition tables are the authority for which fix feeds which
 * route and in what order.
 *
 * ## The check that makes the transcription auditable
 *
 * Every published leg carries a distance and a true track in the supplement's own
 * table, and none of them is used to *place* anything — they are used to check
 * what the coordinates produce. Recomputed from the positions below:
 *
 * | Leg | Published | Computed | Δ dist | Δ track |
 * | --- | --- | --- | --- | --- |
 * | BISET → KETOR | 158.17 NM / 089.61° | 157.20 / 089.16° | −0.97 | −0.45° |
 * | DARMI → KETOR | 93.51 / 066.38° | 92.96 / 065.89° | −0.55 | −0.49° |
 * | ERVIS → KETOR | 79.89 / 000.83° | 80.21 / 000.81° | +0.32 | −0.02° |
 * | GUNDI → KETOR | 71.93 / 027.60° | 72.01 / 027.20° | +0.08 | −0.40° |
 * | KABSO → KETOR | 90.76 / 331.83° | 90.84 / 332.28° | +0.08 | +0.45° |
 * | SUGID → AROTA | 55.11 / 117.01° | 55.13 / 116.97° | +0.02 | −0.04° |
 * | AROTA → KETOR | 113.87 / 112.06° | 113.54 / 111.92° | −0.33 | −0.14° |
 * | AGELA → BEDOL | 112.14 / 307.72° | 111.42 / 308.43° | −0.72 | +0.71° |
 * | BEDOL → MOLGO | 39.10 / 307.56° | 38.95 / 308.00° | −0.15 | +0.44° |
 * | EPKOS → MOLGO | 87.07 / 330.93° | 87.11 / 331.41° | +0.04 | +0.48° |
 * | KETOR → MB393 | 42.02 / 047.22° | 41.99 / 046.89° | −0.03 | −0.33° |
 * | MOLGO → DUGED | 32.85 / 336.82° | 32.93 / 337.06° | +0.08 | +0.24° |
 *
 * Worst case is a mile in 158 — six tenths of one per cent — and seven tenths of
 * a degree. That residual is the flat local frame of §3.1 A1 doing what it is
 * documented to do at four times the range it was adopted for, not a transcription
 * error, and it is well inside the width of a radar blip at this scale.
 */
import { xy } from '../../geometry.js';
import type { FixAt } from '../../geometry.js';

/** The same datum `fields/vabb/fixes.ts` uses: AD 2 VABB 1-1. */
const ARP_LAT = 19 + 5 / 60 + 29.563 / 3600;
const ARP_LON = 72 + 51 / 60 + 57.559 / 3600;

/** 56.6998 NM per degree of longitude at this latitude, against 60 for latitude. */
const NM_PER_DEG_LON = 60 * Math.cos((ARP_LAT * Math.PI) / 180);

function at(
  latDeg: number,
  latMin: number,
  latSec: number,
  lonDeg: number,
  lonMin: number,
  lonSec: number,
): FixAt {
  const lat = latDeg + latMin / 60 + latSec / 3600;
  const lon = lonDeg + lonMin / 60 + lonSec / 3600;
  return xy((lon - ARP_LON) * NM_PER_DEG_LON, (lat - ARP_LAT) * 60);
}

export const VABB_SOUTH_FIXES = {
  // ── The two TMA entry fixes, and the first fix inside each ────────────────
  // Identical to `fields/vabb/fixes.ts`: the same fixes at the same coordinates,
  // read from the other side of the boundary. That they agree is the point — the
  // approach field spawns its arrivals at these, and this field delivers to them.
  KETOR: at(18, 25, 39.67, 72, 4, 26.54),
  MOLGO: at(18, 9, 37.56, 73, 23, 6.26),
  /** First fix of the RWY 27 runway transition off each gate; aims the last leg. */
  MB393: at(18, 54, 21.5, 72, 36, 52.61),
  DUGED: at(18, 39, 57.31, 73, 9, 31.39),

  // ── The six enroute transitions into KETOR (supplement §6.3) ──────────────
  /** ATS routes Q12, R461, W17 — the Gulf and the Maldives, in over the sea. */
  KABSO: at(17, 5, 14.8, 72, 49, 9.8),
  ERVIS: at(17, 5, 27.78, 72, 3, 14.2),
  GUNDI: at(17, 21, 36.69, 71, 29, 36.44),
  DARMI: at(17, 47, 41.55, 70, 34, 38.86),
  BISET: at(18, 23, 21.37, 69, 18, 6.46),
  SUGID: at(19, 33, 3.0, 69, 20, 59.43),
  /** SUGID's transition turns left at AROTA; the only two-leg one into KETOR. */
  AROTA: at(19, 8, 3.0, 70, 12, 59.0),

  // ── The enroute transitions into MOLGO (supplement §6.4) ──────────────────
  /** B466, N571, W56 — the peninsula: Bengaluru, Chennai, Hyderabad. */
  AGELA: at(16, 36, 24.0, 75, 27, 57.0),
  /** On the AGELA transition as well as being one of its own — see `stars.ts`. */
  BEDOL: at(17, 45, 39.0, 73, 55, 35.0),
  EPKOS: at(16, 53, 8.0, 74, 7, 13.0),
} as const satisfies Record<string, FixAt>;
