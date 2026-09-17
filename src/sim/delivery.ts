/**
 * What a center sector is graded on: the arrivals it hands to the next sector
 * down, and whether they arrive in a state that sector can use (§3.2a, §8.3).
 *
 * The premise is Infinite Flight's ATC manual §6.6.14 — "Center must ensure all
 * aircraft are … on their respective procedures and **sequenced** prior to
 * handing off to Approach" — and the reason it is a whole module rather than a
 * line in `world.ts` is that it is the objective. Approach control is scored on
 * what lands; area control is scored on what it passes on, at a boundary the
 * player never sees the far side of.
 *
 * Pure, and takes the slices it is about rather than a `World`, for the reason
 * every other sim module does: `src/sim/` may not import a scenario value, and
 * `playback.ts` calls into here while it is still building the `World` it would
 * otherwise have to be handed.
 *
 * ## The agreement is a rate over a window, and only the floor is pairwise
 *
 * What the field below can accept is a runway rate — one number — and a gate's
 * published rate is that number cut by the gate's own share of the traffic. So
 * enforcing each gate's figure as an interval assumed every *other* gate was
 * simultaneously running at its own maximum, which arrivals being a Poisson
 * process (§4.4) they never are: a line down one STAR with the other four empty
 * was held fifteen minutes an aircraft while the sector handed on a fraction of
 * what Approach had agreed to take.
 *
 * Summing the agreements fixed that and left the mistake one level up, because
 * the sum was still enforced as a *gap*. Two arrivals reaching two different
 * fixes in the same second are sixty miles apart, on two routes, at two
 * published levels; they cost Approach nothing at that moment and meet only at
 * the merge, twenty to forty miles later, which is Approach's own job. So the
 * agreement is a **count over a window** — two of them, a lenient six minutes and
 * a strict twelve (`DELIVERY_WINDOWS`) — and it says nothing whatever about where
 * a delivery went. The per-gate figure survives as the share the traffic is
 * offered in, as the scoreboard row, and as the derivation of the sum.
 *
 * What is left pairwise is the one thing that is physical: two aircraft handed to
 * the *same* fix arrive at the same level down the same route, which is
 * `DELIVERY_TRAIL_FLOOR_S`, and it is now the only such rule in the model.
 *
 * Two things went with the gap. A ledger — credit banked by a long gap, debt
 * carried by a short one — which existed because a quiet gate's own clock was the
 * only clock it had; and the tolerance under the interval, because **a count cap
 * has no near-miss**. The instant the `cap`-th most recent delivery falls out of
 * the window is both when the gate opens and when a delivery stops being early,
 * so "the clock never invites a delivery it would then fault" is an identity here
 * rather than an inequality somebody has to keep true.
 *
 * ## The deficit is the whole mechanic, and it is measured in time
 *
 * A real Arrival Manager tells the controller how much time an aircraft has to
 * lose and leaves the *how* to them — vector, speed, path stretch or hold. That
 * division is deliberately preserved here: `deliveryPlan` computes the deficit
 * and says nothing about what to do with it. The moment it suggests a speed it
 * becomes a to-do list and the sector stops being a puzzle.
 *
 * It also means delay needs no separate accounting. Every instrument the player
 * has moves the aircraft's estimate at the gate — a hold parks its distance-to-go
 * while everyone else's counts down, a vector lengthens it, a speed reduction
 * stretches it — so the estimate *is* the delay ledger and there is nothing to
 * bank twice.
 */
import type { DeliveryGate, Star } from '../scenario/types.js';
import type { Aircraft } from './aircraft.js';
import { isDeparture } from './aircraft.js';
import {
  DELIVERY_FREEZE_HORIZON_NM,
  DELIVERY_LEVEL_TOLERANCE_FT,
  DELIVERY_SPEED_TOLERANCE_KTS,
  DELIVERY_TRAIL_FLOOR_S,
  DELIVERY_WINDOWS,
} from './constants.js';
import { groundSpeed } from './dynamics.js';
import { distanceToGoNm } from './star.js';
import type { Nm, Sec } from './units.js';

/**
 * Why a delivery was not clean. Codes rather than sentences, so they tally in a
 * `Map` the way `Stats.rejections` does and the wording lives at the `log()` call.
 */
export type DeliveryFault = 'early' | 'level' | 'speed' | 'unsequenced';

/**
 * The sector's spacing state, as the caller stores it.
 *
 * The rate and the series are the agreement — a count over a window needs the
 * timestamps, not just the last one — and the map is what is left of the
 * per-gate rule, the in-trail floor at a single fix.
 */
export interface DeliveryState {
  /** Sum of the gates' agreements. The window caps derive from it. */
  ratePerHour: number;
  /** Every delivery anywhere in the sector, ascending, back at least the longest window. */
  recentSectorS: readonly Sec[];
  /** The last delivery at each gate, which only the in-trail floor reads. */
  lastGateS: ReadonlyMap<string, Sec>;
}

/** Which constraint is holding a gate shut. */
export type DeliveryRule = { kind: 'window'; windowS: Sec; cap: number } | { kind: 'trail' };

export interface Delivery {
  /** The fix it was delivered to. */
  gate: string;
  faults: readonly DeliveryFault[];
  /** What made it `early`, and by how much; null when it was not. */
  early: { rule: DeliveryRule; readyS: Sec; shortByS: Sec } | null;
  /** Gap behind the last delivery at this same fix; null if it is the first there. */
  trailGapS: Sec | null;
}

/**
 * The mean interval the agreement implies: 31 an hour is 116 seconds.
 *
 * Nothing is graded against it — the agreement is `deliveryWindows` — but it is
 * the one number that summarises the rate in a sentence, which is what the
 * sidebar prints and what a field's own gate shares are sanity-checked against.
 */
export function agreedGapS(ratePerHour: number): Sec {
  return 3600 / ratePerHour;
}

/**
 * What the sector may pass in each window, derived from the agreement and never
 * authored: `floor(rate × window / 3600) + slack`.
 *
 * VABBA's 31 an hour is 3.1 in six minutes and 6.2 in twelve, so it may pass 5
 * and 7; VABBS's 14 is 3 and 3. The floor-then-add is what keeps the short window
 * the lenient one at every rate, and it is why no field can be handed a cap of
 * none.
 */
export function deliveryWindows(ratePerHour: number): readonly DeliveryWindow[] {
  return DELIVERY_WINDOWS.map(({ windowS, slack }) => ({
    windowS,
    cap: Math.floor((ratePerHour * windowS) / 3600) + slack,
  }));
}

export interface DeliveryWindow {
  windowS: Sec;
  cap: number;
}

/**
 * The earliest this fix may next take a delivery, and which rule says so — the
 * one place the agreement is expressed, read by the grader, the countdown and the
 * plan alike.
 *
 * Per window, the binding moment is when the `cap`-th most recent delivery falls
 * out of it: pass one before that and this one is the `cap + 1`-th inside the
 * window. Per fix, it is the in-trail floor behind the last delivery there. The
 * answer is the latest of them, so the caller never has to know which applied.
 *
 * It is not passed the time, and that is not an oversight: "fewer than `cap`
 * inside the window" and "the `cap`-th most recent is more than `windowS` ago"
 * are the same statement, so a stale entry left in the series simply loses the
 * `max`. Trimming is therefore a memory concern and never a correctness one.
 *
 * Null when nothing binds — a quiet sector takes anyone, at any gate.
 */
export function deliveryBound(
  fixName: string,
  state: DeliveryState,
): { readyS: Sec; rule: DeliveryRule } | null {
  let bound: { readyS: Sec; rule: DeliveryRule } | null = null;
  const take = (readyS: Sec, rule: DeliveryRule): void => {
    if (bound === null || readyS > bound.readyS) bound = { readyS, rule };
  };
  for (const { windowS, cap } of deliveryWindows(state.ratePerHour)) {
    const nth = state.recentSectorS[state.recentSectorS.length - cap];
    if (nth !== undefined) take(nth + windowS, { kind: 'window', windowS, cap });
  }
  const lastHere = state.lastGateS.get(fixName);
  if (lastHere !== undefined) take(lastHere + DELIVERY_TRAIL_FLOOR_S, { kind: 'trail' });
  return bound;
}

/** The route an aircraft is flying, or the one it was vectored off and remembers. */
export function routeOf(ac: Aircraft): Star | null {
  return ac.star?.route ?? ac.rejoin?.nav.route ?? null;
}

/** The delivery gate an aircraft's route ends at, by name. */
export function destinationOf(ac: Aircraft): string | null {
  const route = routeOf(ac);
  if (!route) return null;
  return route.waypoints[route.waypoints.length - 1]!.name;
}

/**
 * Grade one delivery.
 *
 * `unsequenced` is the fault that matters most and is the only one that is not a
 * tolerance: an aircraft still on a vector has been given to the next sector as a
 * problem rather than as a sequence, which is precisely what this position exists
 * to prevent. The other three are read against the crossing the route publishes,
 * because that crossing is what the sector below spawns its arrivals at — the two
 * fields have to agree about the boundary they share.
 *
 * `early` is the busting one, and it is one code for three constraints: the two
 * window caps and the in-trail floor are all "handed on too soon", and a second
 * counter for the same event would only split `TOO CLOSE` in half. Which of them
 * broke is on the verdict, for the log line to say — and it is the *binding* one,
 * since `deliveryBound` already took the latest.
 *
 * Late is not a fault: it wastes capacity, which shows up in the achieved rate
 * against the agreed one, and nobody downstream is endangered by a gap.
 */
export function assessDelivery(
  gate: DeliveryGate,
  ac: Aircraft,
  state: DeliveryState,
  timeS: Sec,
): Delivery {
  const faults: DeliveryFault[] = [];
  const route = ac.star?.route ?? null;
  if (route === null) faults.push('unsequenced');

  const published = route?.waypoints[route.waypoints.length - 1];
  if (published?.altitudeFt !== undefined) {
    if (Math.abs(ac.altitudeFt - published.altitudeFt) > DELIVERY_LEVEL_TOLERANCE_FT) {
      faults.push('level');
    }
  }
  if (published?.speedKts !== undefined) {
    if (Math.abs(ac.iasKts - published.speedKts) > DELIVERY_SPEED_TOLERANCE_KTS) {
      faults.push('speed');
    }
  }

  const lastAtGate = state.lastGateS.get(gate.fixName);
  const trailGapS = lastAtGate === undefined ? null : timeS - lastAtGate;
  // Strictly under: a delivery landing exactly on the bound is the one the
  // window has just made room for, which is what keeps the clock and the fault
  // line the same instant.
  const bound = deliveryBound(gate.fixName, state);
  const early =
    bound !== null && timeS < bound.readyS
      ? { rule: bound.rule, readyS: bound.readyS, shortByS: bound.readyS - timeS }
      : null;
  if (early) faults.push('early');

  return { gate: gate.fixName, faults, early, trailGapS };
}

/**
 * How long until this gate will accept another arrival — the countdown drawn
 * beside it on the scope (§8.3).
 *
 * Whichever of the three clocks is latest, and there is nothing else to know: the
 * two windows are the sector's and every gate shares them, the floor is this
 * fix's own. So the gates read the same number while a window is binding, one of
 * them reads longer where it has just taken a delivery, and they all read `0:00`
 * together while the sector has headroom — which is the burst the model exists to
 * permit.
 *
 * Zero is exactly the fault line rather than a tolerance short of it, so the
 * clock can be read as an instruction: at `0:00` the next one is clean wherever
 * it goes. It is deliberately about the *place* rather than about any aircraft —
 * the deficit on a data block says what one aircraft owes, and this says what the
 * sector is ready for, which is the number a controller glances at while deciding
 * which of two to send first.
 *
 * Null only before the sector's first delivery, when there is nothing anywhere to
 * count from — and only when nothing binds, since the clock must never read blank
 * over a rule that would fault the delivery it is inviting.
 */
export function gateReadyInS(fixName: string, state: DeliveryState, timeS: Sec): Sec | null {
  const bound = deliveryBound(fixName, state);
  if (bound === null) return state.recentSectorS.length === 0 ? null : 0;
  return Math.max(0, bound.readyS - timeS);
}

/** What the scope shows about one aircraft's place in the sequence. */
export interface DeliverySlot {
  /** Sim time it reaches the delivery fix on its present track and speed. */
  etaS: Sec;
  /**
   * Seconds it must lose to open the agreed gap; negative is slack in hand.
   *
   * Measured against the slot the aircraft *ahead* was given plus the interval,
   * so it accumulates down a queue the way the delay actually does: three
   * aircraft a minute apart in a two-minute stream owe one, two and three
   * minutes, not one minute each.
   */
  deficitS: Sec;
  /**
   * False while the aircraft is far enough out that the order can still change
   * freely. Inside the horizon its slot is a commitment, which is the difference
   * between metering and merely vectoring.
   */
  frozen: boolean;
}

/**
 * Slot every inbound aircraft in the sector.
 *
 * One queue over every gate, not one per gate, because the agreement being the
 * sector's is what the aircraft ahead is measured against — an arrival to RCKT
 * counts against the windows the last aircraft into RCMG filled, whether or not
 * it ever sees it.
 *
 * The chain runs `deliveryBound` against a *hypothetical* ledger: each slot it
 * assigns is pushed onto a copy of the series, so the plan is paced by the same
 * rule the grader will apply rather than by a restatement of it. The first few
 * aircraft into a quiet sector therefore all read zero — a burst is clean — and
 * accumulation starts at the one that finds a window full.
 *
 * First-come-first-served on estimate, which is the baseline real facilities use
 * and is deliberately not optimal: resequencing by type or speed buys capacity
 * and costs predictability, and choosing to do it by hand is one of the things
 * the player is here to learn.
 */
export function deliveryPlan(
  delivery: readonly DeliveryGate[],
  aircraft: readonly Aircraft[],
  state: DeliveryState,
  timeS: Sec,
): Map<number, DeliverySlot> {
  const gates = new Set(delivery.map((gate) => gate.fixName));
  const inbound: { ac: Aircraft; gate: string; etaS: Sec; distNm: Nm }[] = [];
  for (const ac of aircraft) {
    if (isDeparture(ac)) continue;
    const gate = destinationOf(ac);
    if (gate === null || !gates.has(gate)) continue;
    const nav = ac.star ?? ac.rejoin?.nav ?? null;
    if (!nav) continue;
    const distNm = distanceToGoNm(ac, nav);
    const speed = groundSpeed(ac);
    if (speed <= 0) continue;
    inbound.push({ ac, gate, etaS: timeS + (distNm / speed) * 3600, distNm });
  }
  inbound.sort((a, b) => a.etaS - b.etaS);

  const slots = new Map<number, DeliverySlot>();
  const ledger = {
    ratePerHour: state.ratePerHour,
    recentSectorS: [...state.recentSectorS],
    lastGateS: new Map(state.lastGateS),
  };
  for (const entry of inbound) {
    const bound = deliveryBound(entry.gate, ledger);
    slots.set(entry.ac.id, {
      etaS: entry.etaS,
      // Signed against the earliest acceptable time rather than against the slot
      // finally assigned, which is what lets slack read as slack instead of being
      // clamped away by the `max` below.
      deficitS: bound === null ? 0 : bound.readyS - entry.etaS,
      frozen: entry.distNm <= DELIVERY_FREEZE_HORIZON_NM,
    });
    // The chain only ever delays: an aircraft cannot be given a slot before it
    // can physically get there, so its own estimate is the floor. That is also
    // what keeps the series ascending down an ETA-ordered queue, which
    // `deliveryBound` relies on to index from the end.
    const slotS = Math.max(entry.etaS, bound?.readyS ?? Number.NEGATIVE_INFINITY);
    ledger.recentSectorS.push(slotS);
    ledger.lastGateS.set(entry.gate, slotS);
  }
  return slots;
}
