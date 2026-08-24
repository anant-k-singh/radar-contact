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

  // ── Departure performance (§4.7) ──────────────────────────────────────────
  // These three are per *type* rather than per class, because for once there is
  // real per-type data to use: the whole airspace (0–12,000 ft) sits inside the
  // EUROCONTROL APD's "initial climb" and "climb to FL150" bands, so the table
  // covers exactly the regime a departure is flown in here.
  /** Rotation speed — APD take-off V2. */
  v2Kts: Kts;
  /** IAS flown from rotation until the flaps are up — APD initial-climb IAS. */
  initialClimbKts: Kts;
  /**
   * Rate of climb at take-off thrust below 5000 ft — APD initial-climb ROC.
   * It is the *nominal* rate: while the aircraft is still accelerating to 250 kt
   * the thrust budget splits between the two, which is the real trade a crew
   * makes in the acceleration segment rather than an artefact of the model.
   *
   * 3000 fpm is the ceiling used here. The APD figure is what the type can do
   * at a light weight; a loaded airliner does not use all of it, and anything
   * steeper reads on the scope as a fighter rather than as traffic — so the one
   * type the database puts above it (E190, 3400) is entered at 3000.
   */
  departureClimbFpm: Fpm;
}

/** What a performance class fixes; the departure figures are per type. */
type ClassDefaults = Omit<AircraftType, 'code' | 'v2Kts' | 'initialClimbKts' | 'departureClimbFpm'>;

const MEDIUM = {
  wake: 'M',
  vappKts: 140,
  minCleanKts: 190,
  descentFpm: 1600,
  climbFpm: 1700,
  budgetScale: 1,
} satisfies ClassDefaults;

const HEAVY = {
  wake: 'H',
  vappKts: 145,
  minCleanKts: 200,
  descentFpm: 1400,
  climbFpm: 1500,
  budgetScale: 0.85,
} satisfies ClassDefaults;

/**
 * Two performance classes for everything an *arrival* does — approach speeds and
 * descent rates are close enough within a class that a database would buy
 * nothing — plus per-type departure figures, which are quoted straight from the
 * EUROCONTROL Aircraft Performance Database. Those are the numbers ATC training
 * uses, and they differ enough between types (a B738 out-climbs an A320 by
 * 500 fpm) that flattening them to a class would throw away real character.
 */
export const AIRCRAFT_TYPES: readonly AircraftType[] = [
  { code: 'A320', ...MEDIUM, v2Kts: 145, initialClimbKts: 175, departureClimbFpm: 2500 },
  { code: 'B738', ...MEDIUM, v2Kts: 145, initialClimbKts: 165, departureClimbFpm: 3000 },
  { code: 'E190', ...MEDIUM, v2Kts: 138, initialClimbKts: 190, departureClimbFpm: 3000 },
  { code: 'A332', ...HEAVY, v2Kts: 145, initialClimbKts: 175, departureClimbFpm: 2000 },
  { code: 'B77W', ...HEAVY, v2Kts: 168, initialClimbKts: 200, departureClimbFpm: 3000 },
  { code: 'B788', ...HEAVY, v2Kts: 165, initialClimbKts: 190, departureClimbFpm: 2700 },
];
