/** Compatibility shim — see airport.ts. The active field's arrival routes. */
import { DEFAULT_SCENARIO } from './registry.js';
import type { Star } from './types.js';

export type { Star, StarConstraint, StarWaypoint } from './types.js';
export {
  altitudeAheadFt,
  ENTRY_FIX_INDEX,
  entryFix,
  raisedToLevel,
  speedAheadKts,
  starProfileAt,
} from './routes.js';

export const STARS: readonly Star[] = DEFAULT_SCENARIO.stars;

export function starForGate(gateName: string): Star | undefined {
  return STARS.find((star) => star.gate === gateName);
}

