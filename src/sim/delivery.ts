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
} from './constants.js';
import { groundSpeed } from './dynamics.js';
import { distanceToGoNm } from './star.js';
import type { Nm, Sec } from './units.js';

/**
 * Why a delivery was not clean. Codes rather than sentences, so they tally in a
 * `Map` the way `Stats.rejections` does and the wording lives at the log call.
 */
export type DeliveryFault = 'early' | 'level' | 'speed' | 'unsequenced';

export interface Delivery {
  /** The fix it was delivered to. */
  gate: string;
  faults: readonly DeliveryFault[];
  /** Gap behind the previous delivery at this gate; null for the first one. */
  gapS: Sec | null;
  requiredGapS: Sec;
}

/** The interval the agreed rate implies: 14 an hour is 257 seconds. */
export function requiredGapS(gate: DeliveryGate): Sec {
  return 3600 / gate.targetRatePerHour;
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
 * `early` is the busting one. Late is not a fault: it wastes capacity, which
 * shows up in the achieved rate against the agreed one, and nobody downstream is
 * endangered by a gap.
 */
export function assessDelivery(
  gate: DeliveryGate,
  ac: Aircraft,
  previousS: Sec | null,
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

  const required = requiredGapS(gate);
  const gapS = previousS === null ? null : timeS - previousS;
  if (gapS !== null && gapS < required) faults.push('early');

  return { gate: gate.fixName, faults, gapS, requiredGapS: required };
}

/**
 * How long until the gate will accept another arrival — the countdown drawn
 * beside it on the scope (§8.3).
 *
 * The agreed interval less the time since the last delivery, floored at zero. It
 * is deliberately about the *gate* rather than about any aircraft: the deficit on
 * a data block says what one aircraft owes, and this says what the stream itself
 * is ready for, which is the number a controller glances at while deciding which
 * of two to send first.
 *
 * Null before the first delivery, when the gate is open and there is nothing to
 * count down from — an empty stream will take anyone.
 */
export function gateReadyInS(
  gate: DeliveryGate,
  lastDeliveryS: ReadonlyMap<string, Sec>,
  timeS: Sec,
): Sec | null {
  const last = lastDeliveryS.get(gate.fixName);
  if (last === undefined) return null;
  return Math.max(0, last + requiredGapS(gate) - timeS);
}

/** What the scope shows about one aircraft's place in its stream. */
export interface DeliverySlot {
  gate: string;
  /** Sim time it reaches the delivery fix on its present track and speed. */
  etaS: Sec;
  /**
   * Seconds it must lose to open the agreed gap; negative is slack in hand.
   *
   * Measured against the slot the aircraft *ahead* was given plus the interval,
   * so it accumulates down a queue the way the delay actually does: three
   * aircraft two minutes apart in a four-minute stream owe two, four and six
   * minutes, not two minutes each.
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
 * Slot every inbound aircraft in every stream.
 *
 * First-come-first-served on estimate, which is the baseline real facilities use
 * and is deliberately not optimal: resequencing by type or speed buys capacity
 * and costs predictability, and choosing to do it by hand is one of the things
 * the player is here to learn.
 */
export function deliveryPlan(
  delivery: readonly DeliveryGate[],
  aircraft: readonly Aircraft[],
  lastDeliveryS: ReadonlyMap<string, Sec>,
  timeS: Sec,
): Map<number, DeliverySlot> {
  const slots = new Map<number, DeliverySlot>();
  for (const gate of delivery) {
    const required = requiredGapS(gate);
    const inbound: { ac: Aircraft; etaS: Sec; distNm: Nm }[] = [];
    for (const ac of aircraft) {
      if (isDeparture(ac) || destinationOf(ac) !== gate.fixName) continue;
      const nav = ac.star ?? ac.rejoin?.nav ?? null;
      if (!nav) continue;
      const distNm = distanceToGoNm(ac, nav);
      const speed = groundSpeed(ac);
      if (speed <= 0) continue;
      inbound.push({ ac, etaS: timeS + (distNm / speed) * 3600, distNm });
    }
    inbound.sort((a, b) => a.etaS - b.etaS);

    // The chain only ever delays: an aircraft cannot be given a slot before it
    // can physically get there, so its own estimate is the floor.
    let previousSlotS = lastDeliveryS.get(gate.fixName) ?? Number.NEGATIVE_INFINITY;
    for (const entry of inbound) {
      const earliestS = previousSlotS + required;
      slots.set(entry.ac.id, {
        gate: gate.fixName,
        etaS: entry.etaS,
        // Signed against the earliest acceptable time rather than against the
        // slot finally assigned, which is what lets slack read as slack instead
        // of being clamped away by the `max` below.
        deficitS: Number.isFinite(earliestS) ? earliestS - entry.etaS : 0,
        frozen: entry.distNm <= DELIVERY_FREEZE_HORIZON_NM,
      });
      previousSlotS = Math.max(entry.etaS, earliestS);
    }
  }
  return slots;
}
