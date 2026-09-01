/**
 * VABB's published fixes, at their published coordinates.
 *
 * Every position in this field comes from here, and every entry is the WGS84
 * coordinate printed in the AIP's own table (AIP Supplement 84/2020, cited in
 * `airport.ts`) — transcribed to the second, in the order the table gives.
 *
 * Coordinates rather than chained bearings and distances, which is what this file
 * replaced. The charts give each leg as a track and a distance and never give a
 * fix a bearing and range from the ARP, so solving a fix's position back from the
 * chart is a chain — and a chain accumulates: the five entry gates came out
 * 9–18° off their true bearings that way. A published coordinate has no chain in
 * it.
 *
 * Two facts fall out of the real numbers and are worth stating, because both were
 * guessed wrong before:
 *
 * - **The five STAR entry fixes sit on a 60 NM arc**: POKON 60.6, IGBAN 60.3,
 *   KETOR 60.0, EMRAK 60.3, MOLGO 63.2 NM. That is the TMA boundary, and it is
 *   why the airspace here is 60-odd miles rather than an arbitrary size.
 * - **The arrivals genuinely merge.** EMROS is on IGBAN 2A *and* POKON 2A, OLGUS
 *   on those two plus EMRAK 2A, and LIKTA and MB395 on both southern routes.
 */
import { xy } from '../../geometry.js';
import type { FixAt } from '../../geometry.js';

/**
 * Airport reference point, from the AD 2 VABB 1-1 aerodrome chart. The local frame
 * is measured from it (`Scenario.arp` is always the origin), so it appears here
 * only as the datum the conversion subtracts.
 */
const ARP_LAT = 19 + 5 / 60 + 29.563 / 3600;
const ARP_LON = 72 + 51 / 60 + 57.559 / 3600;

/**
 * NM per degree of longitude at this latitude — 56.6998, against 60 for latitude.
 *
 * A flat local frame with one scale factor, which is all §3.1 A1 allows itself: at
 * 60 NM the error against a proper projection is a small fraction of a mile, well
 * under the width of a radar blip, and the alternative is geodesy this simulator
 * has no use for.
 */
const NM_PER_DEG_LON = 60 * Math.cos((ARP_LAT * Math.PI) / 180);

/** A published coordinate, in the degrees-minutes-seconds the AIP table prints. */
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

export const VABB_FIXES = {
  // ── Arrivals, northern and eastern flows: … → EMROS → OLGUS ──────────────
  POKON: at(19, 46, 19.07, 72, 4, 37.48),
  MB379: at(19, 12, 57.15, 72, 36, 13.56),
  IGBAN: at(20, 2, 49.02, 73, 11, 40.62),
  MB392: at(19, 31, 6.68, 73, 8, 59.85),
  EMROS: at(19, 12, 43.91, 73, 8, 34.51),
  OLGUS: at(19, 12, 54.99, 73, 28, 23.45),
  EMRAK: at(19, 25, 13.59, 73, 52, 15.94),

  // ── Arrivals, southern flows: … → LIKTA → MB395 ──────────────────────────
  KETOR: at(18, 25, 39.67, 72, 4, 26.54),
  MB393: at(18, 54, 21.5, 72, 36, 52.61),
  MOLGO: at(18, 9, 37.56, 73, 23, 6.26),
  DUGED: at(18, 39, 57.31, 73, 9, 31.39),
  LIKTA: at(18, 55, 37.92, 73, 9, 6.83),
  MB395: at(18, 56, 11.67, 73, 22, 46.1),

  // ── Departures: every SID leaves through MB364 ───────────────────────────
  MB364: at(19, 5, 13.38, 72, 45, 4.36),
  ANOLI: at(19, 18, 3.88, 72, 44, 21.53),
  XOPAL: at(19, 27, 44.8, 72, 53, 23.19),
  MB373: at(19, 29, 55.05, 73, 3, 58.56),
  MB365: at(19, 33, 39.7, 73, 21, 42.71),
  SEKVI: at(19, 35, 34.0, 73, 41, 3.0),
  MB361: at(20, 5, 0.56, 72, 51, 35.65),
  MB399: at(19, 29, 37.2, 72, 39, 56.16),
  MB381: at(20, 0, 48.94, 72, 27, 31.85),
  RAXET: at(19, 9, 24.03, 72, 5, 51.22),
  MB370: at(18, 53, 29.63, 71, 49, 54.49),
  VEVAK: at(18, 46, 37.8, 72, 44, 34.3),
  OMGIX: at(18, 46, 56.07, 72, 57, 25.47),
  DOGAP: at(18, 48, 33.0, 73, 25, 0.0),
  ONAPA: at(18, 27, 56.95, 72, 37, 1.76),
  MB362: at(18, 5, 11.96, 72, 58, 55.7),
} as const satisfies Record<string, FixAt>;
