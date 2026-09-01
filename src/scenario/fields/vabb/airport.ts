/**
 * VABB — Chhatrapati Shivaji Maharaj International, Mumbai. Runway 27.
 *
 * Charts in `docs/charts/vabb/`: the AD 2 VABB 1-1 aerodrome chart, and the AAI
 * RNAV1 STAR and SID charts (AAI/03-, 04-IALC/20/01-07-2020). Every procedure
 * chart is RWY 27, so 27 is the runway in use and 09 is not modelled.
 *
 * ## Where the numbers come from
 *
 * ARP 19°05'29.563"N 072°51'57.559"E, AD ELEV 40 ft. Positions in the local frame
 * are the aerodrome chart's threshold coordinates converted at 60 NM per degree of
 * latitude and 56.70 NM per degree of longitude (the value at 19.09° N).
 *
 * VAR 0.75° W (2010), so magnetic and true agree to within a degree and the
 * published magnetic tracks are used unconverted (§3.1 A3). The 09/27 pavement
 * bears 089.2° true, charted 090° magnetic — which is the same statement.
 *
 * ## What is deliberately not here
 *
 * The published procedures reach 80–165 NM out: EXOLU and BOFIN feed POKON from
 * ~105 NM, BISET feeds KETOR from 165. A scope that held them would make the
 * 20 NM where the session is actually played unreadable, so everything outside
 * the boundary is dropped and each STAR's convergence fix becomes its entry gate.
 * Solving the charts' leg bearings and distances back to the ARP puts those five
 * fixes at 44–73 NM, mean 59 — which is what makes a 60 NM airspace the right
 * shape for this field rather than an arbitrary one.
 */
import type { AirspaceSpec, EntryGateSpec, InactiveRunwaySpec, RunwaySpec } from '../../types.js';
import { xy } from '../../geometry.js';

/** The top of what the controller may assign. The STARs are handed over at FL120. */
export const CEILING_FT = 13_000;
/** What every STAR is handed over at: "AT OR ABOVE FL120 AT 250KT" on all five charts. */
export const ENTRY_FT = 12_000;
export const ENTRY_KTS = 250;

/**
 * 3660 m of pavement bearing 089.2°/269.2° true. Centred on the ARP by the
 * compiler, which puts the RWY 27 threshold at the east end and the departure end
 * at the west — so the arrivals come from over the city and the departures go out
 * over the sea, which is the whole shape of this field.
 */
export const VABB_RUNWAY: RunwaySpec = {
  id: '27',
  courseDeg: 270,
  lengthNm: 1.98,
  /** ILS 27 publishes a climb to 3000 (§4.2). */
  missedApproachAltitudeFt: 3000,
  /** 25 rather than 20: the arrival platforms sit out to 25 NM on a 60 NM scope. */
  centerlineLengthNm: 25,
  centerlineTickNm: 2,
};

/**
 * 14/32 — 2990 m, crossing 09/27. Drawn and nothing else.
 *
 * Its two ends are the aerodrome chart's RWY 14 and RWY 32 threshold coordinates,
 * so the crossing angle and the offset from the ARP are the real ones. It is 1.23
 * NM threshold to threshold rather than the full 2990 m because both thresholds
 * are displaced.
 */
export const VABB_INACTIVE: readonly InactiveRunwaySpec[] = [
  { id: '14/32', ends: [xy(-0.344, 0.268), xy(0.535, -0.590)] },
];

export const VABB_AIRSPACE: AirspaceSpec = {
  /**
   * 60 NM, because that is where this field's arrival routes converge — the five
   * entry gates are the STARs' own convergence fixes, derived at 44–73 NM.
   */
  radiusNm: 60,
  /**
   * The northern and southern caps are cut off here (§3.1). An uncut 60 NM circle
   * is limited by canvas *height* and would draw this field at a smaller scale
   * than the 50 NM one, which is the opposite of what a bigger airspace is for.
   * Cutting at 50 keeps the full 60 NM east–west, where every arrival platform and
   * every SID exit lives, and pulls only the two near-cardinal gates inward — to
   * 50.1 and 50.8 NM, which is *closer* to their derived ranges of 55 and 52 than
   * 60 was.
   */
  halfHeightNm: 50,
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
 * Five gates, one per published STAR, each the fix its chart converges on.
 *
 * The bearings are what the chart's own leg bearings and distances give when
 * solved back to the ARP; the ranges are the boundary's, which compresses each
 * gate by −13 to +16 NM. That is inside the error of the derivation itself — the
 * charts give no fix a bearing and range from the ARP, so every position is a
 * chain of solved legs.
 *
 * ## The weights
 *
 * Which direction traffic comes from is a fact about the route network, and at
 * this field an even split would be badly wrong: the southern peninsula carries
 * roughly three times the northeast. Derived from CSMIA's published market share —
 * Delhi 18% of the domestic passenger share, Bengaluru 11%, Goa 7% — and a
 * movement split of about 73% domestic to 27% international (755/281 on the
 * 1,036-movement record day of 21 Nov 2025), with the Middle East the largest
 * international region. Destinations are then mapped onto the bearing they arrive
 * on. They sum to 100 so they read as percentages, though nothing requires it.
 */
export const VABB_GATES: readonly EntryGateSpec[] = [
  /** Bengaluru, Goa, Chennai, Hyderabad, Kochi, Colombo — the whole peninsula. */
  { name: 'MOLGO', bearingDeg: 170, weight: 34 },
  /** Delhi and the north Indian corridor, Ahmedabad, Jaipur. */
  { name: 'IGBAN', bearingDeg: 4, weight: 22 },
  /** Dubai, Doha, Abu Dhabi, Muscat, and Europe behind them. */
  { name: 'POKON', bearingDeg: 303, weight: 19 },
  /** The Maldives, and Gulf traffic routing in over the sea. */
  { name: 'KETOR', bearingDeg: 242, weight: 13 },
  /** Kolkata, the northeast, and Southeast Asia. */
  { name: 'EMRAK', bearingDeg: 70, weight: 12 },
];
