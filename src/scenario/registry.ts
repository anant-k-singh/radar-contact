/**
 * Every field the simulator knows about, compiled and ready to fly.
 *
 * Adding an airport is a folder under `fields/` and a line here. Nothing outside
 * `src/scenario/` names a field.
 */
import { compileScenario } from './compile.js';
import { ZZZZ } from './fields/zzzz/index.js';
import type { Scenario } from './types.js';

export const SCENARIOS: readonly Scenario[] = [compileScenario(ZZZZ)];

export const DEFAULT_SCENARIO: Scenario = SCENARIOS[0]!;

export function scenarioById(id: string): Scenario | undefined {
  const wanted = id.trim().toUpperCase();
  return SCENARIOS.find((scenario) => scenario.id.toUpperCase() === wanted);
}
