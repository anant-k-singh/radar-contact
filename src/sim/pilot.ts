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
import { AIRPORT } from '../scenario/airport.js';
import type { Aircraft } from './aircraft.js';
import { PILOT_DELAY_MAX_S, PILOT_DELAY_MIN_S } from './constants.js';
import { leaveStar } from './star.js';
import { displayHeading, headingDelta, type Deg, type Ft, type Kts, type Sec } from './units.js';
import type { MessageKind, World } from './world.js';

export type Instruction =
  | { kind: 'heading'; headingDeg: Deg }
  | { kind: 'altitude'; altitudeFt: Ft }
  | { kind: 'speed'; iasKts: Kts }
  | { kind: 'approach'; warnings: readonly string[] };

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
  const index = ac.pending.findIndex((item) => item.instruction.kind === instruction.kind);
  if (index >= 0) ac.pending[index] = entry;
  else ac.pending.push(entry);
}

/** A vector or an altitude change while on the approach cancels the clearance. */
function cancelApproach(ac: Aircraft): Readback | null {
  if (ac.phase !== 'cleared' && ac.phase !== 'loc' && ac.phase !== 'gs') return null;
  ac.phase = 'inbound';
  ac.speedAssignedAfterClearance = false;
  return { text: `${ac.callsign}, cancelling the approach clearance.`, kind: 'pilot' };
}

function apply(ac: Aircraft, instruction: Instruction): Readback[] {
  const readbacks: Readback[] = [];

  switch (instruction.kind) {
    case 'heading': {
      const cancelled = cancelApproach(ac);
      if (cancelled) readbacks.push(cancelled);
      // A vector is a departure from the route in the one way that matters:
      // the aircraft is no longer where the STAR says it should be.
      leaveStar(ac);
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
      const cancelled = cancelApproach(ac);
      if (cancelled) readbacks.push(cancelled);
      // The published profile is off, but the aircraft stays on the route.
      if (ac.star) ac.star.altitudeManual = true;
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
      // Speed control does not take an aircraft off its STAR (§4.5).
      if (ac.star) ac.star.speedManual = true;
      // IF 6.14.4 — "maintain XXX kt until X mile final" survives the clearance.
      if (ac.phase === 'cleared' || ac.phase === 'loc' || ac.phase === 'gs') {
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

    case 'approach': {
      leaveStar(ac);
      ac.phase = 'cleared';
      ac.speedAssignedAfterClearance = false;
      readbacks.push({
        text: `${ac.callsign}, cleared ILS approach runway ${AIRPORT.runway.id}.`,
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
export function applyDueInstructions(ac: Aircraft, timeS: Sec): Readback[] {
  if (ac.pending.length === 0) return [];
  const due = ac.pending.filter((item) => item.atS <= timeS);
  if (due.length === 0) return [];

  ac.pending = ac.pending.filter((item) => item.atS > timeS);
  return due.sort((a, b) => a.atS - b.atS).flatMap((item) => apply(ac, item.instruction));
}
