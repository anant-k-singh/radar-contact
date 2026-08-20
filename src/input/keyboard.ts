/** Keyboard control (docs §7.2). Each press assigns a target immediately. */
import {
  adjustAltitude,
  adjustHeading,
  adjustSpeed,
  clearForIls,
  nextSelectableId,
  toggleHold,
} from '../sim/commands.js';
import { REPLAY_SKIP_S } from '../sim/constants.js';
import { selectedAircraft } from '../sim/world.js';
import type { SessionController } from './controller.js';

export function bindKeyboard(controller: () => SessionController): void {
  window.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;

    const host = controller();
    const world = host.world();
    const key = event.key.toLowerCase();

    // Session keys work with nothing selected.
    switch (key) {
      case 'tab':
        event.preventDefault();
        host.select(nextSelectableId(world));
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
      // Scrubbing a recording. Live these do nothing: a session has no
      // recorded future to jump to and no way to unfly the last ten seconds.
      case 'arrowleft':
        event.preventDefault();
        host.skip(-REPLAY_SKIP_S);
        return;
      case 'arrowright':
        event.preventDefault();
        host.skip(REPLAY_SKIP_S);
        return;
      case 'escape':
        host.select(null);
        return;
      default:
        break;
    }

    if (!host.acceptsInstructions) return;

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
