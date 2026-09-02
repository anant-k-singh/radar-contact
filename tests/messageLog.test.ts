/**
 * The log's scrollback arithmetic. `scrollLog` is DOM-free — the rest of
 * `messageLog.ts` needs a canvas context, which is why only this half is tested.
 */
import { describe, expect, it } from 'vitest';
import { createLogScroll, scrollLog } from '../src/render/messageLog.js';
import { MESSAGE_LOG_SCROLLBACK, MESSAGE_LOG_VISIBLE } from '../src/sim/constants.js';

const DEEPEST = MESSAGE_LOG_SCROLLBACK - MESSAGE_LOG_VISIBLE;

describe('message log scrollback', () => {
  it('opens at the newest line', () => {
    expect(createLogScroll().offset).toBe(0);
  });

  it('scrolls back a line at a time', () => {
    const scroll = createLogScroll();
    scrollLog(scroll, 2, 40);
    expect(scroll.offset).toBe(2);
  });

  it('stops at the scrollback limit however far it is wheeled', () => {
    const scroll = createLogScroll();
    scrollLog(scroll, 500, 60);
    expect(scroll.offset).toBe(DEEPEST);
  });

  it('does not scroll past the newest line', () => {
    const scroll = createLogScroll();
    scrollLog(scroll, -3, 40);
    expect(scroll.offset).toBe(0);
  });

  // The whole point of the offset is that the visible window is a full screen
  // of lines; with fewer lines than fit there is nothing behind them to reach.
  it('will not scroll a log shorter than the window', () => {
    const scroll = createLogScroll();
    scrollLog(scroll, 5, MESSAGE_LOG_VISIBLE);
    expect(scroll.offset).toBe(0);
  });

  it('scrolls only as far as the lines that exist', () => {
    const scroll = createLogScroll();
    scrollLog(scroll, 99, MESSAGE_LOG_VISIBLE + 2);
    expect(scroll.offset).toBe(2);
  });

  // Found by wheeling the real scope: the accumulator in `bindPointer` used to
  // bank travel from wheels the log did not own, so a long scroll over the
  // traffic was paid out in full by the next notch over the log — one notch
  // jumped it straight to the oldest line. The accumulator is reset when the
  // pointer is elsewhere; this is the arithmetic that reset protects.
  it('moves one line for one line however much came before it', () => {
    const scroll = createLogScroll();
    scrollLog(scroll, 1, 40);
    expect(scroll.offset).toBe(1);
    scrollLog(scroll, 1, 40);
    expect(scroll.offset).toBe(2);
  });
});
