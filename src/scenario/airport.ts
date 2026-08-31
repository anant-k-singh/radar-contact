/**
 * Compatibility shim: the active field, under the name the simulation still uses.
 *
 * A `Scenario` already has `runway`, `gates`, `elevationFt`, `arp` and `icao` at
 * its top level, so it *is* what the sim means by an airport. This file exists
 * only so the threading of `world.scenario` can land as its own change; it goes
 * away with the last `AIRPORT` import.
 */
import { DEFAULT_SCENARIO } from './registry.js';
import type { Scenario } from './types.js';

export type Airport = Scenario;
export type { EntryGate, Runway } from './types.js';

export const AIRPORT: Airport = DEFAULT_SCENARIO;
