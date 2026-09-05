/**
 * LSGG's published fixes, at their published coordinates.
 *
 * Every position in this field comes from here. Unlike VABB, whose AIP prints a
 * WGS84 table beside the coding, the Swiss RNAV charts give only tracks and
 * distances — so these coordinates are transcribed from a **public navigation
 * database** rather than from the charts, and then *checked against* the charts.
 * That check is what makes them trustworthy, and it is unusually strong here:
 * every leg of all nine RWY 22 STARs and all six SIDs agrees with the chart's own
 * printed distance to **0.2 NM** and its printed track to **1°**. A coordinate
 * that survives thirty independent agreements of that kind is not a guess.
 *
 * Three facts fall out of the real numbers, and each is a cross-check on the
 * other two:
 *
 * - **The two downwinds are exactly ±6 NM either side of the final approach
 *   course**, and dead parallel to it — BIVLO/GG525/GG512 at −6.00, and
 *   SOVAD/GG507/GG514 at +6.00, over 17 NM of leg. Nothing was fitted to make
 *   that happen; it is what the published coordinates say.
 * - Solving the runway course from that parallelism gives **225.6° true**, i.e.
 *   the chart's 223° magnetic at a variation of 2.6° E — which is the real value
 *   for Geneva. See `airport.ts`, which is why `courseDeg` is stated as true.
 * - **SAPRE lands on the extended centreline**, bearing 45.5° against the course
 *   reciprocal of 45.6°. It is the one fix in this file with no coordinate in any
 *   source, and it is over-determined four ways — see below.
 *
 * ## The ten fixes solved from a leg
 *
 * Nine fixes are recent terminal waypoints that predate no public database. They
 * are **not** invented, and they keep their published names: each is a point on a
 * leg between two fixes that *are* published, at a distance the chart prints.
 *
 * `CLAUDE.md` warns against solving a fix back from chart bearings, because that
 * is how VABB's five gates came out 9–18° off. The difference is chain length.
 * That attempt chained eight legs outward from the field, and the error compounded
 * at every joint. Each fix here is **one** step between two independently
 * published endpoints, and `alongLeg` uses no bearing at all — only a distance
 * along a line whose two ends are known. Eight of the nine are confirmed by the
 * chart's own arithmetic: the printed leg distances either side sum to the
 * measured separation of the endpoints to within 0.15 NM.
 *
 * The exception is FRIBU, which has only one constraint (20.7 NM from VADAR on
 * the reciprocal of the charted 247°) and so does use a bearing. It sits 56 NM
 * out and is clipped to the boundary anyway, so only its *direction* survives into
 * the field — an error there moves the gate by a fraction of a mile.
 */
import { alongLeg, lerp, xy } from '../../geometry.js';
import type { FixAt } from '../../geometry.js';

/**
 * Airport reference point, from AD 2 LSGG. The local frame is measured from it
 * (`Scenario.arp` is always the origin), so it appears here only as the datum the
 * conversion subtracts.
 */
const ARP_LAT = 46.238056;
const ARP_LON = 6.108889;

/**
 * NM per degree of longitude at this latitude — 41.4998, against 60 for latitude.
 *
 * A flat local frame with one scale factor, as at VABB (§3.1 A1). At 55 NM the
 * error against a proper projection stays well under the width of a radar blip.
 * The factor is much smaller than Mumbai's 56.7 simply because Geneva is 46° north
 * rather than 19°; getting it wrong would squash the field east–west.
 */
const NM_PER_DEG_LON = 60 * Math.cos((ARP_LAT * Math.PI) / 180);

/**
 * Magnetic variation, east. The charts print magnetic tracks and the coordinates
 * above are true, so anything solved from a printed track has to cross that gap.
 * 2.6° is not taken from a model: it is what falls out of forcing the two published
 * downwinds to be parallel to the runway, and it matches the current value for
 * Geneva. `airport.ts` states `courseDeg` in true for the same reason.
 */
const VARIATION_DEG = 2.6;

/** A published coordinate, in the decimal degrees the source database gives. */
function at(lat: number, lon: number): FixAt {
  return xy((lon - ARP_LON) * NM_PER_DEG_LON, (lat - ARP_LAT) * 60);
}

/**
 * `distNm` past `to`, continuing the straight line from `from` — the mirror of
 * `alongLeg`, for a fix that is the *first* on its leg rather than inside it.
 *
 * Field-local because it exists to serve four SID fixes that sit outside the
 * segment joining the two published fixes behind them, all on a track the chart
 * states is constant through all three points.
 */
/**
 * `distNm` from `from` on a magnetic bearing. The last resort, for a fix the chart
 * pins to exactly one other fix — it reintroduces the bearing chain `alongLeg`
 * avoids, so it is used once and the note at the top of this file says why that
 * one is safe.
 */
const fromFix =
  (distNm: number, bearingMagDeg: number, from: FixAt): FixAt =>
  (ctx) => {
    const a = from(ctx);
    const t = ((bearingMagDeg + VARIATION_DEG) * Math.PI) / 180;
    return { x: a.x + distNm * Math.sin(t), y: a.y + distNm * Math.cos(t) };
  };

const beyondLeg =
  (distNm: number, from: FixAt, to: FixAt): FixAt =>
  (ctx) => {
    const a = from(ctx);
    const b = to(ctx);
    const legNm = Math.hypot(b.x - a.x, b.y - a.y);
    return lerp(a, b, (legNm + distNm) / legNm);
  };

export const LSGG_FIXES = {
  // ── Arrivals from the north-east: BENOT 2T, ULMES 2R, FRIBU 1R ───────────
  // These three run straight down the extended centreline to SAPRE.
  BENOT: at(47.057778, 7.172778),
  NEMOS: at(46.911944, 6.906667),
  VEROX: at(46.7275, 6.573333),
  ULMES: at(46.955, 7.2925),
  ESEVA: at(46.802222, 7.014722),
  VADAR: at(46.657222, 6.753611),

  // ── Arrivals from the north and west: AKITO 3R, DJL 2R, LUSAR 2R ─────────
  // All three merge at LIRKO and fly the **right** downwind, +6 NM.
  AKITO: at(47.213333, 6.648889),
  GG518: at(46.90722, 6.24889),
  BOLGI: at(46.667778, 5.938333),
  /** Dijon-Longvic VOR-DME 111.45, the DJL 2R entry. 74.8 NM out. */
  DJL: at(47.270778, 5.097333),
  GG517: at(46.93972, 5.43944),
  LUSAR: at(46.668888, 5.179444),
  SAUNI: at(46.62361, 5.48028),
  LIRKO: at(46.570833, 5.814167),
  DINIG: at(46.495278, 5.890556),
  SOVAD: at(46.3375, 6.048333),
  GG507: at(46.44083, 6.2),
  GG514: at(46.54028, 6.34694),

  // ── Arrivals from the south and east: BANKO 3R, KINES 2R, BELUS 3R ───────
  // BANKO and KINES merge at GOLEB, BELUS joins at BIVLO; all fly the **left**
  // downwind, −6 NM.
  BANKO: at(45.82, 7.055),
  GG520: at(45.95639, 6.76833),
  KINES: at(45.331389, 6.755278),
  GG519: at(45.52722, 6.70194),
  ROCCA: at(45.745278, 6.645556),
  GOLEB: at(46.051667, 6.5625),
  VALBU: at(46.08611, 6.48972),
  SUVEL: at(46.15139, 6.35083),
  BELUS: at(45.675278, 5.593889),
  /** Chambéry VOR-DME 115.40, an IAF on BELUS 3R. */
  CBY: at(45.881889, 5.757306),
  GG502: at(45.95389, 5.89917),
  PITOM: at(46.09472, 6.10194),
  BIVLO: at(46.19722, 6.25389),
  GG525: at(46.29833, 6.40222),
  GG512: at(46.39722, 6.54917),

  // ── Departures ──────────────────────────────────────────────────────────
  // Four of the five RWY 22 SIDs leave on 223° to PAS and turn there when
  // passing 7000. SOSAL 1J is the exception and turns at the field — see
  // `sids.ts`, where that difference is the whole reason the route works.
  /** Passeiry VOR-DME 116.60, 6.4 NM off the departure end on 225°. */
  PAS: at(46.163694, 5.999917),
  GG603: at(46.26861, 6.05778),
  DEREM: at(46.35664, 6.17625),
  KONIL: at(46.56844, 6.45836),
  GG602: at(46.11639, 6.06722),
  TINAM: at(46.36, 6.530556),
  MOLUS: at(46.443889, 6.679444),
  SOSAL: at(46.55806, 6.88444),
  RUMIL: at(45.86189, 5.98144),
  BEVEN: at(45.688611, 5.972778),
  ARGIS: at(45.971111, 5.599167),
  DEPUL: at(45.925, 5.49444),
  KELUK: at(46.555556, 5.685556),
  DIPIR: at(46.669167, 5.593056),
  ESAPI: at(45.89, 6.29028),
  VANAS: at(45.457222, 6.746944),
  MEDAM: at(45.264444, 6.94),
} as const;

const F = LSGG_FIXES;

/**
 * The nine fixes solved from a published leg, kept apart from the transcribed ones
 * so the distinction is visible rather than remembered. Each comment carries the
 * chart's own arithmetic, which is the check.
 */
export const LSGG_DERIVED = {
  /** 5.7 NM along BELUS → CBY. Chart: 5.7 + 8.5 = 14.2; measured 14.1. */
  RILTI: alongLeg(5.7, F.BELUS, F.CBY),

  /** 6.6 NM along ESAPI → VANAS. Chart: 6.6 + 25.7 = 32.3; measured 32.1. */
  ALPOZ: alongLeg(6.6, F.ESAPI, F.VANAS),

  /** 6.5 NM along BEVEN → RUMIL. Chart: 6.5 + 3.9 = 10.4; measured 10.4. */
  GG622: alongLeg(6.5, F.BEVEN, F.RUMIL),

  /** 6.2 NM past RUMIL on the same 179° line the chart runs through all four. */
  GG611: beyondLeg(6.2, F.BEVEN, F.RUMIL),

  /** 10.0 NM past KELUK on the 328° line the chart runs through GG617 and DIPIR. */
  GG617: beyondLeg(10.0, F.DIPIR, F.KELUK),

  /**
   * 4.4 and 11.4 NM past ESAPI, back up the MEDAM 1A trunk. The chart prints 141°
   * for these two legs and 140° for ESAPI → VANAS, so extending the latter costs
   * one degree — 0.08 NM at 4.4 NM, and under 0.2 at 11.4.
   */
  GG616: beyondLeg(4.4, F.VANAS, F.ESAPI),
  GG619: beyondLeg(11.4, F.VANAS, F.ESAPI),

  /**
   * 20.7 NM from VADAR on 067°, the reciprocal of the charted 247°. The one fix
   * placed off a bearing — see the note at the top of this file. It falls 56.4 NM
   * out and is clipped to the boundary, so what survives is the leg's direction.
   */
  FRIBU: fromFix(20.7, 67, F.VADAR),
} as const;
