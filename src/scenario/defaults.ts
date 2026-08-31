/**
 * What a field gets when it does not say otherwise.
 *
 * These are here rather than in `src/sim/constants.ts` because they are facts
 * about a field — its flows, its runway turnaround, its frequencies — even when
 * every field so far happens to agree about them. A default keeps a scenario file
 * short without putting field data back in the tunables file, and a field
 * overrides only what actually differs.
 */
import type { FacilitySpec, RunwayOpsSpec, RunwaySpec, TrafficSpec } from './types.js';

export const DEFAULT_TRAFFIC: TrafficSpec = {
  arrivalsPerHour: 25,
  departuresPerHour: 10,
  /**
   * How long a gate stays quiet after taking an arrival. Two aircraft on the same
   * route inside this would arrive already in trail with no room to fix it.
   */
  gateCooldownS: 90,
};

export const DEFAULT_RUNWAY_OPS: RunwayOpsSpec = {
  /**
   * Roll to roll between consecutive departures. 90 s covers the wake-turbulence
   * minimum behind a medium and the time the first needs to be airborne and clear
   * of the far end. It caps the runway at 40 departures an hour, comfortably above
   * the 20 the player can ask for — so a queue that grows is the *arrivals* eating
   * the runway, never the interval itself.
   */
  minDepartureIntervalS: 90,
  /**
   * A floor, not the test — the test is `airborneMarginS`, in time. It is here
   * because the real rule has a distance in it too: nothing is released with an
   * arrival this close however slowly it happens to be flying. At any normal
   * approach speed the clock binds a mile before this does.
   */
  holdFinalNm: 3.5,
  holdAfterLandingS: 60,
  /**
   * How long the arrival must still be from the threshold at the moment the
   * departure ahead of it rotates — computed from the arrival's actual ground
   * speed, so one still carrying speed blocks further out than one already slowed.
   *
   * The theoretical floor is about 8 s, the time an arrival takes to cover the
   * 0.3 NM at which an occupied runway would send it around. 40 s is five times
   * that: enough that a release is not one wobble from a go-around, and not so
   * much that the runway sits idle behind a gap it could have used.
   */
  airborneMarginS: 40,
};

export const DEFAULT_FACILITY: FacilitySpec = {
  towerFrequency: '119.1',
  departureFrequency: '124.7',
};

/** Runway furniture the scope draws, and the missed approach the field publishes. */
export const DEFAULT_RUNWAY: Required<Pick<RunwaySpec,
  'missedApproachAltitudeFt' | 'centerlineLengthNm' | 'centerlineTickNm'
>> = {
  missedApproachAltitudeFt: 3000,
  /** The primary visual sequencing aid: 20 NM of centreline, ticked every 2. */
  centerlineLengthNm: 20,
  centerlineTickNm: 2,
};
