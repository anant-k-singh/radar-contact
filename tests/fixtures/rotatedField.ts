/**
 * A second field, and the only thing that actually proves the first one is not
 * special.
 *
 * Deliberately awkward in every way ZZZZ is convenient. Its runway points east
 * rather than south, so every "north of the field" intuition is wrong; its field
 * elevation is not zero, so AGL and MSL differ; it has three gates rather than
 * four, and one of them publishes no arrival at all and is delivered on vectors.
 * Its airspace is smaller and cut closer.
 *
 * Not registered and not shipped — a scenario the conformance suite flies, so
 * that suite is a `describe.each` over more than one element and means something.
 */
import { compileScenario } from '../../src/scenario/compile.js';
import { depart, final, joinsDownwind } from '../../src/scenario/geometry.js';
import { AIRCRAFT_TYPES } from '../../src/scenario/aircraftTypes.js';
import { AIRLINES } from '../../src/scenario/airlines.js';
import type { Scenario, ScenarioSpec } from '../../src/scenario/types.js';

const CEILING_FT = 12_000;

export const ROTATED_SPEC: ScenarioSpec = {
  id: 'TEST',
  name: 'Rotated Test Field',
  icao: 'TEST',
  // Not sea level, so anything that confuses AGL with MSL is caught.
  elevationFt: 500,
  runway: { id: '09', courseDeg: 90, lengthNm: 1.8 },
  airspace: {
    radiusNm: 45,
    halfHeightNm: 40,
    mvaFt: 2500,
    ceilingFt: CEILING_FT,
    rangeRingsNm: [10, 20, 30, 40],
  },
  gates: [
    { name: 'WESTA', bearingDeg: 300 },
    { name: 'EASTA', bearingDeg: 120 },
    // No STAR: delivered on vectors, so it states its own handover itself.
    { name: 'NORTA', bearingDeg: 30, entryAltitudeFt: CEILING_FT, entrySpeedKts: 250 },
  ],
  stars: [
    {
      // Straight in to a corner abeam, then a level leg across the approach.
      name: 'WESTA1A',
      gate: 'WESTA',
      entryAltitudeFt: 10_000,
      entrySpeedKts: 250,
      fixes: [
        { name: 'WOKPU', fraction: 0.5, altitudeFt: 8000, speedKts: 250 },
        { name: 'WALVO', at: final(15, -18), altitudeFt: 6000, speedKts: 230 },
        { name: 'WARDI', at: final(15, -2), altitudeFt: 3000, speedKts: 200 },
      ],
    },
    {
      // Straight in until the track reaches the downwind offset, then out along
      // it — the leg the player turns base off.
      name: 'EASTA1A',
      gate: 'EASTA',
      entryAltitudeFt: CEILING_FT,
      entrySpeedKts: 250,
      fixes: [
        { name: 'ESUDI', fraction: 0.5, altitudeFt: 9000, speedKts: 250 },
        { name: 'ELOMS', at: joinsDownwind(6), altitudeFt: 7000, speedKts: 230 },
        { name: 'EPIKO', at: final(20, 6), altitudeFt: 3000, speedKts: 210 },
      ],
    },
  ],
  sids: [
    {
      // Crosses the downwind, so it has to be held down under it — the rule the
      // validator and the conformance suite both care about most.
      name: 'SOUTH1A',
      fixes: [
        { name: 'SNORV', at: depart(3.2, 0) },
        { name: 'SMORV', at: depart(3.2, 9), maxAltitudeFt: 4000 },
        { name: 'SEXIT', at: depart(3.2, 30) },
      ],
    },
    {
      // Straight out, with no arrival route anywhere near it.
      name: 'EAST1A',
      fixes: [
        { name: 'SNORV', at: depart(3.2, 0) },
        { name: 'EEXIT', at: depart(32, 0) },
      ],
    },
  ],
  fleet: AIRCRAFT_TYPES,
  airlines: AIRLINES,
};

export const ROTATED: Scenario = compileScenario(ROTATED_SPEC);
