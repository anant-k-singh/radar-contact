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

/**
 * Trackpad pinch travel that doubles the scale.
 *
 * A pinch reaches the browser as a `wheel` with `ctrlKey` set and `deltaY` in the
 * same pixels a scroll uses, so the gesture is a distance rather than a factor and
 * has to be converted to one. Exponential, so pinching out and back by the same
 * distance lands exactly where it started instead of drifting.
 */
const PINCH_PX_PER_DOUBLING = 180;

export function bindPointer(
  canvas: HTMLCanvasElement,
  scope: Scope,
  controller: () => SessionController,
): void {
  canvas.addEventListener('pointerdown', (event) => {
    const host = controller();
    // A double click anywhere on the scope drops back to the fitted view. Zooming
    // in is a temporary excursion to deconflict a pair, so getting out of it has
    // to be one gesture — pinching precisely back to 1x on a trackpad is not.
    if (event.detail >= 2 && scope.isZoomed()) {
      scope.resetZoom();
      return;
    }
    const hit = scope.pick(host.world(), event.clientX, event.clientY);
    host.select(hit ? hit.id : null);
  });

  let wheelPx = 0;
  canvas.addEventListener(
    'wheel',
    (event) => {
      // A pinch is a wheel with ctrlKey — the browser reports it that way, and it
      // is checked before the log because the pointer is usually over the scope.
      // Zoom is view state, so it applies to a replay exactly as to a live scope.
      if (event.ctrlKey) {
        event.preventDefault();
        // Up (negative deltaY) is pinching out, which magnifies.
        scope.zoomAt(
          controller().world(),
          event.clientX,
          event.clientY,
          Math.pow(2, -event.deltaY / PINCH_PX_PER_DOUBLING),
        );
        return;
      }

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
