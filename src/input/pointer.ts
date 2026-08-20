/** Click a blip or its data block to select; click empty space to deselect. */
import type { Scope } from '../render/scope.js';
import type { SessionController } from './controller.js';

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
}
