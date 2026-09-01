/**
 * VABB's standard departures — three SIDs off runway 27, eight ways out.
 *
 * Charts: the two RWY 27 SID sheets — ANOLI 2A, and RAXET 2A / VEVAK 2A. Cited in
 * full in `airport.ts`, which also says why they are not in the repository.
 *
 * ## The shape, which is the reason branching SIDs exist
 *
 * All three charts start the same way: runway heading 270° to **MB364**, at or
 * above 2600 ft. From there the three diverge — ANOLI north, RAXET west, VEVAK
 * south — and each of those *then* fans out to the airways. So a SID here is a
 * trunk and a set of exits, and the compiler flattens each exit into its own route
 * (see `compileSid`). Every branch of one SID reports the turn its trunk flies,
 * which is the label the chart prints.
 *
 * Authored as chains of published bearings and distances, because that is the only
 * form the charts give: `from(MB364, 358, 12.8)` is literally the label on that
 * leg. MB364 itself is the exception and is placed in the departure frame, since
 * its position is a fact about the runway.
 *
 * ## What is truncated, and why the numbers differ from the chart
 *
 * Five exits leave the 60 NM airspace before their published fix: ISRIS is 88 NM
 * out, SAKUN 95, EXOLU 111, PPN 66, MB362 60.3. Each keeps its name and its
 * published track and has its last leg shortened to finish inside the boundary
 * with a leg to fly out on — which is the same truncation the arrivals get, and
 * the leg the aircraft actually leaves on. The shortened distance is noted at
 * each one.
 *
 * ## The two kinds of crossing restriction
 *
 * Both are here, which is unusual and is what this field is for:
 *
 * - **Under, close in.** The ANOLI and VEVAK trunks run north and south from
 *   MB364, 7 NM west of the field, and pass directly beneath the two arrival
 *   downwinds — which at that point are descending through about 6200–6500 ft.
 *   MB367 and MB368 carry an "at or below" 4000 across those crossings and release
 *   it 2 NM past them, so the level segment is twenty seconds rather than a mile
 *   of an aircraft that looks like it has forgotten to climb.
 * - **Over, further out.** XOPAL's published "at or above FL120" and OMGIX's
 *   "FL100" are the chart's own, and they are what separates those two branches
 *   where they cross an arrival inbound leg 25–50 NM out: the arrival is down at
 *   6500–7700 by then and the departure has been climbing for eight minutes. The
 *   validator checks both senses; the conformance suite flies every type down
 *   every branch and checks the separation that actually happens.
 */
import { depart } from '../../geometry.js';
import type { SidFixSpec, SidSpec } from '../../types.js';
import { from } from './geometry.js';

/**
 * The first fix on every SID, on runway heading off the departure end.
 *
 * 6.5 NM, derived rather than read: the charts annotate this leg with a figure the
 * scan does not resolve, but they also publish a minimum climb gradient of
 * 400 ft/NM up to the 2600 ft crossing here, and 2600/400 is 6.5.
 */
const MB364 = depart(6.5, 0);
const MB364_FIX: SidFixSpec = { name: 'MB364', at: MB364, minAltitudeFt: 2600 };

/** Published ceiling across an arrival downwind, and where it is released. */
const CROSSING_MAX_FT = 4000;
/**
 * How far past MB364 the downwind crossings happen, and where the restriction
 * ends. The downwinds are 7 NM abeam and the trunks leave MB364 within 2° of due
 * north and south, so the crossing is at 7 NM and the release 2 NM beyond it.
 */
const RELEASE_NM = 9.1;

const ANOLI = from(MB364, 358, 12.8);
const XOPAL = from(ANOLI, 42, 12.9);
const MB373 = from(XOPAL, 79, 10.2);
const MB365 = from(MB373, 78, 17.2);
const MB399 = from(ANOLI, 341, 12.3);
const RAXET = from(MB364, 277, 37.4);
const VEVAK = from(MB364, 182, 18.5);
const OMGIX = from(VEVAK, 89, 12.2);
const DOGAP = from(OMGIX, 87, 26.2);

export const VABB_SIDS: readonly SidSpec[] = [
  {
    name: 'ANOLI2A',
    fixes: [
      MB364_FIX,
      { name: 'MB367', at: from(MB364, 358, RELEASE_NM), maxAltitudeFt: CROSSING_MAX_FT },
      { name: 'ANOLI', at: ANOLI, maxAltitudeFt: 10_000 },
    ],
    exits: [
      {
        name: 'SEKVI',
        fixes: [
          { name: 'XOPAL', at: XOPAL, minAltitudeFt: 12_000 },
          { name: 'MB373', at: MB373 },
          { name: 'MB365', at: MB365 },
          { name: 'SEKVI', at: from(MB365, 85, 18.4) },
        ],
      },
      // ISRIS is 40.6 NM beyond MB361 and outside the boundary; MB361 itself is
      // published at 47.3 NM on 009°, shortened to 32.
      { name: 'MB361', fixes: [{ name: 'MB361', at: from(ANOLI, 9, 32) }] },
      // EXOLU is 51.6 NM beyond MB381. MB381 is published at 33.2 NM, shortened to 20.
      {
        name: 'MB381',
        fixes: [
          { name: 'MB399', at: MB399 },
          { name: 'MB381', at: from(MB399, 340, 20) },
        ],
      },
    ],
  },
  {
    // No restriction on this trunk: it runs west at 0–5 NM north of the
    // centreline, and the nearest arrival track is the northern downwind, 6.6 NM
    // away at its closest. The one direction with nothing above it.
    name: 'RAXET2A',
    fixes: [MB364_FIX, { name: 'RAXET', at: RAXET }],
    exits: [
      // DARMI is 97.1 NM beyond MB370, which is published at 21.9 NM, shortened to 14.
      { name: 'MB370', fixes: [{ name: 'MB370', at: from(RAXET, 224, 14) }] },
      // SAKUN is published at 57.8 NM on 298°, shortened to 10.
      { name: 'SAKUN', fixes: [{ name: 'SAKUN', at: from(RAXET, 298, 10) }] },
    ],
  },
  {
    name: 'VEVAK2A',
    fixes: [
      MB364_FIX,
      { name: 'MB368', at: from(MB364, 182, RELEASE_NM), maxAltitudeFt: CROSSING_MAX_FT },
      { name: 'VEVAK', at: VEVAK, maxAltitudeFt: 9000 },
    ],
    exits: [
      {
        // PPN is published at 31.3 NM beyond DOGAP on 116°, shortened to 20.
        name: 'PPN',
        fixes: [
          { name: 'OMGIX', at: OMGIX, minAltitudeFt: 10_000 },
          { name: 'DOGAP', at: DOGAP },
          { name: 'PPN', at: from(DOGAP, 116, 20) },
        ],
      },
      { name: 'ONAPA', fixes: [{ name: 'ONAPA', at: from(VEVAK, 202, 19.9) }] },
      // MB362 is published at 43.5 NM on 162°, shortened to 26.
      { name: 'MB362', fixes: [{ name: 'MB362', at: from(VEVAK, 162, 26) }] },
    ],
  },
];
