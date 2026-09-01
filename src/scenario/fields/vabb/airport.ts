/**
 * VABB — Chhatrapati Shivaji Maharaj International, Mumbai. Runway 27.
 *
 * ## Sources
 *
 * Transcribed from the published charts and coding tables listed below. **They are
 * not in this repository and must not be** — they are the publisher's copyright and
 * this is an AGPL-3.0 project, so redistributing them is not something the licence
 * can cover. `docs/charts/` is gitignored; put local copies there if you have them.
 *
 * - AIP India, **AD 2 VABB 1-1 "AERODROME CHART"**, 25 May 2017 — the ARP, the
 *   aerodrome elevation, and all four runway thresholds with their coordinates.
 * - **AIP Supplement 84/2020**, the STAR and SID charts for VABB. This is the
 *   authority for everything about the procedures: §6.1–6.5 are the RWY 27 STARs and
 *   §7.1–7.3 the RWY 27 SIDs, given as tabular coding — fix sequence, path
 *   terminator, track, distance, and published altitude and speed at each fix — and
 *   it carries the WGS84 coordinate table that `fixes.ts` transcribes.
 *
 * The coding tables are what make this field checkable rather than merely
 * plausible. An earlier version of this file solved fix positions back from the
 * charts' leg bearings and distances instead, and the accumulated error put the
 * five entry gates 9–18° off their true bearings.
 *
 * ## Where the numbers come from
 *
 * ARP 19°05'29.563"N 072°51'57.559"E, AD ELEV 40 ft. Positions in the local frame
 * are published coordinates converted at 60 NM per degree of latitude and 56.6998
 * per degree of longitude, the value at this latitude — see `fixes.ts`.
 *
 * VAR 0.75° W (2010), so magnetic and true agree to within a degree and the
 * published magnetic tracks are used unconverted (§3.1 A3). The 09/27 pavement
 * bears 089.2° true, charted 090° magnetic — the same statement.
 *
 * ## What is deliberately not here
 *
 * The **enroute transitions**, which feed the five entry fixes from 73 to 210 NM
 * out: AKTIV into IGBAN, OPAKA into EMRAK, EXOLU and BOFIN into POKON, six of them
 * into KETOR, three into MOLGO. A scope that held them would make the 30 NM where
 * the session is actually played unreadable, so each STAR's convergence fix is its
 * entry gate and Center delivers there. Six SID exits are truncated the same way —
 * see `sids.ts`.
 *
 * That works cleanly because of a fact about the real design rather than a
 * convenience: **the five convergence fixes sit on a 60 NM arc** — POKON 60.6,
 * IGBAN 60.3, KETOR 60.0, EMRAK 60.3, MOLGO 63.2 NM out. They are the TMA boundary.
 *
 * Also not here: RWY 09, 14 and 32, which have their own procedures (the 2B, 2C and
 * 2D variants of each route). Every chart transcribed is RWY 27.
 */
import { xy } from '../../geometry.js';
import type { AirspaceSpec, EntryGateSpec, InactiveRunwaySpec, RunwaySpec } from '../../types.js';
import { VABB_FIXES } from './fixes.js';

/** The top of what the controller may assign. The STARs are handed over at FL120. */
export const CEILING_FT = 13_000;
/** What every STAR is handed over at: "AT OR ABOVE FL120 AT 250KT" on all five. */
export const ENTRY_FT = 12_000;
export const ENTRY_KTS = 250;

/**
 * 3660 m of pavement bearing 089.2°/269.2° true. Centred on the ARP by the
 * compiler, which puts the RWY 27 threshold at the east end and the departure end
 * at the west — so the arrivals come in over the city and the departures go out
 * over the sea, which is the whole shape of this field.
 */
export const VABB_RUNWAY: RunwaySpec = {
  id: '27',
  courseDeg: 270,
  lengthNm: 1.98,
  /** ILS 27 publishes a climb to 3000 (§4.2). */
  missedApproachAltitudeFt: 3000,
  /** 30 rather than 20: both arrival streams end 28–33 NM out on a 66 NM scope. */
  centerlineLengthNm: 30,
  centerlineTickNm: 2,
};

/**
 * 14/32 — 2990 m, crossing 09/27. Drawn and nothing else.
 *
 * Its two ends are the aerodrome chart's RWY 14 and RWY 32 threshold coordinates,
 * so the crossing angle and the offset from the ARP are the real ones. It is 1.23
 * NM threshold to threshold rather than the full 2990 m because both thresholds are
 * displaced.
 */
export const VABB_INACTIVE: readonly InactiveRunwaySpec[] = [
  { id: '14/32', ends: [xy(-0.344, 0.268), xy(0.535, -0.59)] },
];

export const VABB_AIRSPACE: AirspaceSpec = {
  /**
   * 66 NM, which is what it takes to hold the field's own geometry: the entry gates
   * are at their published positions and MOLGO, the furthest, is 63.2 NM out.
   *
   * The gates are deliberately *not* placed on this boundary. Forcing five fixes
   * that sit at 60.0–63.2 NM onto one circle moves them — IGBAN by 8 NM — which
   * bends the first leg of the arrival for no gain.
   */
  radiusNm: 66,
  /**
   * The northern and southern caps are cut off here (§3.1). There is not much to
   * cut: IGBAN is 57.3 NM north and MB362, the southern SID exit, 60.3 NM south, so
   * anything tighter than about 62 clips the field's own fixes off the scope. Worth
   * keeping even so — it takes 4 NM of empty airspace off the height, and the height
   * is what sets the scale.
   */
  halfHeightNm: 62,
  /**
   * MSA within 25 NM is 2600/2800/3800 ft by sector and the transition altitude is
   * 4000. No terrain is modelled (§3.1 A1), so this is a floor on what the
   * controller may assign rather than a statement about the ground.
   */
  mvaFt: 3000,
  ceilingFt: CEILING_FT,
  rangeRingsNm: [10, 20, 30, 40, 50, 60],
};

/**
 * Five gates, one per published STAR — each the fix its chart converges on, at its
 * published coordinate.
 *
 * ## The weights
 *
 * Which direction traffic comes from is a fact about the route network, and here an
 * even split would be badly wrong: the southern peninsula carries roughly three
 * times the northeast. Derived from CSMIA's published market share — Delhi 18% of
 * the domestic passenger share, Bengaluru 11%, Goa 7% — and a movement split of
 * about 73% domestic to 27% international (755/281 on the 1,036-movement record day
 * of 21 Nov 2025), with the Middle East the largest international region.
 * Destinations are then mapped onto the bearing they arrive on. They sum to 100 so
 * they read as percentages, though nothing requires it.
 */
export const VABB_GATES: readonly EntryGateSpec[] = [
  /** 152°, 63.2 NM. Bengaluru, Goa, Chennai, Hyderabad, Kochi, Colombo. */
  { name: 'MOLGO', at: VABB_FIXES.MOLGO, weight: 34 },
  /** 018°, 60.3 NM. Delhi and the north Indian corridor, Ahmedabad, Jaipur. */
  { name: 'IGBAN', at: VABB_FIXES.IGBAN, weight: 22 },
  /** 312°, 60.6 NM. Dubai, Doha, Abu Dhabi, Muscat, and Europe behind them. */
  { name: 'POKON', at: VABB_FIXES.POKON, weight: 19 },
  /** 228°, 60.0 NM. The Maldives, and Gulf traffic routing in over the sea. */
  { name: 'KETOR', at: VABB_FIXES.KETOR, weight: 13 },
  /** 071°, 60.3 NM. Kolkata, the northeast, and Southeast Asia. */
  { name: 'EMRAK', at: VABB_FIXES.EMRAK, weight: 12 },
];
