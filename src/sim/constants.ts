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
 *
 * Twice that is kept, because the selected aircraft shows twice as many
 * (`TRAIL_DOTS_UNSELECTED` in the renderer): the extra history is worth having
 * for the one aircraft being worked, and is clutter on the other twenty-four.
 * The retained length is the longer of the two — a trail cannot be drawn from
 * dots that were never kept.
 */
export const HISTORY_PERIOD_S = 10.0;
export const TRAIL_LENGTH = 20;

// ── Airspace (§3) ───────────────────────────────────────────────────────────
/**
 * The size and shape of the airspace, its MVA, its ceiling, the range rings and
 * the centreline furniture are all in `Scenario.airspace` and `Scenario.runway`:
 * they are what distinguishes one field from another, and there is nothing left
 * to say about them that is true of every field.
 */
/** How close to the boundary an outbound aircraft gets its warning. */
export const EXIT_WARN_MARGIN_NM = 5;

// ── Player authority (§3.3) ─────────────────────────────────────────────────
export const HEADING_STEP_DEG = 10;
export const ALTITUDE_STEP_FT = 1000;
export const SPEED_STEP_KTS = 10;
export const SPEED_MAX_KTS = 250;
export const SPEED_FLOOR_CLEAN_KTS = 180; // outside 20 track miles
export const SPEED_FLOOR_LOW_KTS = 160; // within 20 track miles
export const CONFIG_RANGE_NM = 20; // the "20 track miles" configuration gate

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
/**
 * Deadband on the vertical: inside this, the rate is zero and the aircraft is
 * put *exactly* on its assignment (§4.3).
 *
 * The snap is the part that matters. Without it an aircraft rests wherever the
 * taper ran out — up to a foot off — and two aircraft stacked on adjacent
 * levels are 999 ft apart rather than 1000, which is a separation violation by
 * §9.1 against two assignments that are perfectly legal. The same argument
 * applies to `SPEED_CAPTURE_KTS`, where the residual half-knot fails the 230 kt
 * intercept ceiling of §6.1a for an aircraft assigned exactly 230.
 */
export const ALT_SETTLE_FT = 1;
export const SPEED_CAPTURE_KTS = 0.5;

// ── Glideslope / localizer (§6) ─────────────────────────────────────────────
export const GS_ANGLE_DEG = 3;
/** Feet of glideslope altitude per NM from the threshold: 318.4 ft/NM. */
export const GS_FT_PER_NM = FT_PER_NM * Math.tan(toRad(GS_ANGLE_DEG));
export const LOC_RANGE_NM = 25; // localizer service volume
/**
 * The two intercept windows (§6.1a, §6.1b). These are tested at the moment the
 * aircraft reaches the localizer and the moment it reaches the glideslope, not
 * when the clearance is given: a clearance is a prediction, and the controller
 * is allowed to make one that has not come true yet. The angle and speed
 * ceilings are the localizer's; the speed ceiling and the level test are the
 * glideslope's. Only the localizer's are *failures* — blowing through the
 * course cancels the clearance, whereas an aircraft that is not yet level under
 * the path simply has not captured it yet.
 */
export const MAX_INTERCEPT_ANGLE_DEG = 45;
export const MAX_INTERCEPT_SPEED_KTS = 230; // ceiling for both intercepts
export const LEVEL_VS_LIMIT_FPM = 200; // "level" test at the glideslope
export const IDEAL_INTERCEPT_ANGLE_DEG = 30; // preferred angle; soft warning beyond
export const LOC_CAPTURE_XTK_NM = 0.5;
export const ESTABLISHED_XTK_NM = 0.3; // aligned with the centerline
export const ESTABLISHED_HDG_DEG = 5;
export const GS_CAPTURE_WINDOW_FT = 60;
export const PURSUIT_LEAD_NM = 2.5; // localizer tracking lead distance
export const MAX_LOC_CORRECTION_DEG = 25;
/**
 * Pure-pursuit lead: a fraction of the range to run, floored so the aim point
 * never collapses onto the aircraft close in and capped by `PURSUIT_LEAD_NM`.
 * The aim point itself is held at least `PURSUIT_AIM_MIN_NM` off the threshold,
 * so tracking stays defined all the way to touchdown.
 */
export const PURSUIT_LEAD_FRACTION = 0.4;
export const PURSUIT_LEAD_MIN_NM = 0.6;
export const PURSUIT_AIM_MIN_NM = 0.2;
/** Cross-track inside which the aircraft counts as on course whichever way it drifts. */
export const XTK_ON_COURSE_NM = 0.05;
/**
 * Advisory thresholds on the clearance (§6.1). Poor technique rather than a
 * refusal: fast this far in, and an intercept given this close to the threshold.
 */
export const CLEARANCE_FAST_KTS = 210;
export const CLEARANCE_FAST_RANGE_NM = 15;
export const CLEARANCE_RUSHED_NM = 6;
/** How far above the field the wheels have to be for the landing to count. */
export const TOUCHDOWN_WINDOW_FT = 200;

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
/** Step the prediction window is sampled at. */
export const CONFLICT_PREDICT_STEP_S = 5;
/**
 * Nothing this far apart can breach the minima inside the prediction window, so
 * the extrapolation is skipped for the vast majority of pairs. Both are the
 * closure a pair could manage in 90 s with plenty of room to spare.
 */
export const CONFLICT_SCREEN_HORIZ_NM = 20;
export const CONFLICT_SCREEN_VERT_FT = 6000;
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
/**
 * The runway environment (§9.4). A departure inside both of these is separated
 * from the arrivals by the tower's runway rules rather than by radar minima, so
 * radar separation is not applied to it — the same exemption two aircraft on one
 * localizer already get. 1000 ft AGL is where a departure is clear of the
 * runway and its own wake; 5 NM covers the roll and the initial climb.
 */
export const RUNWAY_SEP_EXEMPT_FT = 1000;
export const RUNWAY_SEP_EXEMPT_NM = 5.0;

// ── Go-around (§6.2) ────────────────────────────────────────────────────────
export const GO_AROUND_GATE_NM = 5.0; // stability is enforced inside this
export const GO_AROUND_IN_TRAIL_NM = 2.5;
export const GO_AROUND_ABOVE_GS_FT = 1000;
export const GO_AROUND_OVERSPEED_KTS = 45; // above Vapp
/**
 * How close to the missed-approach altitude counts as levelled off, at which
 * point the aircraft is an ordinary inbound again and takes vectors.
 */
export const GO_AROUND_LEVEL_FT = 100;
/**
 * How close to the threshold an arrival may get with the runway still occupied
 * before it goes around (§6.2, §9.4).
 *
 * This is the backstop that makes the runway a real object rather than a rule
 * about departures. Whatever the release logic decided a minute ago, an
 * aircraft this close to a runway with something on it goes around, exactly as
 * it would in life. 0.3 NM is about 8 s at an approach speed — inside the
 * point where a crew would have committed, and outside the threshold itself.
 */
export const GO_AROUND_RUNWAY_OCCUPIED_NM = 0.3;

/**
 * Time acceleration the number keys select: key *i* gives 2^(i−1), so 1 is real
 * time and 5 is 16×.
 *
 * The doubling is the point. The key is the number of doublings rather than a
 * rate to be looked up, so the row is learnt once instead of memorised — and
 * extending it is adding a number here, not a case in three switch statements.
 */
export const TIME_SCALES: readonly number[] = [1, 2, 4, 8, 16];
/**
 * The subset the sidebar offers as buttons. The top rate is deliberately
 * keys-only: at 16× a session runs away from anyone watching it, so it is
 * something to reach for rather than something to hit by accident next to the
 * pause button. The key row still advertises all five.
 */
export const TIME_SCALE_BUTTONS: readonly number[] = TIME_SCALES.slice(0, -1);

// ── Traffic generation (§4.4) ───────────────────────────────────────────────
/**
 * The flow a field *offers* and how long its gates rest between arrivals are in
 * `Scenario.traffic`. What is here is the range the player may ask for, which is
 * a property of the control the sidebar gives them rather than of the field.
 */
export const FLOW_MIN_PER_HOUR = 5;
export const FLOW_MAX_PER_HOUR = 50;
export const MIN_SPAWN_INTERVAL_S = 45;
export const SPAWN_VETO_NM = 5;
export const SPAWN_VETO_FT = 1000;
/**
 * The altitude and speed Center hands an arrival over at are *not* here. They are
 * per-route — a route with a short run to the localizer has to be given the
 * height off lower — so they are published on the STAR, alongside the geometry
 * that justifies them (§4.5).
 */

// ── STARs (§4.5) ────────────────────────────────────────────────────────────
/**
 * The published crossing altitudes and speeds are *not* here: they are per-fix
 * and per-route, declared alongside the geometry in scenario/stars.ts, so one
 * crossing can be retuned without moving the other eleven. Only the values that
 * are genuinely global to every route live in this file.
 */
/** Sequencing tolerance at the last fix of a STAR. */
export const STAR_FIX_CAPTURE_NM = 0.5;
/** Cap on fly-by turn anticipation, so a near-reversal cannot cut half the route. */
export const STAR_MAX_ANTICIPATION_NM = 6;

// ── Departures and SIDs (§4.7) ──────────────────────────────────────────────
/**
 * The published crossing altitudes are *not* here — like the STARs', they are
 * per-fix and declared alongside the geometry in scenario/sids.ts. Only what is
 * global to every departure lives in this file.
 */
export const DEPARTURE_FLOW_MIN_PER_HOUR = 0;
/**
 * The top of the departure flow the player may ask for.
 *
 * Raised from 20 for VABB, which is the world's busiest single-runway airport and
 * whose whole character is that number: ~46 movements an hour declared, and 1,036
 * in a day on record. A field that opens at 20 departures an hour needs headroom
 * above what it opens at. `minDepartureIntervalS` still caps the runway itself at
 * 40 an hour, so this only widens what can be requested, never what can be
 * released.
 */
export const DEPARTURE_FLOW_MAX_PER_HOUR = 24;
export const DEPARTURE_FLOW_STEP_PER_HOUR = 5;
/**
 * How often the spawner reconsiders a departure while the flow is set to zero.
 * With no scheduled release there is nothing to bring forward, so turning the
 * flow back up would otherwise do nothing until the session was restarted.
 */
export const DEPARTURE_FLOW_IDLE_RECHECK_S = 10;
/**
 * Sharing the runway between the arrivals and the departures — the release
 * interval, how close an arrival blocks one, how long a landing holds one, and
 * the airborne margin — is in `Scenario.runwayOps`. Those are set by the runway's
 * length and how fast it can be turned round, so they belong to the field.
 */
/**
 * Where the hold-short queue turns amber and then red (§8.2).
 *
 * The queue length is the one number that tells the player their *arrivals* are
 * starving the runway — they have no authority over a departure, but the gaps
 * they leave on final are what releases one. Three deep is a final that is
 * working the runway hard; six deep is one that has stopped giving it back.
 */
export const DEPARTURE_QUEUE_WARN = 3;
export const DEPARTURE_QUEUE_ALERT = 6;

/**
 * Take-off acceleration on the ground, before `budgetScale`. Chosen so a medium
 * reaches V2 in about 35 s over 0.7 NM and a heavy in about 50 s over 1.1 NM —
 * both inside the 1.6 NM runway, which is what the ground roll is drawn against.
 */
export const TAKEOFF_ACCEL_KTS_S = 4.0;
/**
 * Height above the field at which the flaps come up and the aircraft accelerates
 * from its initial-climb IAS to the 250 kt climb speed. 3000 ft AGL is the
 * ordinary acceleration altitude for a noise-abatement departure.
 */
export const DEPARTURE_ACCEL_ALT_FT = 3000;
/** Climb speed once clean: the 250 kt limit below 10,000 ft, and our ceiling is lower. */
export const DEPARTURE_CLIMB_SPEED_KTS = 250;
/**
 * How much the published climb rate is given up below the acceleration altitude.
 *
 * The APD figure is the *clean* rate. Below the acceleration altitude the
 * aircraft is still in a take-off configuration with the flaps out, and the
 * extra drag costs it: it climbs away noticeably less steeply for the first
 * 3000 ft than it does once cleaned up.
 */
export const INITIAL_CLIMB_REDUCTION_FPM = 500;
/**
 * Where a departure levels off with every restriction behind it is *not* here
 * either: it is `Sid.topFt`, a thousand feet above the field's own assignable
 * ceiling. The two are deliberately different numbers — the ceiling is the top of
 * what the controller may assign, and a departure has to end up above the highest
 * arrival rather than level with it.
 */
/**
 * Total energy available to an aircraft climbing away on a departure, replacing
 * `THRUST_BUDGET_FPM`. A jet at take-off thrust at low level has far more excess
 * energy than one levelling off in the arrival stream.
 *
 * This is the *combined* climb-and-accelerate figure, and the per-type
 * `departureClimbFpm` is the pure-climb half of it — the APD quotes rate of
 * climb at a fixed climb speed, so the acceleration segment has to be paid for
 * out of what is left. 4200 fpm is what makes that remainder realistic: it
 * leaves every type between 0.5 and 0.8 kt/s to accelerate with while still
 * climbing at its published rate. Below about 4000 the steepest climbers in the
 * fleet (3000 fpm) are left with only the `MIN_SPEED_RATE_KTS_S` floor and
 * spend six minutes crawling up to 250 kt, which is not what a departure does.
 */
export const DEPARTURE_THRUST_BUDGET_FPM = 4200;
/** Sequencing tolerance at a SID fix — the same job `STAR_FIX_CAPTURE_NM` does. */
export const SID_FIX_CAPTURE_NM = 0.5;
export const SID_MAX_ANTICIPATION_NM = 6;

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
/**
 * How close to the target heading counts as rolled out of a turn in the pattern.
 *
 * It gates two things: the outbound minute is timed from the roll-out rather
 * than from the fix, and the turn back inbound hands over to fix tracking only
 * once it is finished — steering at the fix during the turn would cut the corner
 * and shrink the pattern.
 */
export const HOLD_ROLLOUT_TOLERANCE_DEG = 5;

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
/** Tower's and Departure's frequencies are a facility's own: `Scenario.facility`. */

// ── Session stats (§8) ──────────────────────────────────────────────────────
/**
 * Movement rates — landings and departures alike — are computed from the gaps
 * *between* movements rather than by counting them inside a trailing window: the
 * rate is `3600 * N / (T_latest - T_{latest-N})`, and it updates the instant a
 * movement happens instead of drifting as a window slides. Averaging over four
 * intervals smooths the wake-turbulence jitter between consecutive arrivals
 * while still reacting inside a couple of minutes (§8.2). One number for both,
 * because the two rates are the same runway measured in each direction and are
 * read side by side.
 */
export const MOVEMENT_RATE_INTERVALS = 4;
/**
 * Fewer gaps than this and a single tight or loose pair sets the whole number,
 * so the rate is withheld until at least three movements have been seen.
 */
export const MOVEMENT_RATE_MIN_INTERVALS = 2;
/**
 * How long the runway may be quiet before *now* counts as an open interval.
 *
 * Below this the rate holds the last figure achieved, because a gap on final is
 * usually deliberate — it is how departures get out (§4.7), and a rate that
 * sagged every time one was released would punish the thing it is meant to
 * reward. Past three minutes the quiet is no longer a gap in the sequence, it is
 * the absence of one, so the elapsed time since the last movement is averaged in
 * as though it were an interval still running. It is never recorded: the moment
 * a movement lands the open interval is replaced by the real one it turned out
 * to be, so a quick landing afterwards discards it entirely.
 */
export const MOVEMENT_RATE_STALE_S = 180;

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

// ── Session replay (§17) ────────────────────────────────────────────────────
/**
 * The recorder samples flight state at 5 Hz of *sim* time — four times coarser
 * than physics and five times finer than a radar return. Playback replays the
 * samples as they were taken rather than interpolating between them, so the
 * sample period is also the finest step the transport can land on.
 */
export const REPLAY_SAMPLE_HZ = 5;
export const REPLAY_SAMPLE_PERIOD_S = 1 / REPLAY_SAMPLE_HZ;
/**
 * Rolling window held in memory: the last 60 minutes of sim time, so a session
 * flown at 8× still keeps its last hour of *flying* rather than of watching.
 * Nothing is persisted — a refresh loses the recording.
 */
export const REPLAY_WINDOW_S = 3600;
/**
 * How far past the window the recording is allowed to grow before old frames
 * are dropped. Pruning splices every channel of every track, so it is done in
 * one batch a minute instead of five times a second.
 */
export const REPLAY_PRUNE_SLACK_S = 60;
/** Step for the transport's rewind and forward buttons. */
export const REPLAY_SKIP_S = 10;
/** Playback rates the transport offers; 0.5× is the one live play does not have. */
export const REPLAY_RATES: readonly number[] = [0.5, ...TIME_SCALES];
/**
 * The selected aircraft's path is drawn from one sample a second rather than
 * all five: at 250 kt the samples are 0.07 NM apart, so four in five land
 * inside the same pixel.
 */
export const REPLAY_PATH_STRIDE = REPLAY_SAMPLE_HZ;
