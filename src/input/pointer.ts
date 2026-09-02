/** Click a blip or its data block to select; click empty space to deselect. */
import type { Scope } from '../render/scope.js';
import type { SessionController } from './controller.js';

/**
 * Wheel travel that counts as one line. A trackpad delivers a few pixels per
 * event and a mouse notch delivers tens, so the deltas are accumulated and the
 * log steps a line at a time — scrolling five lines by pixel count would jump
 * the whole log on one notch.
 */
const WHEEL_PX_PER_LINE = 40;

export function bindPointer(
  canvas: HTMLCanvasElement,
  scope: Scope,
  controller: () => SessionController,
): void {
  canvas.addEventListener('pointerdown', (event) => {
    const host = controller();
    const hit = scope.pick(host.world(), event.clientX, event.clientY);
    host.select(hit ? hit.id : null);
  });

  let wheelPx = 0;
  canvas.addEventListener(
    'wheel',
    (event) => {
      // Aim before accumulating. Banking travel from a wheel the log does not
      // own means a long scroll over the traffic is paid out in full by the
      // next notch over the log — which jumped it straight to the oldest line.
      if (!scope.overMessages(event.clientX, event.clientY)) {
        wheelPx = 0;
        return;
      }
      // Up the page is back in time, as in any log.
      wheelPx += -event.deltaY;
      const lines = Math.trunc(wheelPx / WHEEL_PX_PER_LINE);
      wheelPx -= lines * WHEEL_PX_PER_LINE;
      // Claimed either way: the pointer is over the log, so the page must not
      // scroll under it while the travel is still short of a line.
      event.preventDefault();
      if (lines !== 0) scope.scrollMessages(controller().world(), lines);
    },
    { passive: false },
  );
}
