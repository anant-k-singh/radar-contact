/**
 * The left-hand panel: selected-aircraft readout, a live preview of the ILS
 * clearance gate, session stats, and the session controls.
 *
 * Plain DOM on purpose — this is six fields and a log (docs §11.2).
 */
import { AIRPORT } from '../scenario/airport.js';
import { speedFloorKts } from '../sim/commands.js';
import { GS_CAPTURE_WINDOW_FT, VS_DISPLAY_STEP_FPM } from '../sim/constants.js';
import {
  evaluateClearance,
  evaluateIntercept,
  finalGeometry,
  rangeToThresholdNm,
} from '../sim/ils.js';
import { assignedAltitudeFt, assignedHeadingDeg, assignedIasKts, isPending } from '../sim/pilot.js';
import { activeFix, starTargetSpeedKts } from '../sim/star.js';
import { displayHeading, distance, quantize } from '../sim/units.js';
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
  /**
   * `replay` hides the session controls and the key list — none of them act on
   * a recording — and drops the instruction prompts from the clearance
   * preview, which becomes a description of what was happening rather than an
   * offer to change it (docs §17.3).
   */
  update(world: World, mode?: 'live' | 'replay'): void;
}

const TEMPLATE = `
  <div class="brand">APPROACH<span>RADAR</span></div>
  <div class="field-line"><span data-field="airport"></span><span data-field="clock"></span></div>

  <h2>Selected</h2>
  <div class="panel">
    <div class="callsign"><span data-field="callsign">— none —</span><em data-field="actype"></em></div>
    <div class="readout">
      <label>Altitude</label>
      <div class="digits"><span data-field="alt"></span><u data-field="altRate"></u><i data-field="altTarget"></i></div>
      <label>Speed (IAS)</label>
      <div class="digits"><span data-field="spd"></span><i data-field="spdTarget"></i></div>
      <label>Heading</label>
      <div class="digits"><span data-field="hdg"></span><i data-field="hdgTarget"></i></div>
    </div>
    <dl class="detail">
      <dt>Ground speed</dt><dd data-field="gspd"></dd>
      <dt>Arrival</dt><dd data-field="star"></dd>
      <dt>Next fix</dt><dd data-field="nextfix"></dd>
      <dt>Range</dt><dd data-field="range"></dd>
      <dt>Cross-track</dt><dd data-field="xtk"></dd>
      <dt>G/S here</dt><dd data-field="gs"></dd>
      <dt>Intercept</dt><dd data-field="intercept"></dd>
      <dt>In trail</dt><dd data-field="intrail"></dd>
      <dt>Min speed</dt><dd data-field="minspd"></dd>
    </dl>
    <div class="ils" data-field="ils"></div>
  </div>

  <h2 class="live-only">Controls</h2>
  <div class="keys live-only">
    <kbd>A</kbd><kbd>D</kbd> heading &nbsp; <kbd>W</kbd><kbd>S</kbd> altitude<br />
    <kbd>Q</kbd><kbd>E</kbd> speed &nbsp; <kbd>C</kbd> clear ILS &nbsp; <kbd>H</kbd> hold<br />
    <kbd>Tab</kbd> cycle &nbsp; <kbd>Space</kbd> pause &nbsp; <kbd>1</kbd><kbd>2</kbd><kbd>4</kbd><kbd>8</kbd> rate
  </div>

  <h2 class="live-only">Session controls</h2>
  <div class="buttons live-only">
    <button data-action="pause">Pause</button>
    <button data-action="rate1">1x</button>
    <button data-action="rate2">2x</button>
    <button data-action="rate4">4x</button>
    <button data-action="rate8">8x</button>
  </div>
  <div class="buttons live-only">
    <button data-action="flow-down">Flow −</button>
    <span class="flow" data-field="flow"></span>
    <button data-action="flow-up">Flow +</button>
    <button data-action="restart">Restart</button>
  </div>
`;

/** `(−700)` / `(+1200)`, blank when the aircraft is holding its level. */
function verticalRateText(vsFpm: number): string {
  const rounded = quantize(vsFpm, VS_DISPLAY_STEP_FPM);
  if (rounded === 0) return '';
  return `(${rounded > 0 ? '+' : '−'}${Math.abs(rounded)})`;
}

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
      case 'rate8':
        handlers.setTimeScale(8);
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
    update(world: World, mode: 'live' | 'replay' = 'live'): void {
      if (root.dataset.mode !== mode) root.dataset.mode = mode;
      const replay = mode === 'replay';
      set('airport', `${AIRPORT.icao} · RWY ${AIRPORT.runway.id}`);
      set('clock', clockText(world.timeS));
      set('flow', `${world.flowPerHour}/h`);

      const ac = selectedAircraft(world);
      if (!ac) {
        set('callsign', '— none —');
        set('actype', '');
        for (const name of [
          'alt',
          'spd',
          'hdg',
          'altRate',
          'altTarget',
          'spdTarget',
          'hdgTarget',
        ]) {
          set(name, '');
        }
        for (const name of [
          'gspd',
          'star',
          'nextfix',
          'range',
          'xtk',
          'gs',
          'intercept',
          'intrail',
          'minspd',
        ]) {
          set(name, '—');
        }
        set('ils', 'Click an aircraft or press Tab.', 'ils idle');
      } else {
        const geo = finalGeometry(ac);
        set('callsign', ac.callsign);
        set('actype', `${ac.type.code} ${ac.type.wake}`);

        set('alt', String(Math.round(ac.radar.altitudeFt)));
        set('altRate', verticalRateText(ac.radar.vsFpm));
        set('altTarget', ac.phase === 'gs' ? '→ G/S' : `→ ${Math.round(assignedAltitudeFt(ac))}`);
        set('spd', String(Math.round(ac.radar.iasKts)));
        set('spdTarget', `→ ${Math.round(starTargetSpeedKts(ac) ?? assignedIasKts(ac))}`);
        set('hdg', displayHeading(ac.radar.headingDeg));
        const onRoute = ac.star !== null && !isPending(ac, 'heading');
        set('hdgTarget', onRoute ? '→ route' : `→ ${displayHeading(assignedHeadingDeg(ac))}`);

        // Ground speed is what the block and the spacing run on; the gap to the
        // IAS above is the altitude effect (§4.4), and printing it is the only
        // place the two numbers can be compared side by side.
        const gainKts = Math.round(ac.radar.groundSpeedKts - ac.radar.iasKts);
        set('gspd', `${Math.round(ac.radar.groundSpeedKts)} kt  (IAS +${gainKts})`);

        // Which published arrival it came in on, and how it is being flown now.
        if (ac.star) {
          const nav = ac.star;
          const fix = activeFix(nav);
          const manual = [nav.altitudeManual ? 'alt' : '', nav.speedManual ? 'speed' : '']
            .filter(Boolean)
            .join(' + ');
          set('star', manual ? `${nav.route.name} (${manual} assigned)` : nav.route.name);
          set('nextfix', `${fix.name} · ${distance({ x: ac.x, y: ac.y }, fix.position).toFixed(1)} NM`);
        } else {
          set('star', 'vectors');
          set('nextfix', '—');
        }

        set('range', `${rangeToThresholdNm(ac).toFixed(1)} NM`);
        set(
          'xtk',
          geo.alongNm > 0
            ? `${Math.abs(geo.xtkNm).toFixed(1)} NM ${geo.xtkNm >= 0 ? 'R' : 'L'}`
            : 'past threshold',
        );
        set('gs', geo.alongNm > 0 ? `${Math.round(geo.gsAltitudeFt)} ft` : '—');
        set('intercept', `${Math.round(geo.interceptAngleDeg)}°`);

        // Spacing to the aircraft ahead on final, against the minimum in force
        // — 4 NM once the runway has to be vacated in time (§9.3).
        const spacingNm = world.separation.inTrail.get(ac.id);
        const minimumNm = world.separation.inTrailMinimum.get(ac.id);
        if (spacingNm === undefined || minimumNm === undefined) {
          set('intrail', '—');
        } else {
          set(
            'intrail',
            `${spacingNm.toFixed(1)} NM  (min ${minimumNm.toFixed(0)})`,
            spacingNm < minimumNm ? 'bad' : '',
          );
        }
        set('minspd', `${speedFloorKts(ac)} kt`);

        if (ac.handedOff) {
          set('ils', 'With Tower.', 'ils done');
        } else if (ac.phase === 'gs') {
          set('ils', 'Established — on the glideslope.', 'ils ok');
        } else if (ac.phase === 'loc') {
          // Waiting for a glideslope that is falling away below is not waiting,
          // it is a go-around at 5 NM. Say so while it can still be descended.
          const aboveFt = ac.altitudeFt - geo.gsAltitudeFt;
          set(
            'ils',
            aboveFt > GS_CAPTURE_WINDOW_FT
              ? `On the localizer — ${Math.round(aboveFt)} ft above the glideslope, will not capture.`
              : 'On the localizer, waiting for the glideslope.',
            aboveFt > GS_CAPTURE_WINDOW_FT ? 'ils bad' : 'ils ok',
          );
        } else if (ac.phase === 'cleared') {
          // The clearance is a prediction; show whether it is currently coming
          // true, so a doomed intercept can be fixed before the localizer.
          const intercept = evaluateIntercept(ac, geo);
          set(
            'ils',
            intercept.ok
              ? 'Cleared ILS — flying the intercept.'
              : `Cleared, but will not intercept: ${intercept.reason}.`,
            intercept.ok ? 'ils ok' : 'ils bad',
          );
        } else if (ac.phase === 'goAround') {
          set(
            'ils',
            replay
              ? 'Going around — off the approach and climbing.'
              : 'Going around — re-vector for another approach.',
            'ils bad',
          );
        } else {
          const result = evaluateClearance(ac, geo);
          const ready = replay ? 'ILS available — inside the clearance gate.' : 'ILS ready — press C to clear.';
          set(
            'ils',
            result.ok ? ready : `Cannot clear: ${result.reason}.`,
            result.ok ? 'ils ok' : 'ils bad',
          );
        }
      }

      // Session stats moved to the scope's top-right gutter (statsLayer.ts).
    },
  };
}
