/**
 * What input is allowed to do to the thing on screen.
 *
 * There are two implementations (both in `main.ts`): the live session, where a
 * key is an instruction to an aircraft, and playback, where the same keys drive
 * the transport and nothing can be instructed at all. Routing input through one
 * interface is what keeps a single keyboard binding for both — and what stops
 * a replay from being controllable by accident (docs §17.3).
 */
import type { World } from '../sim/world.js';

export interface SessionController {
  /** The world currently on screen — the live one, or a rebuilt replay frame. */
  world(): World;
  /**
   * Selection lives with the controller rather than on the world, because a
   * replay frame is rebuilt from the recording every redraw and anything
   * written onto it is thrown away.
   */
  select(id: number | null): void;
  /** Space: pause the session, or hold the playback. */
  togglePause(): void;
  /** 1 / 2 / 4 / 8: time acceleration live, playback rate in replay. */
  setTimeScale(scale: number): void;
  /** Arrow keys: jump within a recording. No meaning in a live session. */
  skip(deltaS: number): void;
  /** False in replay: aircraft take no instructions from a recording. */
  acceptsInstructions: boolean;
}
