/** Compatibility shim — see airport.ts. The active field's departure routes. */
import { DEFAULT_SCENARIO } from './registry.js';
import type { Sid } from './types.js';

export type { Sid, SidWaypoint } from './types.js';
export { ceilingAtFt } from './routes.js';

export const SIDS: readonly Sid[] = DEFAULT_SCENARIO.sids;

export function sidByName(name: string): Sid | undefined {
  return SIDS.find((sid) => sid.name === name);
}
