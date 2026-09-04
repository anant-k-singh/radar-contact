/**
 * LSGG — Genève Aéroport (Cointrin), Geneva. Runway 22.
 *
 * The third field, and the first that is not at sea level: 1411 ft, in a valley
 * with the Jura 6 NM to the north-west and the Alps filling the whole south-east
 * quadrant. That single fact is what the field is about — see `terrain.ts`.
 *
 * ## Sources
 *
 * Transcribed from the published charts listed below. **They are not in this
 * repository and must not be** — they are skyguide's copyright and this is an
 * AGPL-3.0 project. `docs/charts/` is gitignored; put local copies there if you
 * have them.
 *
 * - **STAR CHART NO. 01**, RNAV 1 ARRIVALS RWY 04, 22 — AKITO/DJL/LUSAR, rev 31 OCT 24.
 * - **STAR CHART NO. 03**, RNAV 1 ARRIVALS RWY 22 — BANKO/BELUS/KINES, rev 31 OCT 24.
 * - **STAR CHART NO. 05**, RNAV 1 ARRIVALS RWY 22 — BENOT/FRIBU/ULMES, rev 31 OCT 24.
 * - **SID CHART NO. 22-04 DIPIR 1A, 22-05 KONIL 1R, 22-07 MEDAM 1A, 22-09 SOSAL 1L**,
 *   plus the BEVEN and DEPUL sheets, all RNAV 1 SID RWY 22, rev 31 OCT 24.
 *
 * Unlike VABB's AIP supplement these carry **no coordinate table**, so the fix
 * positions come from a public navigation database and are checked against the
 * charts leg by leg — see `fixes.ts`, which is where that check is recorded.
 *
 * ## Where the numbers come from
 *
 * AD ELEV **1411 ft** and TRANS ALT 7000 ft, printed on every sheet. The MSA rose
 * gives 7000 within 10 NM, and 7000 / 10600 by sector out to 25 NM.
 *
 * The 04/22 pavement is 3900 m bearing **226°/046° true**, and its two thresholds
 * straddle the ARP — so the compiler's "centre the runway on the ARP" is not an
 * approximation here, it is where the runway is.
 *
 * ## Magnetic and true differ by 2.6° here, and it matters
 *
 * §3.1 A3 treats magnetic as true, which VABB could afford at 0.75° W. Geneva is
 * **2.6° E**, and the fixes are at true coordinates, so stating the chart's 223°
 * magnetic as `courseDeg` would rotate the runway against its own procedures and
 * splay the two published downwinds by 0.8 NM over their length. `courseDeg` is
 * therefore the **true** course, and the two statements agree: the chart's 223°
 * magnetic *is* 226° true. The runway keeps its published id.
 *
 * That figure is confirmed twice over, from sources that know nothing of each
 * other: forcing the published downwinds parallel gives 225.6°, and the aerodrome
 * data gives 226°.
 *
 * ## What is deliberately not here
 *
 * The **RWY 04 procedures** — the 2N variants of AKITO, DJL and LUSAR, which turn
 * the other way at SOVAD and end at GG503/INDIS. Every chart transcribed is RWY 22
 * (§3.1 A2). **BENOT 2R** likewise: it and BENOT 2T start at the same fix, and the
 * model allows one STAR per gate, so the field flies 2T.
 *
 * The **enroute transitions** feeding the nine entry fixes, for the reason VABB
 * truncates its own: a scope that held them would make the 30 NM where the session
 * is played unreadable. Unlike VABB's, these fixes are **not** on one arc — they
 * run from BELUS at 40 NM to DJL at 75 — so `clipToRange` moves six of them in to
 * the boundary along their own published legs, and three simply sit inside it.
 *
 * The grass 04L/22R is closed, so there is no `inactiveRunways` here.
 */
import { clipToRange, extendToRange } from '../../geometry.js';
import type { AirspaceSpec, EntryGateSpec, RunwaySpec } from '../../types.js';
import { LSGG_DERIVED as D, LSGG_FIXES as F } from './fixes.js';

/**
 * The top of what the controller may assign.
 *
 * Set by the handovers rather than chosen, as at VABB: LUSAR publishes FL200 and
 * sits *inside* the boundary at 46 NM, so the controller has to be able to hold an
 * arrival at 20,000. It lifts the default `Sid.topFt` to 21,000, which the MEDAM
 * and SOSAL departures both reach.
 */
export const CEILING_FT = 20_000;

/**
 * The boundary, and therefore where Center hands over.
 *
 * 55 rather than a round 50 because of what sits between the two: NEMOS (52.3 NM),
 * ESEVA (50.6) and GG517 (50.4) are all published fixes on the routes, and two of
 * them are holding fixes. A 50 NM boundary clips the BENOT gate *past* NEMOS and
 * loses all three; 55 keeps them on the scope while still clipping the six distant
 * entries.
 */
export const GATE_RANGE_NM = 55;

/**
 * 3900 m of pavement bearing 226°/046° true — the chart's 223° magnetic, see the
 * note above. Centred on the ARP by the compiler, which puts the RWY 22 threshold
 * at the north-east end, so the arrivals come down the lake and the departures go
 * out over the Rhône valley.
 */
export const LSGG_RUNWAY: RunwaySpec = {
  id: '22',
  courseDeg: 226,
  lengthNm: 2.11,
  /**
   * Not transcribed: the ILS 22 approach chart is not among the sources. Set to
   * the MVA, which is also the platform every arrival is delivered to — the same
   * altitude a missed approach here would be climbing to anyway.
   */
  missedApproachAltitudeFt: 7000,
  /** 25 rather than 20: SAPRE, where every arrival ends, is 19.7 NM out. */
  centerlineLengthNm: 25,
  centerlineTickNm: 2,
};

export const LSGG_AIRSPACE: AirspaceSpec = {
  radiusNm: GATE_RANGE_NM,
  /**
   * The northern and southern caps are cut off here (§3.1). AKITO enters on 021°,
   * which at 55 NM is 51 NM north, so this is about as tight as the gates allow.
   */
  halfHeightNm: 53,
  /**
   * 5000: two steps below the 7000 the charts deliver every arrival to.
   *
   * The published MSA within 10 NM *is* 7000, and so are BIVLO, PITOM, INDIS and
   * the SAPRE and GEVEA holding bases — but an MVA at the platform leaves the
   * controller nothing to descend into, and one step below it leaves barely
   * enough: an aircraft that misses the localizer intercept has to be taken down
   * again to re-establish, and 6000 gave that one 1000 ft try.
   *
   * The ground allows it where it matters. The extended centreline is clear of
   * shaded terrain from the threshold to 26 NM at ±3 NM either side — the nearest
   * 4000 band is the Salève, 5 NM left of course — so the corridor an arrival is
   * actually vectored in is the one part of this airspace that is flat.
   *
   * It is still higher than either shipped field's because the ground elsewhere
   * is: 53% of this airspace needs an MSA of 4000 or more against a field
   * elevation of 1411. The terrain shading is **not** derived from this and does
   * not move with it — `terrain.ts` states its own bands. Where the two disagree
   * the shading is the honest one: this is a floor on what may be assigned, not a
   * claim about the ground, the same contradiction VABB documents.
   */
  mvaFt: 5000,
  ceilingFt: CEILING_FT,
  rangeRingsNm: [10, 20, 30, 40, 50],
};

/**
 * Nine gates, one per published RWY 22 STAR, each placed where its own inbound leg
 * crosses the 55 NM boundary — or at its published coordinate, for the three that
 * are already inside it.
 *
 * They feed **three streams**, which is the shape of this field: the north-west
 * three merge at LIRKO and fly the right downwind, the south-east three merge at
 * GOLEB or BIVLO and fly the left downwind, and the north-east three run straight
 * down the extended centreline. All nine end at SAPRE.
 *
 * ## The weights
 *
 * Derived as VABB's are — every nonstop destination weighted by monthly frequency
 * and mapped onto the bearing it arrives on, over 5,334 flights a month across 124
 * routes. Two sectors are then hand-split, because bearing alone is the wrong tool
 * where gates are close together: BENOT, ULMES and FRIBU lie within 13° of each
 * other and are three *parallel* entries off the Swiss plateau fed by different
 * airways, so their sector's 10% is spread across them rather than landing almost
 * entirely on FRIBU; DJL and LUSAR are eased the same way. They sum to 100 so they
 * read as percentages, though nothing requires it.
 */
export const LSGG_GATES: readonly EntryGateSpec[] = [
  /** 212°, published 40.0 NM — 15 inside the boundary, so the handover is `RCBE`
   *  on the edge and BELUS itself is the route's first fix. Madrid, Porto,
   *  Lisbon, Barcelona, Palma. */
  { name: 'RCBE', at: extendToRange(GATE_RANGE_NM, F.BELUS, D.RILTI), weight: 28 },
  /** 326°, published 74.8 NM. Heathrow, Paris CDG, Amsterdam, Brussels, Gatwick. */
  { name: 'DJL', at: clipToRange(GATE_RANGE_NM, F.GG517, F.DJL), weight: 21 },
  /** 123°, published 46.6 NM — inside, so the handover is `RCBA` on the edge.
   *  Rome, Istanbul, Athens, Pristina. */
  { name: 'RCBA', at: extendToRange(GATE_RANGE_NM, F.BANKO, F.GG520), weight: 18 },
  /** 154°, published 60.7 NM. Nice, Tunis, Olbia, Catania, the Maghreb. */
  { name: 'KINES', at: clipToRange(GATE_RANGE_NM, F.GG519, F.KINES), weight: 8 },
  /** 304°, published 46.4 NM — inside, so the handover is `RCLU` on the edge.
   *  LUSAR is the one fix with a published entry level (FL200), which is what
   *  sets the ceiling. Nantes, the North Atlantic. */
  { name: 'RCLU', at: extendToRange(GATE_RANGE_NM, F.LUSAR, F.SAUNI), weight: 8 },
  /** 021°, published 62.7 NM. Frankfurt, Copenhagen, Luxembourg, Scandinavia. */
  { name: 'AKITO', at: clipToRange(GATE_RANGE_NM, F.GG518, F.AKITO), weight: 6 },
  /** 042°, published 66.1 NM. The northern share of the Swiss plateau flow. */
  { name: 'BENOT', at: clipToRange(GATE_RANGE_NM, F.NEMOS, F.BENOT), weight: 4 },
  /** 055°, 56.4 NM, barely outside. Zurich, Vienna, Munich, Warsaw. */
  { name: 'FRIBU', at: clipToRange(GATE_RANGE_NM, F.VADAR, D.FRIBU), weight: 4 },
  /** 049°, published 65.3 NM. Prague, Berlin, and the long-haul from Asia. */
  { name: 'ULMES', at: clipToRange(GATE_RANGE_NM, F.ESEVA, F.ULMES), weight: 3 },
];
