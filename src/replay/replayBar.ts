/**
 * The recorder's control panel, bottom-right of the scope (docs §17.3).
 *
 * One element for both modes, because they are two states of one thing: while
 * the session runs it is a single button offering the recording that is being
 * taken, and once that offer is accepted the same box becomes the transport.
 * There is no start button — recording is always on, and the button says how
 * much of it there is.
 */
import { REPLAY_RATES, REPLAY_SKIP_S, REPLAY_WINDOW_S } from '../sim/constants.js';
import { clockText } from '../render/messageLog.js';
import type { Playback } from './playback.js';
import { recordingSpanS, type Recording } from './recorder.js';

export interface ReplayBarHandlers {
  /** End the live session and play back what was recorded. */
  startReplay(): void;
  /** Abandon the recording and fly a fresh session. */
  newSession(): void;
}

export interface ReplayBar {
  /** Live: `playback` is null. Replay: it drives the transport. */
  update(recording: Recording, playback: Playback | null): void;
}

const LIVE_TEMPLATE = `
  <button class="replay-start" data-action="replay">▶ Stop session &amp; watch replay</button>
  <div class="replay-note" data-field="span"></div>
`;

const REPLAY_TEMPLATE = `
  <div class="replay-head">
    <span class="replay-badge">REPLAY</span>
    <span class="replay-clock" data-field="clock"></span>
  </div>
  <input class="replay-seek" type="range" min="0" max="1000" value="0" step="1" data-field="seek" />
  <div class="replay-row">
    <button data-action="back" title="Back ${REPLAY_SKIP_S} s">−${REPLAY_SKIP_S}s</button>
    <button class="replay-play" data-action="play" data-field="play">⏸</button>
    <button data-action="forward" title="Forward ${REPLAY_SKIP_S} s">+${REPLAY_SKIP_S}s</button>
    <span class="replay-rates" data-field="rates"></span>
  </div>
  <div class="replay-row">
    <button data-action="new">New session</button>
    <span class="replay-note" data-field="hint">Click an aircraft for its whole path</span>
  </div>
`;

/** `12:34` — elapsed and total, in the session's own clock. */
function spanText(recording: Recording): string {
  const spanS = recordingSpanS(recording);
  const minutes = Math.floor(spanS / 60);
  const seconds = Math.floor(spanS % 60);
  const capped = spanS >= REPLAY_WINDOW_S - 1 ? ' (last hour)' : '';
  return `${minutes}:${String(seconds).padStart(2, '0')} recorded${capped}`;
}

export function createReplayBar(root: HTMLElement, handlers: ReplayBarHandlers): ReplayBar {
  let mode: 'live' | 'replay' | null = null;
  let fields = new Map<string, HTMLElement>();
  /** True while the pointer is on the seek bar, so playback does not fight it. */
  let scrubbing = false;
  let playback: Playback | null = null;

  const build = (next: 'live' | 'replay'): void => {
    root.innerHTML = next === 'live' ? LIVE_TEMPLATE : REPLAY_TEMPLATE;
    fields = new Map();
    root.querySelectorAll<HTMLElement>('[data-field]').forEach((element) => {
      fields.set(element.dataset.field!, element);
    });
    root.dataset.mode = next;
    mode = next;

    if (next === 'replay') {
      const rates = fields.get('rates');
      if (rates) {
        rates.innerHTML = REPLAY_RATES.map(
          (rate) => `<button data-rate="${rate}">${rate}×</button>`,
        ).join('');
      }
      const seek = fields.get('seek') as HTMLInputElement | undefined;
      seek?.addEventListener('pointerdown', () => {
        scrubbing = true;
      });
      seek?.addEventListener('input', () => {
        if (!playback) return;
        const fraction = Number(seek.value) / 1000;
        playback.seekTo(playback.startS + fraction * (playback.endS - playback.startS));
      });
      // Hand the keyboard back when the drag finishes. A focused slider eats
      // space and the arrow keys — the keyboard binding skips any focused input
      // — and its native 0.1 % step is not what those keys mean here (§17.2).
      seek?.addEventListener('change', () => seek.blur());
    }
  };

  const set = (name: string, text: string): void => {
    const element = fields.get(name);
    if (element && element.textContent !== text) element.textContent = text;
  };

  // On the window, not the slider: a drag released outside it still ends the
  // scrub, and the transport takes the clock back over.
  window.addEventListener('pointerup', () => {
    scrubbing = false;
  });

  root.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest('button');
    if (!button) return;
    const rate = button.dataset.rate;
    if (rate !== undefined) {
      playback?.setRate(Number(rate));
      return;
    }
    switch (button.dataset.action) {
      case 'replay':
        handlers.startReplay();
        break;
      case 'new':
        handlers.newSession();
        break;
      case 'play':
        playback?.togglePause();
        break;
      case 'back':
        playback?.skip(-REPLAY_SKIP_S);
        break;
      case 'forward':
        playback?.skip(REPLAY_SKIP_S);
        break;
      default:
        break;
    }
  });

  return {
    update(recording: Recording, current: Playback | null): void {
      playback = current;
      const next = current ? 'replay' : 'live';
      if (mode !== next) build(next);

      if (!current) {
        set('span', spanText(recording));
        return;
      }

      const spanS = current.endS - current.startS;
      const elapsedS = current.timeS - current.startS;
      set('clock', `${clockText(elapsedS)} / ${clockText(spanS)}`);
      // The play button shows what pressing it does, and says so explicitly
      // once the recording has run out — the next press starts it over.
      set('play', current.paused ? (current.atEnd ? '↻' : '▶') : '⏸');

      const seek = fields.get('seek') as HTMLInputElement | undefined;
      if (seek && !scrubbing) {
        const value = String(Math.round(spanS > 0 ? (elapsedS / spanS) * 1000 : 0));
        if (seek.value !== value) seek.value = value;
      }

      fields.get('rates')?.querySelectorAll<HTMLElement>('button').forEach((button) => {
        const active = Number(button.dataset.rate) === current.rate;
        if (active !== (button.dataset.active === 'on')) {
          button.dataset.active = active ? 'on' : 'off';
        }
      });
    },
  };
}
