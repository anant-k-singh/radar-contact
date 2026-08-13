/**
 * The left-hand panel: selected-aircraft readout, a live preview of the ILS
 * clearance gate, session stats, and the session controls.
 *
 * Plain DOM on purpose — this is six fields and a log (docs §11.2).
 */
import { AIRPORT } from '../scenario/airport.js';
import { displayHeading, speedFloorKts } from '../sim/commands.js';
import { evaluateClearance, finalGeometry, rangeToThresholdNm } from '../sim/ils.js';
import type { World } from '../sim/world.js';
import { selectedAircraft } from '../sim/world.js';
import { clockText } from './messageLog.js';

export interface SidebarHandlers {
  togglePause(): void;
  setTimeScale(scale: number): void;
  adjustFlow(delta: number): void;
  restart(): void;
}

export interface Sidebar {
  update(world: World): void;
}

const TEMPLATE = `
  <div class="brand">APPROACH<span>RADAR</span></div>
  <div class="field-line"><span data-field="airport"></span><span data-field="clock"></span></div>

  <h2>Selected</h2>
  <div class="panel">
    <div class="callsign"><span data-field="callsign">— none —</span><em data-field="actype"></em></div>
    <div class="readout">
      <label>Altitude</label>
      <div class="digits"><span data-field="alt"></span><i data-field="altTarget"></i></div>
      <label>Speed</label>
      <div class="digits"><span data-field="spd"></span><i data-field="spdTarget"></i></div>
      <label>Heading</label>
      <div class="digits"><span data-field="hdg"></span><i data-field="hdgTarget"></i></div>
    </div>
    <dl class="detail">
      <dt>Range</dt><dd data-field="range"></dd>
      <dt>Cross-track</dt><dd data-field="xtk"></dd>
      <dt>G/S here</dt><dd data-field="gs"></dd>
      <dt>Intercept</dt><dd data-field="intercept"></dd>
      <dt>Min speed</dt><dd data-field="minspd"></dd>
    </dl>
    <div class="ils" data-field="ils"></div>
  </div>

  <h2>Session</h2>
  <dl class="detail stats">
    <dt>Landings</dt><dd data-field="landings"></dd>
    <dt>Handed off</dt><dd data-field="handoffs"></dd>
    <dt>Violations</dt><dd data-field="violations"></dd>
    <dt>Go-arounds</dt><dd data-field="goarounds"></dd>
    <dt>Airspace exits</dt><dd data-field="exits"></dd>
    <dt>Track miles</dt><dd data-field="trackmiles"></dd>
    <dt>Refused ILS</dt><dd data-field="rejections"></dd>
  </dl>

  <h2>Controls</h2>
  <div class="keys">
    <kbd>A</kbd><kbd>D</kbd> heading &nbsp; <kbd>W</kbd><kbd>S</kbd> altitude<br />
    <kbd>Q</kbd><kbd>E</kbd> speed &nbsp; <kbd>C</kbd> clear ILS<br />
    <kbd>Tab</kbd> cycle &nbsp; <kbd>Space</kbd> pause &nbsp; <kbd>1</kbd><kbd>2</kbd><kbd>4</kbd> rate
  </div>

  <h2>Session controls</h2>
  <div class="buttons">
    <button data-action="pause">Pause</button>
    <button data-action="rate1">1x</button>
    <button data-action="rate2">2x</button>
    <button data-action="rate4">4x</button>
  </div>
  <div class="buttons">
    <button data-action="flow-down">Flow −</button>
    <span class="flow" data-field="flow"></span>
    <button data-action="flow-up">Flow +</button>
    <button data-action="restart">Restart</button>
  </div>
`;

export function createSidebar(root: HTMLElement, handlers: SidebarHandlers): Sidebar {
  root.innerHTML = TEMPLATE;

  const fields = new Map<string, HTMLElement>();
  root.querySelectorAll<HTMLElement>('[data-field]').forEach((element) => {
    fields.set(element.dataset.field!, element);
  });

  const set = (name: string, text: string, className?: string): void => {
    const element = fields.get(name);
    if (!element) return;
    if (element.textContent !== text) element.textContent = text;
    const next = className ?? '';
    if (element.dataset.state !== next) {
      element.dataset.state = next;
      element.className = next;
    }
  };

  root.addEventListener('click', (event) => {
    const action = (event.target as HTMLElement).closest('button')?.dataset.action;
    switch (action) {
      case 'pause':
        handlers.togglePause();
        break;
      case 'rate1':
        handlers.setTimeScale(1);
        break;
      case 'rate2':
        handlers.setTimeScale(2);
        break;
      case 'rate4':
        handlers.setTimeScale(4);
        break;
      case 'flow-down':
        handlers.adjustFlow(-5);
        break;
      case 'flow-up':
        handlers.adjustFlow(5);
        break;
      case 'restart':
        handlers.restart();
        break;
      default:
        break;
    }
  });

  return {
    update(world: World): void {
      set('airport', `${AIRPORT.icao} · RWY ${AIRPORT.runway.id}`);
      set('clock', clockText(world.timeS));
      set('flow', `${world.flowPerHour}/h`);

      const ac = selectedAircraft(world);
      if (!ac) {
        set('callsign', '— none —');
        set('actype', '');
        for (const name of ['alt', 'spd', 'hdg', 'altTarget', 'spdTarget', 'hdgTarget']) {
          set(name, '');
        }
        for (const name of ['range', 'xtk', 'gs', 'intercept', 'minspd']) set(name, '—');
        set('ils', 'Click an aircraft or press Tab.', 'ils idle');
      } else {
        const geo = finalGeometry(ac);
        set('callsign', ac.callsign);
        set('actype', `${ac.type.code} ${ac.type.wake}`);

        set('alt', String(Math.round(ac.radar.altitudeFt)));
        set('altTarget', ac.phase === 'gs' ? '→ G/S' : `→ ${ac.targetAltitudeFt}`);
        set('spd', String(Math.round(ac.radar.iasKts)));
        set('spdTarget', `→ ${Math.round(ac.targetIasKts)}`);
        set('hdg', displayHeading(ac.radar.headingDeg));
        set('hdgTarget', `→ ${displayHeading(ac.targetHeadingDeg)}`);

        set('range', `${rangeToThresholdNm(ac).toFixed(1)} NM`);
        set(
          'xtk',
          geo.alongNm > 0
            ? `${Math.abs(geo.xtkNm).toFixed(1)} NM ${geo.xtkNm >= 0 ? 'R' : 'L'}`
            : 'past threshold',
        );
        set('gs', geo.alongNm > 0 ? `${Math.round(geo.gsAltitudeFt)} ft` : '—');
        set('intercept', `${Math.round(geo.interceptAngleDeg)}°`);
        set('minspd', `${speedFloorKts(ac)} kt`);

        if (ac.handedOff) {
          set('ils', 'With Tower.', 'ils done');
        } else if (ac.phase === 'gs') {
          set('ils', 'Established — on the glideslope.', 'ils ok');
        } else if (ac.phase === 'loc') {
          set('ils', 'On the localizer, waiting for the glideslope.', 'ils ok');
        } else if (ac.phase === 'cleared') {
          set('ils', 'Cleared ILS — flying the intercept.', 'ils ok');
        } else if (ac.phase === 'goAround') {
          set('ils', 'Going around — re-vector for another approach.', 'ils bad');
        } else {
          const result = evaluateClearance(ac, geo);
          set(
            'ils',
            result.ok ? 'ILS ready — press C to clear.' : `Cannot clear: ${result.reason}.`,
            result.ok ? 'ils ok' : 'ils bad',
          );
        }
      }

      const stats = world.stats;
      set('landings', String(stats.landings));
      set('handoffs', String(stats.handoffs));
      set(
        'violations',
        stats.violations === 0
          ? '0'
          : `${stats.violations}  (${Math.round(stats.violationSeconds)}s)`,
        stats.violations > 0 ? 'bad' : '',
      );
      set('goarounds', String(stats.goArounds), stats.goArounds > 0 ? 'warn' : '');
      set('exits', String(stats.exits), stats.exits > 0 ? 'warn' : '');
      set(
        'trackmiles',
        stats.trackMileSamples > 0
          ? `${(stats.trackMileRatioSum / stats.trackMileSamples).toFixed(2)}×`
          : '—',
      );
      const rejections = [...stats.rejections.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([code, count]) => `${code} ${count}`)
        .join(', ');
      set('rejections', rejections || '0');
    },
  };
}
