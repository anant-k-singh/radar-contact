/**
 * The pilot end of an instruction (docs §7.2).
 *
 * The controller transmits; the crew reads back and flies it 1–3 s later.
 * Commands are therefore queued rather than applied, and the scope shows the
 * *assigned* value straight away while the aircraft is still flying the old one
 * — the same gap a real controller watches for on the next radar sweep.
 *
 * Only one instruction of each kind can be outstanding: pressing `D` four times
 * in a second is one turn instruction, not four, so it is read back once.
 */
import type { Runway, Star } from '../scenario/types.js';
import type { Aircraft } from './aircraft.js';
import {
  HOLD_SPEED_KTS,
  PILOT_DELAY_MAX_S,
  PILOT_DELAY_MIN_S,
  PILOT_ORDER_GAP_S,
} from './constants.js';
import { enterHold, requestHoldExit } from './hold.js';
import { altitudeAheadFt, starProfileAt } from '../scenario/routes.js';
import {
  armRejoin,
  distanceToGoNm,
  leaveStar,
  rejoinDistanceToGoNm,
  rejoinTarget,
  type StarNav,
} from './star.js';
import { displayHeading, headingDelta, type Deg, type Ft, type Kts, type Sec } from './units.js';
import type { MessageKind, World } from './world.js';

export type Instruction =
  | { kind: 'heading'; headingDeg: Deg }
  | { kind: 'altitude'; altitudeFt: Ft }
  | { kind: 'speed'; iasKts: Kts }
  | { kind: 'approach'; warnings: readonly string[] }
  /**
   * Whether the aircraft should be in the pattern at all (§4.6). True covers
   * both entering and *staying* — taking back an exit already instructed — so
   * one boolean carries the whole of what `H` toggles.
   */
  | { kind: 'hold'; hold: boolean }
  /**
   * Resume the arrival (§4.5a). `resume: false` is the cancel — `R` on an
   * aircraft whose rejoin is already armed, the way `H` toggles the hold.
   */
  | { kind: 'rejoin'; resume: boolean };

export interface PendingInstruction {
  /** Sim time the crew acts on it. */
  atS: Sec;
  instruction: Instruction;
}

export interface Readback {
  text: string;
  kind: MessageKind;
}

function pending<K extends Instruction['kind']>(
  ac: Aircraft,
  kind: K,
): Extract<Instruction, { kind: K }> | undefined {
  const entry = ac.pending.find((item) => item.instruction.kind === kind);
  return entry?.instruction as Extract<Instruction, { kind: K }> | undefined;
}

/** What the controller has assigned, whether or not the crew has acted on it yet. */
export function assignedHeadingDeg(ac: Aircraft): Deg {
  return pending(ac, 'heading')?.headingDeg ?? ac.targetHeadingDeg;
}

export function assignedAltitudeFt(ac: Aircraft): Ft {
  return pending(ac, 'altitude')?.altitudeFt ?? ac.targetAltitudeFt;
}

export function assignedIasKts(ac: Aircraft): Kts {
  return pending(ac, 'speed')?.iasKts ?? ac.targetIasKts;
}

/** True while an instruction of this kind has been transmitted but not yet flown. */
export function isPending(ac: Aircraft, kind: Instruction['kind']): boolean {
  return ac.pending.some((item) => item.instruction.kind === kind);
}

/**
 * Transmit an instruction. A second instruction of the same kind replaces the
 * outstanding one and restarts the reaction time — the controller is still
 * talking, so the crew acts once, on the final value.
 */
export function issue(world: World, ac: Aircraft, instruction: Instruction): void {
  const spread = PILOT_DELAY_MAX_S - PILOT_DELAY_MIN_S;
  const entry: PendingInstruction = {
    atS: world.timeS + PILOT_DELAY_MIN_S + world.pilotRng.next() * spread,
    instruction,
  };
  // "Turn left 210, cleared ILS approach" is one transmission, but each half
  // draws its own reaction time, so the clearance can otherwise be flown first
  // and the turn then arrive behind it looking like a vector off the approach —
  // cancelling the clearance that was just given. The crew never acts out of
  // order: a clearance waits for whatever is already being read back.
  if (instruction.kind === 'approach') {
    for (const item of ac.pending) {
      entry.atS = Math.max(entry.atS, item.atS + PILOT_ORDER_GAP_S);
    }
  }
  const index = ac.pending.findIndex((item) => item.instruction.kind === instruction.kind);
  if (index >= 0) ac.pending[index] = entry;
  else ac.pending.push(entry);
}

/** A vector while on the approach cancels the clearance (§6.1c). */
function cancelApproach(ac: Aircraft): Readback | null {
  if (ac.phase !== 'cleared' && ac.phase !== 'loc' && ac.phase !== 'gs') return null;
  ac.phase = 'inbound';
  ac.speedAssignedAfterClearance = false;
  return { text: `${ac.callsign}, cancelling the approach clearance.`, kind: 'pilot' };
}

/**
 * An altitude given to an aircraft already flying the glideslope, which is the
 * one altitude that *does* cancel (§6.1c).
 *
 * Descending an aircraft before the localizer is the standard way of setting up
 * the intercept — "descend 3000, cleared ILS" — and it supports the clearance
 * rather than abandoning it, so in `cleared` and `loc` the clearance stands. On
 * the glideslope it is the opposite: the path writes `altitudeFt` directly
 * (§5, the two places that bypass kinematics), so an assigned level is not
 * something the aircraft can fly while still on it. Taking it off the approach is
 * the honest reading of the instruction — and the only one that leaves the
 * aircraft doing what it was told.
 */
function cancelApproachForAltitude(ac: Aircraft): Readback | null {
  return ac.phase === 'gs' ? cancelApproach(ac) : null;
}

/** Which side of its published profile the aircraft is on right now (§4.6). */
function profileSideOf(ac: Aircraft, nav: StarNav, dtgNm = distanceToGoNm(ac, nav)): -1 | 0 | 1 {
  const profileFt = starProfileAt(nav.route, dtgNm, nav.altitudes).altitudeFt;
  return Math.sign(ac.altitudeFt - profileFt) as -1 | 0 | 1;
}

function apply(
  runway: Runway,
  stars: readonly Star[],
  ac: Aircraft,
  instruction: Instruction,
): Readback[] {
  const readbacks: Readback[] = [];

  switch (instruction.kind) {
    case 'heading': {
      const cancelled = cancelApproach(ac);
      if (cancelled) readbacks.push(cancelled);
      // A vector is a departure from the route in the one way that matters:
      // the aircraft is no longer where the STAR says it should be.
      leaveStar(ac);
      // A turn does not disarm a rejoin — aiming the intercept is what the turn
      // is *for* — but it is the only thing that moves the ray, so this is
      // where the leg is re-chosen rather than in the tick loop (§4.5a).
      if (ac.rejoin?.leg != null) {
        const target = rejoinTarget(stars, ac, instruction.headingDeg, ac.rejoin.nav);
        if (target === null) {
          ac.rejoin.leg = null;
          readbacks.push({
            text: `${ac.callsign}, that heading takes us away from the arrivals.`,
            kind: 'pilot',
          });
        } else {
          armRejoin(ac.rejoin, target);
        }
      }
      const turn = headingDelta(ac.headingDeg, instruction.headingDeg);
      const sense =
        Math.abs(turn) < 0.5 ? 'maintaining' : turn < 0 ? 'turning left' : 'turning right';
      ac.targetHeadingDeg = instruction.headingDeg;
      readbacks.push({
        text: `${ac.callsign}, ${sense} heading ${displayHeading(instruction.headingDeg)}.`,
        kind: 'pilot',
      });
      return readbacks;
    }

    case 'altitude': {
      const cancelled = cancelApproachForAltitude(ac);
      if (cancelled) readbacks.push(cancelled);
      // The published profile is off, but the aircraft stays on the route — and
      // an armed rejoin is flying that profile too, so the takeover has to reach
      // the parked nav or `stepRejoin` would fight the assignment (§4.5a).
      const nav = ac.star ?? ac.rejoin?.nav;
      if (nav) nav.altitudeManual = true;
      ac.targetAltitudeFt = instruction.altitudeFt;
      const verb =
        instruction.altitudeFt > ac.altitudeFt
          ? 'climbing'
          : instruction.altitudeFt < ac.altitudeFt
            ? 'descending'
            : 'maintaining';
      readbacks.push({
        text: `${ac.callsign}, ${verb} ${instruction.altitudeFt} feet.`,
        kind: 'pilot',
      });
      return readbacks;
    }

    case 'speed': {
      // Speed control does not take an aircraft off its STAR (§4.5), and reaches
      // an armed rejoin's parked nav for the reason the altitude does.
      const nav = ac.star ?? ac.rejoin?.nav;
      if (nav) nav.speedManual = true;
      // "Maintain XXX kt until X mile final" survives the clearance
      // and switches off the deceleration schedule, so it has to mean the
      // technique and nothing else. That means *established*, not merely
      // cleared: since a clearance may now be given 20 NM out (§6.1a), ordinary
      // sequencing speed control lands in the `cleared` window all the time,
      // and arming 6.14.4 on it would silently carry the speed to 5 NM.
      if (ac.phase === 'loc' || ac.phase === 'gs') {
        ac.speedAssignedAfterClearance = true;
      }
      const verb = instruction.iasKts > ac.iasKts ? 'increasing' : 'reducing';
      ac.targetIasKts = instruction.iasKts;
      readbacks.push({
        text: `${ac.callsign}, ${verb} ${instruction.iasKts} knots.`,
        kind: 'pilot',
      });
      return readbacks;
    }

    case 'hold': {
      const nav = ac.star;
      // The aircraft may have been vectored off the route, or have reached the
      // end of it, in the seconds between the transmission and the readback.
      if (!nav) {
        readbacks.push({
          text: `${ac.callsign}, negative — we are off the arrival now.`,
          kind: 'pilot',
        });
        return readbacks;
      }

      if (instruction.hold) {
        // Already in the pattern: this is taking back an exit, not a second
        // entry — the aircraft never left, so nothing about the pattern is
        // rebuilt and it simply keeps going round.
        if (nav.hold) {
          if (!nav.hold.exitRequested) return readbacks; // nothing to take back
          nav.hold.exitRequested = false;
          readbacks.push({
            text: `${ac.callsign}, disregard, continuing to hold at ${nav.hold.fix}.`,
            kind: 'pilot',
          });
          return readbacks;
        }
        const hold = enterHold(ac, nav);
        readbacks.push({
          text: `${ac.callsign}, holding at ${hold.fix} as published, ` +
            `${Math.round(hold.altitudeFt)} feet, ${HOLD_SPEED_KTS} knots.`,
          kind: 'pilot',
        });
        return readbacks;
      }

      if (!nav.hold) return readbacks;
      const fix = nav.hold.fix;
      // Before the fix is reached the hold has not begun, so it cancels
      // outright; once established the crew finishes the loop it is flying.
      const immediate = requestHoldExit(ac, nav.hold);
      readbacks.push({
        text: immediate
          ? `${ac.callsign}, cancelling the hold, continuing on the arrival.`
          : `${ac.callsign}, leaving ${fix} on the next inbound, continuing on the arrival.`,
        kind: 'pilot',
      });
      return readbacks;
    }

    case 'rejoin': {
      // Case (b): still on the route, just flying an assignment instead of the
      // chart. Handing the profile back is all "resume" means here.
      const onRoute = ac.star;
      if (onRoute) {
        onRoute.altitudeManual = false;
        onRoute.speedManual = false;
        onRoute.rejoining = profileSideOf(ac, onRoute);
        readbacks.push({
          text: `${ac.callsign}, resuming the ${onRoute.route.name} profile.`,
          kind: 'pilot',
        });
        return readbacks;
      }

      // The aircraft may have been cleared for the approach, or re-vectored
      // onto a heading that reaches nothing, in the 1–3 s since the transmission.
      const rejoin = ac.rejoin;
      if (!rejoin) {
        readbacks.push({ text: `${ac.callsign}, negative — we have no arrival to resume.`, kind: 'pilot' });
        return readbacks;
      }

      if (!instruction.resume) {
        rejoin.leg = null;
        readbacks.push({ text: `${ac.callsign}, cancelling the rejoin, maintaining heading.`, kind: 'pilot' });
        return readbacks;
      }

      const target = rejoinTarget(stars, ac, ac.targetHeadingDeg, rejoin.nav);
      if (target === null) {
        readbacks.push({
          text: `${ac.callsign}, negative — this heading does not reach an arrival route.`,
          kind: 'pilot',
        });
        return readbacks;
      }
      // Adopting another STAR replaces the parked nav, so everything below has
      // to read the route back off `rejoin.nav` rather than from `target`.
      armRejoin(rejoin, target);
      const leg = target.leg;
      // Resume means the whole arrival, so the axes the controller took come
      // back now rather than at the capture — `stepRejoin` flies the published
      // profile from here, on the route's own gradient (§4.5a).
      rejoin.nav.altitudeManual = false;
      rejoin.nav.speedManual = false;
      rejoin.nav.rejoining = profileSideOf(ac, rejoin.nav, rejoinDistanceToGoNm(rejoin.nav, leg, ac));
      const fix = rejoin.nav.route.waypoints[leg]!;
      const crossingFt = altitudeAheadFt(rejoin.nav.route, fix.dtgNm, rejoin.nav.altitudes);
      readbacks.push({
        text:
          `${ac.callsign}, joining the ${rejoin.nav.route.name} at ${fix.name}, ` +
          `${crossingFt < ac.altitudeFt ? 'descending' : 'maintaining'} ${crossingFt} feet.`,
        kind: 'pilot',
      });
      return readbacks;
    }

    case 'approach': {
      leaveStar(ac);
      // The arrival is over, so there is nothing left to resume: the route is
      // forgotten rather than remembered (§4.5a).
      ac.rejoin = null;
      ac.phase = 'cleared';
      ac.speedAssignedAfterClearance = false;
      readbacks.push({
        text: `${ac.callsign}, cleared ILS approach runway ${runway.id}.`,
        kind: 'pilot',
      });
      for (const warning of instruction.warnings) {
        readbacks.push({ text: `Poor practice: ${ac.callsign} — ${warning}.`, kind: 'system' });
      }
      return readbacks;
    }
  }
}

/** Fly everything the crew has had time to act on. Returns what they said. */
export function applyDueInstructions(
  runway: Runway,
  stars: readonly Star[],
  ac: Aircraft,
  timeS: Sec,
): Readback[] {
  if (ac.pending.length === 0) return [];
  const due = ac.pending.filter((item) => item.atS <= timeS);
  if (due.length === 0) return [];

  ac.pending = ac.pending.filter((item) => item.atS > timeS);
  return due
    .sort((a, b) => a.atS - b.atS)
    .flatMap((item) => apply(runway, stars, ac, item.instruction));
}
