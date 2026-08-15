import type { Fpm, Kts } from '../sim/units.js';

export type WakeCategory = 'M' | 'H';

export interface AircraftType {
  code: string;
  wake: WakeCategory;
  /** Final approach speed. */
  vappKts: Kts;
  /** Slowest speed in a clean configuration. */
  minCleanKts: Kts;
  descentFpm: Fpm;
  climbFpm: Fpm;
  /** Scales the energy/thrust budgets — heavies change state more slowly. */
  budgetScale: number;
}

const MEDIUM = {
  wake: 'M',
  vappKts: 140,
  minCleanKts: 190,
  descentFpm: 1600,
  climbFpm: 1700,
  budgetScale: 1,
} satisfies Omit<AircraftType, 'code'>;

const HEAVY = {
  wake: 'H',
  vappKts: 145,
  minCleanKts: 200,
  descentFpm: 1400,
  climbFpm: 1500,
  budgetScale: 0.85,
} satisfies Omit<AircraftType, 'code'>;

/** Two performance classes, several type codes. Enough character without a performance database. */
export const AIRCRAFT_TYPES: readonly AircraftType[] = [
  { code: 'A320', ...MEDIUM },
  { code: 'B738', ...MEDIUM },
  { code: 'E190', ...MEDIUM },
  { code: 'A332', ...HEAVY },
  { code: 'B77W', ...HEAVY },
  { code: 'B788', ...HEAVY },
];
