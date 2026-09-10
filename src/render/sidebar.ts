/**
 * The left-hand panel: selected-aircraft readout, a live preview of the ILS
 * clearance gate, session stats, and the session controls.
 *
 * Plain DOM on purpose — this is six fields and a log (docs §11.2).
 */
import { speedFloorKts } from '../sim/commands.js';
import type { Aircraft } from '../sim/aircraft.js';
import { isDeparture } from '../sim/aircraft.js';
import { destinationOf, requiredGapS } from '../sim/delivery.js';
import { activeSidFix } from '../sim/departure.js';
import {
  DEPARTURE_FLOW_STEP_PER_HOUR,
  GS_CAPTURE_WINDOW_FT,
  TIME_SCALE_BUTTONS,
  TIME_SCALES,
  VS_DISPLAY_STEP_FPM,
  DELIVERY_SHOW_GAIN_S,
  DELIVERY_SHOW_LOSE_S,
} from '../sim/constants.js';
import {
  evaluateClearance,
  evaluateIntercept,
  interceptPending,
  finalGeometry,
  rangeToThresholdNm,
} from '../sim/ils.js';
import { assignedAltitudeFt, assignedHeadingDeg, assignedIasKts, isPending } from '../sim/pilot.js';
import { activeFix, distanceToGoNm, legGeometry, starTargetSpeedKts } from '../sim/star.js';
import { displayHeading, distance, quantize } from '../sim/units.js';
import type { World } from '../sim/world.js';
import { selectedAircraft } from '../sim/world.js';
import type { Scenario } from '../scenario/types.js';
import { clockText } from './messageLog.js';

export interface SidebarHandlers {
  togglePause(): void;
  setTimeScale(scale: number): void;
  adjustFlow(delta: number): void;
  adjustDepartureFlow(delta: number): void;
  restart(): void;
  /** Fly a different field. A field is bound at `createWorld`, so this is a reload (A14). */
  selectAirport(id: string): void;
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

/**
 * How a field reads in the airport picker.
 *
 * A center sector shares its ICAO with the approach field it feeds — VABB and
 * VABBS are both Mumbai — so the runway is not what tells them apart, and naming
 * a runway a sector never lands on would be wrong anyway. It gives its own name.
 */
const fieldLabel = (scenario: Scenario): string =>
  scenario.role === 'center'
    ? `${scenario.icao} · ${scenario.name}`
    : `${scenario.icao} · RWY ${scenario.runway.id}`;

/** The field list is handed in: nothing under `src/render/` may name one (§11.4). */
const template = (scenarios: readonly Scenario[]): string => `
  <div class="brand" data-field="brand">APPROACH<span>RADAR</span></div>
  <div class="field-line">
    <select data-field="airport" aria-label="Airport">
      ${scenarios.map((s) => `<option value="${s.id}">${fieldLabel(s)}</option>`).join('\n      ')}
    </select>
    <span data-field="clock"></span>
  </div>

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
      <dt>Route</dt><dd data-field="star"></dd>
      <dt>Next fix</dt><dd data-field="nextfix"></dd>
      <dt>Range</dt><dd data-field="range"></dd>
    </dl>
    <dl class="detail approach-only">
      <dt>Cross-track</dt><dd data-field="xtk"></dd>
      <dt>G/S here</dt><dd data-field="gs"></dd>
      <dt>Intercept</dt><dd data-field="intercept"></dd>
      <dt>In trail</dt><dd data-field="intrail"></dd>
      <dt>Min speed</dt><dd data-field="minspd"></dd>
    </dl>
    <dl class="detail center-only">
      <dt>Deliver to</dt><dd data-field="dgate"></dd>
      <dt>Wanted every</dt><dd data-field="dgap"></dd>
      <dt>Arrives in</dt><dd data-field="deta"></dd>
      <dt>Sequence</dt><dd data-field="ddeficit"></dd>
    </dl>
    <div class="ils approach-only" data-field="ils"></div>
  </div>

  <h2 class="live-only">Controls</h2>
  <div class="keys live-only">
    <kbd>A</kbd><kbd>D</kbd> heading &nbsp; <kbd>W</kbd><kbd>S</kbd> altitude<br />
    <kbd>Q</kbd><kbd>E</kbd> speed &nbsp; <kbd>C</kbd> clear ILS<br />
    <kbd>H</kbd> hold &nbsp; <kbd>R</kbd> resume arrival<br />
    <kbd>Tab</kbd> cycle &nbsp; <kbd>Space</kbd> pause &nbsp; ${TIME_SCALES.map(
      (_, index) => `<kbd>${index + 1}</kbd>`,
    ).join('')} rate
  </div>

  <h2 class="live-only">Session controls</h2>
  <div class="buttons live-only">
    <button data-action="pause">Pause</button>
    ${TIME_SCALE_BUTTONS.map((scale) => `<button data-rate="${scale}">${scale}x</button>`).join(
      '\n    ',
    )}
  </div>
  <div class="buttons live-only">
    <button data-action="flow-down">Arr −</button>
    <span class="flow" data-field="flow"></span>
    <button data-action="flow-up">Arr +</button>
  </div>
  <div class="buttons live-only">
    <button data-action="dep-flow-down">Dep −</button>
    <span class="flow" data-field="depflow"></span>
    <button data-action="dep-flow-up">Dep +</button>
    <button data-action="restart">Restart</button>
  </div>
`;

/** `4:15` — a duration in minutes and seconds, which is how a gap is read. */
function minutesText(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/** `(−700)` / `(+1200)`, blank when the aircraft is holding its level. */
function verticalRateText(vsFpm: number): string {
  const rounded = quantize(vsFpm, VS_DISPLAY_STEP_FPM);
  if (rounded === 0) return '';
  return `(${rounded > 0 ? '+' : '−'}${Math.abs(rounded)})`;
}

export function createSidebar(
  root: HTMLElement,
  handlers: SidebarHandlers,
  scenarios: readonly Scenario[],
): Sidebar {
  root.innerHTML = template(scenarios);

  const fields = new Map<string, HTMLElement>();
  /**
   * The classes an element was authored with, kept because `set` rewrites
   * `className` wholesale and would otherwise strip them on the first update.
   * That is how the ILS box kept appearing on a center field: it is marked
   * `approach-only` in the template, and the first `set('ils', …)` deleted the
   * mark along with everything else.
   */
  const authored = new Map<string, string>();
  root.querySelectorAll<HTMLElement>('[data-field]').forEach((element) => {
    fields.set(element.dataset.field!, element);
    if (element.className) authored.set(element.dataset.field!, element.className);
  });

  const airport = fields.get('airport') as HTMLSelectElement;
  airport.addEventListener('change', () => handlers.selectAirport(airport.value));

  /**
   * The four rows an area controller actually works from (§8.3).
   *
   * `Wanted every` is the agreement itself, spelled out per aircraft rather than
   * left to be inferred from a rate in the gutter — it is the number the whole
   * job is measured against, and a player who has to divide 3600 by it before
   * every decision is being asked to do arithmetic instead of control.
   *
   * `Time to lose` is the same figure the data block prints as `L2`, at a
   * resolution worth acting on. It says what is wrong and never what to do about
   * it: choosing between speed, track miles and the hold is the exercise.
   */
  const setDelivery = (world: World, ac: Aircraft): void => {
    const slot = world.deliverySlots.get(ac.id);
    const gate = world.scenario.delivery.find((entry) => entry.fixName === destinationOf(ac));
    set('dgate', gate ? gate.fixName : '—');
    set('dgap', gate ? `${minutesText(requiredGapS(gate))}  (${gate.targetRatePerHour}/h)` : '—');
    set('deta', slot ? minutesText(slot.etaS - world.timeS) : '—');
    if (!slot) {
      set('ddeficit', '—');
    } else if (!slot.frozen) {
      // Outside the freeze horizon the order can still change, so a figure here
      // would be a guess presented as an instruction.
      set('ddeficit', 'not yet sequenced');
    } else if (slot.deficitS >= DELIVERY_SHOW_LOSE_S) {
      set('ddeficit', `lose ${minutesText(slot.deficitS)}`, 'bad');
    } else if (slot.deficitS <= -DELIVERY_SHOW_GAIN_S) {
      set('ddeficit', `${minutesText(-slot.deficitS)} in hand`);
    } else {
      set('ddeficit', 'in the slot', 'ok');
    }
  };

  const set = (name: string, text: string, className?: string): void => {
    const element = fields.get(name);
    if (!element) return;
    if (element.textContent !== text) element.textContent = text;
    const next = className ?? '';
    if (element.dataset.state !== next) {
      element.dataset.state = next;
      const base = authored.get(name);
      element.className = base ? (next ? `${base} ${next}` : base) : next;
    }
  };

  root.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest('button');
    // The rate buttons are generated from `TIME_SCALES` and carry the rate
    // itself, so adding one needs no matching case below.
    const rate = button?.dataset.rate;
    if (rate !== undefined) {
      handlers.setTimeScale(Number(rate));
      return;
    }
    switch (button?.dataset.action) {
      case 'pause':
        handlers.togglePause();
        break;
      case 'flow-down':
        handlers.adjustFlow(-5);
        break;
      case 'flow-up':
        handlers.adjustFlow(5);
        break;
      case 'dep-flow-down':
        handlers.adjustDepartureFlow(-DEPARTURE_FLOW_STEP_PER_HOUR);
        break;
      case 'dep-flow-up':
        handlers.adjustDepartureFlow(DEPARTURE_FLOW_STEP_PER_HOUR);
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
      // Which set of readouts the panel shows — see `.center-only` in style.css.
      if (root.dataset.role !== world.scenario.role) root.dataset.role = world.scenario.role;
      const replay = mode === 'replay';
      if (airport.value !== world.scenario.id) airport.value = world.scenario.id;
      // Which job the player is doing. The brand is the one piece of the panel
      // that names the position rather than describing the traffic, so it is
      // what has to change when the position does.
      const brand = fields.get('brand');
      if (brand) {
        const title = world.scenario.role === 'center' ? 'AREA' : 'APPROACH';
        if (brand.firstChild?.textContent !== title) brand.firstChild!.textContent = title;
      }
      set('clock', clockText(world.timeS));
      set('flow', `${world.flowPerHour}/h`);
      set('depflow', world.departureFlowPerHour === 0 ? 'off' : `${world.departureFlowPerHour}/h`);

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
        const geo = finalGeometry(world.scenario.runway, ac);
        set('callsign', ac.callsign);
        set('actype', `${ac.type.code} ${ac.type.wake}`);

        set('alt', String(Math.round(ac.radar.altitudeFt)));
        set('altRate', verticalRateText(ac.radar.vsFpm));
        set('altTarget', ac.phase === 'gs' ? '→ G/S' : `→ ${Math.round(assignedAltitudeFt(ac))}`);
        set('spd', String(Math.round(ac.radar.iasKts)));
        set('spdTarget', `→ ${Math.round(starTargetSpeedKts(ac) ?? assignedIasKts(ac))}`);
        set('hdg', displayHeading(ac.radar.headingDeg));
        const onRoute = ac.star !== null && !isPending(ac, 'heading');
        set(
          'hdgTarget',
          isDeparture(ac) || onRoute ? '→ route' : `→ ${displayHeading(assignedHeadingDeg(ac))}`,
        );

        // Ground speed is what the block and the spacing run on; the gap to the
        // IAS above is the altitude effect (§4.4), and printing it is the only
        // place the two numbers can be compared side by side.
        const gainKts = Math.round(ac.radar.groundSpeedKts - ac.radar.iasKts);
        set('gspd', `${Math.round(ac.radar.groundSpeedKts)} kt  (IAS +${gainKts})`);

        // A departure has no approach to report on. Everything below the route
        // is a question about final — cross-track, glideslope, intercept angle,
        // in-trail spacing — and none of them mean anything for an aircraft
        // going the other way, so they are blanked rather than filled with
        // numbers that happen to compute (§4.7).
        if (isDeparture(ac)) {
          const nav = ac.sid!;
          set('star', nav.route.name);
          set(
            'nextfix',
            nav.complete
              ? 'route complete'
              : `${activeSidFix(nav).name} · ` +
                `${distance({ x: ac.x, y: ac.y }, activeSidFix(nav).position).toFixed(1)} NM`,
          );
          for (const name of ['range', 'xtk', 'gs', 'intercept', 'intrail', 'minspd']) {
            set(name, '—');
          }
          set(
            'ils',
            ac.phase === 'roll'
              ? `Rolling runway ${world.scenario.runway.id} — with Departure.`
              : `With Departure on ${world.scenario.facility.departureFrequency} — not on your frequency.`,
            'ils done',
          );
          return;
        }

        // Which published arrival it came in on, and how it is being flown now.
        if (ac.star) {
          const nav = ac.star;
          const fix = activeFix(nav);
          const manual = [nav.altitudeManual ? 'alt' : '', nav.speedManual ? 'speed' : '']
            .filter(Boolean)
            .join(' + ');
          set('star', manual ? `${nav.route.name} (${manual} assigned)` : nav.route.name);
          set('nextfix', `${fix.name} · ${distance({ x: ac.x, y: ac.y }, fix.position).toFixed(1)} NM`);
        } else if (ac.rejoin != null && ac.rejoin.leg !== null) {
          // Armed but not established: name the leg being intercepted and how
          // far off it the aircraft still is (§4.5a).
          const { nav, leg } = ac.rejoin;
          const geo = legGeometry(nav.route, leg, ac);
          set('star', `${nav.route.name} (joining)`);
          set('nextfix', `${nav.route.waypoints[leg]!.name} · ${Math.abs(geo.xtkNm).toFixed(1)} NM off`);
        } else {
          set('star', 'vectors');
          set('nextfix', '—');
        }

        // Range to whatever this position is working towards: the threshold at
        // an approach field, and the fix the aircraft is handed on at in a
        // sector, which is 50 NM short of a runway it never sees.
        const nav = ac.star ?? ac.rejoin?.nav ?? null;
        set(
          'range',
          world.scenario.role === 'center'
            ? nav
              ? `${distanceToGoNm(ac, nav).toFixed(1)} NM to run`
              : '—'
            : `${rangeToThresholdNm(world.scenario.runway, ac).toFixed(1)} NM`,
        );
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
        set('minspd', `${speedFloorKts(world.scenario.runway, ac, world.scenario.role)} kt`);
        setDelivery(world, ac);

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
          // Not being at the localizer yet is not "doomed" — an aircraft still
          // outside the service volume or still turning back after an overshoot
          // is holding a perfectly good clearance, and must not be coloured as
          // if it had blown one (§6.1a).
          const pending = interceptPending(geo);
          const intercept = evaluateIntercept(ac, geo);
          if (pending) {
            set('ils', `Cleared ILS — ${pending}.`, 'ils');
          } else {
            set(
              'ils',
              intercept.ok
                ? 'Cleared ILS — flying the intercept.'
                : `Cleared, but will not intercept: ${intercept.reason}.`,
              intercept.ok ? 'ils ok' : 'ils bad',
            );
          }
        } else if (ac.phase === 'goAround') {
          set(
            'ils',
            replay
              ? 'Going around — off the approach and climbing.'
              : 'Going around — re-vector for another approach.',
            'ils bad',
          );
        } else {
          const result = evaluateClearance(world.scenario.airspace.mvaFt, ac, geo);
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
