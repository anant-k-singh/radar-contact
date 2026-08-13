/** Click a blip or its data block to select; click empty space to deselect. */
import type { Scope } from '../render/scope.js';
import type { World } from '../sim/world.js';

export function bindPointer(canvas: HTMLCanvasElement, scope: Scope, world: () => World): void {
  canvas.addEventListener('pointerdown', (event) => {
    const current = world();
    const hit = scope.pick(current, event.clientX, event.clientY);
    current.selectedId = hit ? hit.id : null;
  });
}
