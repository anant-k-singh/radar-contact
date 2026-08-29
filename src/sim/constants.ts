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
export const CEILING_FT = 13_000;
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
export const GO_AROUND_ALT_FT = 3000;
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
export const FLOW_DEFAULT_PER_HOUR = 25;
export const FLOW_MIN_PER_HOUR = 5;
export const FLOW_MAX_PER_HOUR = 50;
export const MIN_SPAWN_INTERVAL_S = 45;
export const GATE_COOLDOWN_S = 90;
export const SPAWN_VETO_NM = 5;
export const SPAWN_VETO_FT = 1000;
export const ENTRY_ALTITUDE_FT = 13_000;
/** Gates whose geometry gives a short run to the localizer arrive lower. */
export const ENTRY_ALTITUDE_NEAR_FT = 11_000;
export const ENTRY_SPEED_KTS = 250;

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
export const DEPARTURE_FLOW_DEFAULT_PER_HOUR = 10;
export const DEPARTURE_FLOW_MIN_PER_HOUR = 0;
export const DEPARTURE_FLOW_MAX_PER_HOUR = 20;
export const DEPARTURE_FLOW_STEP_PER_HOUR = 5;
/**
 * How often the spawner reconsiders a departure while the flow is set to zero.
 * With no scheduled release there is nothing to bring forward, so turning the
 * flow back up would otherwise do nothing until the session was restarted.
 */
export const DEPARTURE_FLOW_IDLE_RECHECK_S = 10;
/**
 * Runway separation between consecutive departures, roll to roll. It is the
 * interval that applies when nothing lands in between; an arrival between the
 * two adds its own rolling-out interval on top.
 *
 * 90 s covers the wake-turbulence minimum behind a medium and the time the
 * first departure needs to be airborne and clear of the far end. It caps the
 * runway at 40 departures an hour, which is comfortably above the 20/h the
 * player can ask for — so a queue that grows is the *arrivals* eating the
 * runway, never the interval itself.
 */
export const DEPARTURE_MIN_INTERVAL_S = 90;
/**
 * The runway is shared (§4.7). No departure is released while an arrival is
 * inside this far on final, or for this long after one has landed and is still
 * rolling out. A saturated final therefore starves the departures, which is the
 * coupling that makes one runway feel like one runway.
 *
 * The distance is a floor, not the test — the test is
 * `DEPARTURE_AIRBORNE_MARGIN_S` below, in time. It is here because the real
 * rule has a distance in it too: nothing is released with an arrival this close
 * however slowly that arrival happens to be flying. At any normal approach
 * speed the time test binds a mile before this does, so the floor only takes
 * over below about 115 kt of ground speed.
 */
export const DEPARTURE_HOLD_FINAL_NM = 3.5;
export const DEPARTURE_HOLD_AFTER_LANDING_S = 60;
/**
 * How long the arrival must still be from the threshold at the moment the
 * departure ahead of it *rotates* (§4.7).
 *
 * This is the safety buffer, and making it a term of its own is the point. The
 * release used to be a bare 3 NM chosen so the slowest type in the fleet would
 * just clear — which meant every release sat at that type's edge, and a heavy
 * rotated with the arrival at 0.8 NM and 300 ft. The gate is now
 * `time to threshold ≥ take-off roll + this`, computed from the arrival's
 * actual ground speed, so an arrival still carrying speed blocks further out
 * than one already at its approach speed.
 *
 * The theoretical floor is about 8 s — the time an arrival takes to cover the
 * 0.3 NM at which `GO_AROUND_RUNWAY_OCCUPIED_NM` would send it around. 40 s is
 * five times that: enough that the release is not one wobble from a go-around,
 * and not so much that the runway sits idle behind a gap it could have used.
 *
 * At this figure the clock and the 3.5 NM floor land almost on top of each
 * other at an approach speed — the time test asks for 3.58 NM, the floor for
 * 3.5 — so the two rules agree there and the clock alone governs anything
 * faster.
 */
export const DEPARTURE_AIRBORNE_MARGIN_S = 40;
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
 * Where a departure levels off with every restriction behind it — 1000 ft above
 * the airspace ceiling the *player* is held to (`CEILING_FT`).
 *
 * The two are deliberately different numbers. `CEILING_FT` is the top of what
 * the controller may assign, and the south gates now hand arrivals over at
 * exactly that; a departure has to end up above the highest arrival rather than
 * level with it, and it is leaving the terminal area anyway.
 */
export const DEPARTURE_TOP_FT = CEILING_FT + 1000;
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
/** Frequency the departures are already working, for the handover line. */
export const DEPARTURE_FREQUENCY = '124.7';

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
