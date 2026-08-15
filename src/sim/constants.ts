/**
 * Every tunable number in the simulation, in one file.
 * See docs/REQUIREMENTS.md for the derivation and source of each value.
 */
import { FT_PER_NM, KTS_TO_FT_PER_SEC, G_FT_PER_SEC2, toRad } from './units.js';

// ── Loop rates (§5) ─────────────────────────────────────────────────────────
export const PHYSICS_HZ = 20;
export const PHYSICS_DT = 1 / PHYSICS_HZ; // 0.05 s
export const RADAR_PERIOD_S = 1.0; // data blocks sample at 1 Hz
export const RENDER_FPS = 20;
/**
 * History dots are laid down every 10 s rather than every radar return: at
 * 250 kt on a 50 NM scope a 1 Hz dot moves about half a pixel, so a 1 Hz trail
 * is invisible. Ten dots at 10 s gives 100 s of history — well past the minute
 * the leader line projects forward, so a turn that began before the last
 * instruction is still on the scope, and the dots are far enough apart to read
 * a speed off their spacing.
 */
export const HISTORY_PERIOD_S = 10.0;
export const TRAIL_LENGTH = 10;

// ── Airspace (§3) ───────────────────────────────────────────────────────────
export const AIRSPACE_RADIUS_NM = 50;
/**
 * The circle's northern and southern caps are cut off by chords at this
 * latitude (§3.1). Those extremities were dead airspace — no gate, no route,
 * nothing but the compass rose — and cutting them lets the scope draw the same
 * 50 NM of usable width at a bigger scale, since the height no longer has to
 * carry 100 NM of it. The four gates sit at |y| = 38.3 NM, so 42 keeps them
 * inside with room for their markers and labels.
 */
export const AIRSPACE_HALF_HEIGHT_NM = 42;
/** How close to the boundary an outbound aircraft gets its warning. */
export const EXIT_WARN_MARGIN_NM = 5;
export const MVA_FT = 2000;
export const CEILING_FT = 12_000;
export const RANGE_RINGS_NM = [10, 20, 30, 40, 50];
export const CENTERLINE_LENGTH_NM = 20;
export const CENTERLINE_TICK_NM = 2;

// ── Player authority (§3.3) ─────────────────────────────────────────────────
export const HEADING_STEP_DEG = 10;
export const ALTITUDE_STEP_FT = 1000;
export const SPEED_STEP_KTS = 10;
export const SPEED_MAX_KTS = 250;
export const SPEED_FLOOR_CLEAN_KTS = 180; // outside 20 track miles
export const SPEED_FLOOR_LOW_KTS = 160; // within 20 track miles
export const CONFIG_RANGE_NM = 20; // IF 6.15.8 "20 track miles"

// ── Flight dynamics (§4.3) ──────────────────────────────────────────────────
export const BANK_DEG = 25;
/** ω = 1091·tan(bank)/TAS → 509/TAS at 25° of bank. */
export const TURN_COEFF = 1091 * Math.tan(toRad(BANK_DEG));
export const MAX_TURN_RATE_DEG_S = 3.0; // standard rate cap

export const ENERGY_BUDGET_FPM = 2500; // idle + partial speedbrake dissipation
export const THRUST_BUDGET_FPM = 2200; // climb + accelerate capability
export const MAX_DECEL_KTS_S = 1.0;
export const MAX_ACCEL_KTS_S = 0.8;
export const MIN_SPEED_RATE_KTS_S = 0.3; // guaranteed, taken back out of vertical rate
export const ALT_CAPTURE_FT = 200; // vertical rate tapers inside this
export const ALT_CAPTURE_MIN_FRACTION = 0.15;
export const SPEED_CAPTURE_KTS = 0.5;

// ── Glideslope / localizer (§6) ─────────────────────────────────────────────
export const GS_ANGLE_DEG = 3;
/** Feet of glideslope altitude per NM from the threshold: 318.4 ft/NM. */
export const GS_FT_PER_NM = FT_PER_NM * Math.tan(toRad(GS_ANGLE_DEG));
export const LOC_RANGE_NM = 25; // localizer service volume
/**
 * The intercept window (§6.1a). These are tested at the moment the aircraft
 * reaches the localizer, not when the clearance is given: a clearance is a
 * prediction, and the controller is allowed to make one that has not come true
 * yet. Failing any of them at the localizer means the aircraft flies through it.
 */
export const MAX_INTERCEPT_ANGLE_DEG = 45;
export const MAX_INTERCEPT_SPEED_KTS = 230; // the published STAR speed
export const LEVEL_VS_LIMIT_FPM = 200; // "level" test at the localizer
export const IDEAL_INTERCEPT_ANGLE_DEG = 30; // IF 6.11.3 — soft warning beyond
export const LOC_CAPTURE_XTK_NM = 0.5;
export const ESTABLISHED_XTK_NM = 0.3; // IF 6.14.2 — aligned with the centerline
export const ESTABLISHED_HDG_DEG = 5;
export const GS_CAPTURE_WINDOW_FT = 60;
export const PURSUIT_LEAD_NM = 2.5; // localizer tracking lead distance
export const MAX_LOC_CORRECTION_DEG = 25;

// ── Approach speed schedule (§6.2) ──────────────────────────────────────────
export const APPROACH_SPEED_GATES: ReadonlyArray<{ beyondNm: number; kts: number }> = [
  { beyondNm: 12, kts: 250 },
  { beyondNm: 8, kts: 210 },
  { beyondNm: 5, kts: 180 },
];
export const FINAL_SPEED_NM = 5; // inside this, Vapp regardless of assignment

// ── Separation (§9) ─────────────────────────────────────────────────────────
export const SEP_HORIZ_NM = 3.0;
export const SEP_VERT_FT = 1000;
export const ALERT_RED_HORIZ_NM = 1.5;
export const ALERT_RED_VERT_FT = 500;
export const CONFLICT_PREDICT_S = 90;
export const IN_TRAIL_MIN_NM = 3.0;
/**
 * Sequencing gap (§9.3). The runway, not the radar, sets the landing interval:
 * the aircraft ahead has to land, roll out and vacate first. That gap has to be
 * built while there is still room to build it, and it erodes on the way in as
 * the pair slows, so **at 10 NM and beyond** the minimum is 4 NM. Inside 10 NM
 * the geometry is set and the ordinary 3 NM radar minimum applies again.
 */
export const IN_TRAIL_SEQUENCING_MIN_NM = 4.0;
export const IN_TRAIL_SEQUENCING_RANGE_NM = 10.0;

// ── Go-around (§6.2) ────────────────────────────────────────────────────────
export const GO_AROUND_GATE_NM = 5.0; // stability is enforced inside this
export const GO_AROUND_IN_TRAIL_NM = 2.5;
export const GO_AROUND_ABOVE_GS_FT = 1000;
export const GO_AROUND_OVERSPEED_KTS = 45; // above Vapp
export const GO_AROUND_ALT_FT = 3000;

// ── Traffic generation (§4.4) ───────────────────────────────────────────────
export const FLOW_DEFAULT_PER_HOUR = 25;
export const FLOW_MIN_PER_HOUR = 10;
export const FLOW_MAX_PER_HOUR = 40;
export const MIN_SPAWN_INTERVAL_S = 45;
export const GATE_COOLDOWN_S = 90;
export const SPAWN_VETO_NM = 5;
export const SPAWN_VETO_FT = 1000;
export const ENTRY_ALTITUDE_FT = 9000;
/** Gates whose geometry gives a short run to the localizer arrive lower. */
export const ENTRY_ALTITUDE_NEAR_FT = 8000;
export const ENTRY_SPEED_KTS = 250;

// ── STARs (§4.5) ────────────────────────────────────────────────────────────
/** Published altitude on the outer leg of the north routes. */
export const STAR_INTERMEDIATE_ALT_NORTH_FT = 7000;
/** The south routes are longer and start 1000 ft higher, so their outer leg is too. */
export const STAR_INTERMEDIATE_ALT_SOUTH_FT = 8000;
/** Published altitude on the last leg — the platform the vectors start from. */
export const STAR_PLATFORM_ALT_FT = 5000;
/** Published speed from the platform fix onwards. */
export const STAR_ARRIVAL_SPEED_KTS = 230;
/** Sequencing tolerance at the last fix of a STAR. */
export const STAR_FIX_CAPTURE_NM = 0.5;
/** Cap on fly-by turn anticipation, so a near-reversal cannot cut half the route. */
export const STAR_MAX_ANTICIPATION_NM = 6;

// ── Holding (§4.6) ──────────────────────────────────────────────────────────
/**
 * Standard holding speed below 14,000 ft for civil aircraft (ICAO Doc 8168 /
 * FAA AIM 5-3-8: 230 kt). It is also the published STAR arrival speed, so an
 * aircraft sent into the pattern from the outer legs has one deceleration to
 * make and nothing else changes.
 */
export const HOLD_SPEED_KTS = 230;
/** Standard outbound leg below 14,000 ft: one minute of straight flight. */
export const HOLD_LEG_S = 60;

// ── Pilot reaction (§7.2) ───────────────────────────────────────────────────
/** An instruction is read back and flown 1–3 s after it is transmitted. */
export const PILOT_DELAY_MIN_S = 1.0;
export const PILOT_DELAY_MAX_S = 3.0;
/**
 * Minimum gap the crew leaves between an instruction and an approach clearance
 * transmitted on top of it. "Turn left 210, cleared ILS" is one transmission,
 * so the turn must not be flown *after* the clearance — where it would read as
 * a vector off the approach and cancel it (§7.2).
 */
export const PILOT_ORDER_GAP_S = 0.05;

// ── Handoff (§10) ───────────────────────────────────────────────────────────
export const TOWER_FREQUENCY = '119.1';

// ── Session stats (§8) ──────────────────────────────────────────────────────
/**
 * Landing rate is quoted over a trailing 12 minutes of sim time rather than the
 * whole session, so it reads as "how the last few minutes are going" — the
 * number a controller would compare against the arrival flow.
 */
export const LANDING_RATE_WINDOW_S = 720;
/** Below this much elapsed time the sample is too short to extrapolate. */
export const LANDING_RATE_MIN_ELAPSED_S = 120;

// ── Misc ────────────────────────────────────────────────────────────────────
export const MESSAGE_LOG_MAX = 60;
export const MESSAGE_LOG_VISIBLE = 5;
/** How long the scope shows the assigned-heading vector after a turn is given. */
export const HEADING_HINT_S = 5;
/**
 * Vertical rate is displayed rounded to this step, and suppressed below it —
 * the readout answers "is it going up, down, or holding", and an unrounded
 * figure jittering by tens of feet a minute reads as noise rather than trend.
 */
export const VS_DISPLAY_STEP_FPM = 50;

/**
 * Feet of energy-equivalent altitude per knot of speed change at a given TAS.
 * Δh = (V/g)·ΔV with V in ft/s — at 250 kt this is 22.1 ft per knot,
 * so a 20 kt reduction "costs" 443 ft of altitude.
 */
export function energyFtPerKnot(tasKts: number): number {
  return (tasKts * KTS_TO_FT_PER_SEC * KTS_TO_FT_PER_SEC) / G_FT_PER_SEC2;
}
