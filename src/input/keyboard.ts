/** Keyboard control (docs §7.2). Each press assigns a target immediately. */
import {
  adjustAltitude,
  adjustHeading,
  adjustSpeed,
  clearForIls,
  selectNext,
  toggleHold,
} from '../sim/commands.js';
import { selectedAircraft, type World } from '../sim/world.js';

export interface KeyboardHost {
  world(): World;
  togglePause(): void;
  setTimeScale(scale: number): void;
}

export function bindKeyboard(host: KeyboardHost): void {
  window.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;

    const world = host.world();
    const key = event.key.toLowerCase();

    // Session keys work with nothing selected.
    switch (key) {
      case 'tab':
        event.preventDefault();
        selectNext(world);
        return;
      case ' ':
        event.preventDefault();
        host.togglePause();
        return;
      case '1':
        host.setTimeScale(1);
        return;
      case '2':
        host.setTimeScale(2);
        return;
      case '4':
        host.setTimeScale(4);
        return;
      case '8':
        host.setTimeScale(8);
        return;
      case 'escape':
        world.selectedId = null;
        return;
      default:
        break;
    }

    const ac = selectedAircraft(world);
    if (!ac) return;

    switch (key) {
      case 'a':
        adjustHeading(world, ac, -1);
        break;
      case 'd':
        adjustHeading(world, ac, 1);
        break;
      case 'w':
        adjustAltitude(world, ac, 1);
        break;
      case 's':
        adjustAltitude(world, ac, -1);
        break;
      case 'q':
        adjustSpeed(world, ac, -1);
        break;
      case 'e':
        adjustSpeed(world, ac, 1);
        break;
      case 'c':
        clearForIls(world, ac);
        break;
      case 'h':
        toggleHold(world, ac);
        break;
      default:
        return;
    }
    event.preventDefault();
  });
}
