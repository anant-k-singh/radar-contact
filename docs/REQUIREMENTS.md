# Approach Radar Simulator — Requirements & Design Plan

**Status:** v1 built and playable · **Date:** 2026-08-14 · **Owner:** Anant

A browser-based, single-airport **approach radar** simulator. The player is the Approach
controller: accept arrivals handed over from Center at fixed entry gates, sequence and vector
them onto a single ILS, maintain separation, and hand off to Tower once established.

Inspiration: *Endless ATC* (mobile) for the scope look and control feel; *Infinite Flight ATC
Manual* for the procedural rules.

---

## 1. Scope

### 1.1 In scope (v1)

- One airport, one runway, one landing direction, sea-level elevation.
- 50 NM radar circle. Everything outside is Center (computer-controlled).
- Arrivals only. No departures, no VFR, no overflights, no ground/tower workload.
- ILS approaches only (no visual, no GPS/RNAV, no circling).
- Heading / altitude / speed vectoring via keyboard; ILS clearance via keyboard.
- Separation monitoring with conflict alerts.
- Automatic handoff to Tower when established; aircraft despawns at touchdown.
- Endless play at a configurable arrival flow rate, with a session stats panel.

### 1.2 Explicitly out of scope (v1) — parked for later

| Deferred | Why parked |
| --- | --- |
| Departures / mixed traffic | Doubles the state machine and the conflict logic |
| Holding patterns | Needs a hold entry/exit model; vectoring is enough to absorb delay in v1 |
| Wind (and therefore IAS vs GS divergence from wind) | Big complexity driver in intercept geometry; altitude-based TAS is modelled, wind is not |
| Terrain / MVA map | Single flat MVA constant instead |
| Parallel runways & reduced parallel separation | Only meaningful with ≥2 runways |
| Multiple airports, sector handoffs between radar positions | v2+ |
| Wake-turbulence spacing categories as a *rule* | Category is displayed, but 3 NM in-trail is the only spacing rule in v1 |
| Voice / phraseology audio, pilot "unable" negotiation | Text readback log only |
| Touch / mobile controls | Desktop keyboard + mouse only |
| Multiplayer, accounts, backend | Static site, no server |

---

## 2. Source material and the rules derived from it

All quantitative rules below come from the Infinite Flight ATC Manual (radar chapter) or from
standard flight-dynamics relationships. Citations are given so the numbers can be re-checked.

### 2.1 Separation — [IF 6.2](https://infiniteflight.com/guide/atc-manual/6.-radar/6.2-separation)

> 6.2.2 — "aircraft must be no closer than **3 nm laterally or 1000 ft vertically** at all times."

> 6.2.4 collision alert table — Red target: `<1000 ft and/or 3 nm`; Red target + audible alarm:
> `<500 ft and/or 1.5 nm`.

Derived rules → §9.

### 2.2 ILS approach — [IF 6.11](https://infiniteflight.com/guide/atc-manual/6.-radar/6.11-instrument-landing-system-(ils)-approach)

- 6.11.3 — intercept heading should be **as close to 30° as possible** off the final approach
  course; **≤10° should be avoided** (too shallow to close).
- 6.11.4 — to intercept the glideslope the aircraft must be **below** the G/S. Typical G/S is a
  **3° path** to the threshold: **300 ft AAL at 1 NM, 600 ft at 2 NM**, and so on.
- 6.11.5 — a clearance may be issued without an intercept heading if the intercept angle is
  "reasonable" (~30°) **or** the aircraft joins the extended final **at 20 NM or greater**. An
  altitude must still be assigned as the lowest authorised altitude until established.
- 6.11.6 — the ILS cone is ~**11 NM** long, so G/S altitude there is ~**3500 ft AAL**. Intercept
  altitude should be below the G/S at the intercept point — **by convention 500 ft lower**.

### 2.3 Handover to Tower — [IF 6.14](https://infiniteflight.com/guide/atc-manual/6.-radar/6.14-handover-to-towerunicom)

- 6.14.1 — before handover the aircraft must be **established on the intended approach path**
  **AND** have an **acceptable closure rate with the aircraft ahead**.
- 6.14.2 — for ILS, "established" means the **LOC is intercepted**. "Do not confuse aircraft being
  established on the LOC with being in the cone — aircraft must be **aligned with the centerline**
  … regardless of their position inside or outside of the cone."
- 6.14.3 — example of an unacceptable closure rate: lead at 180 kt GS on final, follower
  intercepting at 250 kt GS with only 3 NM spacing → go-around risk. "Aircraft should be kept on
  frequency until separation is assured."

### 2.4 Speed control — [IF 6.15](https://infiniteflight.com/guide/atc-manual/6.-radar/6.15-aircraft-speed)

- 6.15.3 — IAS→GS drift with altitude at 250 kt IAS, no wind: 3000 ft ≈ 260 (+10), 6000 ft ≈ 270
  (+20), 9000 ft ≈ 290 (+40), 12000 ft ≈ 300 (+50). → ~**2 % per 1000 ft**, which is the standard
  TAS rule of thumb.
- Speed Control box — "choose **2–3 common speeds (such as 250 kts, 210 kts and 180 kts)**… Using
  the same speed assignments helps standardize the approach."
- 6.15.6 — reduce the *trailing* aircraft first (or speed the lead up first); allow **sufficient
  time and distance** for speed changes, especially at high altitude / clean configuration.
- 6.15.8 — **avoid slowing aircraft below clean speed until within 20 track miles** of touchdown;
  "expeditious approaches are only possible if aircraft keep their speed up until close in."
- 6.15.10 — once cleared for the approach, **speed is at the aircraft's discretion** unless a
  further speed command is issued.

### 2.5 Turn performance (standard aerodynamics)

- A **standard rate turn is 3°/s** (360° in two minutes).
  ([Wikipedia](https://en.wikipedia.org/wiki/Standard_rate_turn))
- Airliners limit normal manoeuvring bank to **25–30°**; above a certain speed they *cannot* hold
  standard rate without exceeding that bank, so the turn rate degrades.
  ([Pilot Institute](https://pilotinstitute.com/standard-rate-turns-explained/))
- Rate of turn: `ω (°/s) = 1091 · tan(bank) / TAS(kt)`. At **25° bank** → `ω = 509 / TAS`.

| TAS | ω at 25° bank | Turn radius |
| --- | --- | --- |
| 290 kt (250 IAS @ 8000 ft) | 1.75 °/s | 2.6 NM |
| 250 kt | 2.03 °/s | 1.95 NM |
| 210 kt | 2.42 °/s | 1.4 NM |
| 180 kt | 2.83 °/s | 1.0 NM |
| 160 kt | 3.0 °/s (capped) | 0.8 NM |

**Model:** `ω = min(3.0, 509 / TAS)` °/s. A 180° turn therefore takes ~90 s at 180 kt but ~103 s
at 290 kt — the "vectors cost more track miles when fast" lesson comes out for free.

---

## 3. Airspace and airport definition

All of this lives in one data file (`scenario/airport.ts`) so a second airport is a data change,
not a code change.

### 3.1 Geometry

- **Coordinate frame:** local flat Cartesian, origin at the Airport Reference Point (ARP).
  `x` = east (NM), `y` = north (NM). At 50 NM the earth-curvature error is well under the width of
  a radar blip, so **no geodesy, no lat/lon, no projection** — a deliberate simplification.
- **Radar circle:** 50 NM radius, centred on ARP. Range rings drawn at 10, 20, 30, 40, 50 NM.
- **Runway:** single, **RWY 18** (final approach course **180°**), length 1.6 NM. Landing direction
  is fixed (no runway changes in v1). Magnetic variation = 0, so heading = track = true bearing.
- **Threshold of 18** sits at `(0, +0.8)` NM, i.e. the north end. Aircraft land southbound.
- **Extended centerline:** drawn from the threshold on **000°** out to 20 NM, with **tick marks
  every 2 NM** (10 ticks). This is the primary visual sequencing aid.
- **Airport elevation: 0 ft.** Therefore AAL = MSL and all altitudes are plain feet.
- **Minimum vectoring altitude (MVA): 2000 ft** everywhere inside the circle. No terrain.

### 3.2 Entry gates (Center → Approach handover points)

Four gates on the 50 NM boundary, spaced 90° apart and deliberately offset from the final approach
course so nothing arrives already lined up on the LOC:

| Gate | Bearing from ARP | Inbound heading at entry | Handover altitude |
| --- | --- | --- | --- |
| KOVAL | 040° | 220° | **7000 ft** |
| TEMBA | 130° | 310° | 8000 ft |
| RIMOL | 230° | 050° | 8000 ft |
| VANDA | 320° | 140° | **7000 ft** |

**Center's handover contract:** every aircraft appears exactly at its gate at its gate altitude,
**250 kt IAS**, **heading direct to the ARP**, level and steady.

KOVAL and VANDA lie north of the field — the same side as the final approach course for runway 18 —
so their arrivals reach the localizer with far fewer track miles in which to lose the height. Center
hands those two over 1000 ft lower, which puts them at the 7000 ft G/S intercept range (22.0 NM)
instead of 8000 ft (25.1 NM). The gate marker on the scope carries its altitude in hundreds
(`KOVAL 70`).

### 3.3 Player authority limits

| Parameter | Range | Step |
| --- | --- | --- |
| Heading | 010–360 | 10° |
| Altitude | 2000–10,000 ft | 1000 ft |
| Speed (IAS) | 180–250 kt outside 20 track miles; **160**–250 kt within | 10 kt |

Aircraft enter at 7000–8000 ft, but the assignable ceiling is **10,000 ft** so climbs are available as a
de-confliction tool and a queue can be stacked vertically above the entry altitude. Nine usable
levels between MVA and ceiling.

The 180 kt floor outside 20 track miles enforces IF 6.15.8 rather than merely suggesting it. An
attempt to go below it is rejected with a log message explaining why.

**Intercept altitude reference** (3° G/S, 318 ft/NM — the number the player needs internalised):

| Assigned altitude | G/S intercept distance from threshold |
| --- | --- |
| 2000 ft | 6.3 NM |
| 3000 ft | 9.4 NM |
| 4000 ft | 12.6 NM |
| 5000 ft | 15.7 NM |
| 6000 ft | 18.8 NM |
| 7000 ft | 22.0 NM |
| 8000 ft | 25.1 NM |
| 9000 ft | 28.3 NM — beyond LOC coverage; stacking altitude only |
| 10,000 ft | 31.4 NM — beyond LOC coverage; stacking altitude only |

The top two levels sit outside the 25 NM LOC capture window (§6.1 condition 5), so they are for
holding traffic down-level and de-conflicting, not for intercepts.

---

### 3.4 Leaving the airspace

There are no holding patterns in v1, so the 50 NM boundary is the real constraint on how long you
can defer a sequencing decision. Crossing it outbound is a **scored failure, not a soft wall**:

- When an aircraft's position passes 50 NM from the ARP while tracking outbound, it is handed back
  to Center, **despawns**, and the session logs an **airspace exit** (§8).
- Log line: `KLM133 leaving your airspace, returned to Center.`
- A warning fires at 45 NM outbound (`amber` data block) so the exit is never a surprise.
- Aircraft are *not* prevented from crossing, and are *not* auto-turned back. The boundary has to
  cost something or vectoring is unconstrained and the airspace stops being a puzzle.

Consequence for the player: absorbing delay means using the full 50 NM with turns and speed, not
running someone off the edge of the scope. This is the pressure that makes holding patterns worth
adding in v2.

## 4. Aircraft model

### 4.1 State

As built, in [`src/sim/aircraft.ts`](../src/sim/aircraft.ts):

```ts
type Phase = 'inbound' | 'cleared' | 'loc' | 'gs' | 'goAround';

interface Aircraft {
  id: number;
  callsign: string;              // e.g. "KLM133"
  type: AircraftType;            // performance + wake category

  // Live kinematic state
  x: Nm; y: Nm;                  // local flat frame, x east / y north
  altitudeFt: Ft;
  headingDeg: Deg;
  iasKts: Kts;
  vsFpm: Fpm;

  // Controller targets
  targetHeadingDeg: Deg;         // multiples of 10
  targetAltitudeFt: Ft;          // multiples of 1000
  targetIasKts: Kts;             // multiples of 10

  // Approach state
  phase: Phase;
  handedOff: boolean;
  speedAssignedAfterClearance: boolean;   // IF 6.14.4

  // Bookkeeping and display
  entryGate: string;
  trackMilesFlown: Nm;
  directDistanceNm: Nm;
  trail: Point[];                // history dots, one per 5 s
  radar: RadarReturn;            // the 1 Hz snapshot the data block shows
  alert: 'none' | 'warning' | 'violation';
}
```

`handedOff` is deliberately *not* a phase: an aircraft handed to Tower keeps
flying its approach, it just stops accepting instructions.

### 4.2 Types and performance

| Type | Wake | Vapp | Min clean | Descent | Climb | Accel/Decel budget |
| --- | --- | --- | --- | --- | --- | --- |
| A320 / B738 / E190 | M | 140 kt | 180 kt | 1800 fpm | 1800 fpm | baseline |
| A332 / B77W / B788 | H | 145 kt | 190 kt | 1600 fpm | 1400 fpm | 0.85 × baseline |

Kept deliberately thin: two performance classes, several type codes mapping onto them. Enough to
make heavies feel heavier without a performance database.

### 4.3 Dynamics — the "targets take time" mechanic

Every parameter moves toward its target at a bounded rate. Nothing snaps.

**Heading.** Turn the short way at `ω = min(3.0, 509 / TAS)` °/s. No turn anticipation, no
roll-in/roll-out lag in v1 (roll dynamics are invisible at 1 Hz radar resolution).

**TAS.** `TAS = IAS × (1 + 0.02 × altitude_ft / 1000)`. Ground speed = TAS (no wind). This
reproduces IF 6.15.3's table: 250 IAS at 9000 ft → 295 kt.

**Vertical + speed coupling (the core mechanic you asked about).** Modelled with *total energy*
rather than an arbitrary penalty, because the real constraint is that a jet at idle can dissipate
energy only so fast, and it does not care whether that energy leaves as altitude or as speed.

Specific energy height: `H_e = h + V² / 2g`. Converting a speed change into its altitude
equivalent: `Δh_equiv = (V / g) · ΔV`.

```
Worked example — descend AND slow simultaneously:
  Aircraft at 250 kt (422 ft/s), asked to descend 1800 fpm and reduce 250 → 230 kt.
  Energy-equivalent of 20 kt at 250 kt:  Δh = (422 / 32.2) × 33.8 ft/s = 443 ft.
  Idle + partial speedbrake budget:      2500 fpm of energy loss.
  Descent consumes 1800 fpm → 700 fpm left for deceleration.
  443 ft / 700 fpm ≈ 38 s  →  effective deceleration ≈ 0.53 kt/s.
Versus level flight: the full 2500 fpm budget goes to speed → ≈ 1.9 kt/s (clamped to the
airframe's 1.0 kt/s comfort limit).
```

Implementation:

- `ENERGY_BUDGET_FPM = 2500` (dissipation, i.e. descending/decelerating).
- `THRUST_BUDGET_FPM = 2200` (addition, i.e. climbing/accelerating).
- Comfort clamps: `|decel| ≤ 1.0 kt/s`, `|accel| ≤ 0.8 kt/s`, `|vs| ≤ type descent/climb rate`.
- **Priority:** altitude first (a descent clearance is firm), speed gets the remainder — but with
  a **guaranteed minimum of 0.3 kt/s** for speed, taken back out of the vertical rate if needed,
  so an aircraft never looks frozen at the wrong speed.
- Capture: within 200 ft of target altitude the vertical rate tapers; within 3 kt of target speed
  it snaps. Prevents oscillation at 1 Hz sampling.

Consequences the player will feel, all emergent: a descent-and-slow combination takes ~2× as long
as either alone; asking for both late in the sequence blows the spacing; and the fix is to slow
*first* in level flight, then descend — exactly the real technique.

### 4.4 Traffic generation

- **Flow rate:** arrivals entering the airspace per hour. Default **25/h** (matching the
  screenshot). Configurable 10–40.
- **Spawn timing:** exponential inter-arrival intervals (Poisson process), mean `3600 / flow`
  seconds, clamped to a minimum of 45 s so the queue can't clump absurdly.
- **Gate choice:** uniform random over the four gates, with a constraint: **no two spawns at the
  same gate within 90 s** (at 290 kt TAS that guarantees ~7 NM initial in-trail separation).
- **Spawn veto:** if a candidate spawn would be within 5 NM / 1000 ft of any existing aircraft, the
  spawn is deferred to the next tick. Center never hands over a conflict.
- **Callsigns:** `<airline><2–4 digits>` from a small airline table (KLM, BAW, DLH, AFR, UAE, SIA,
  IGO, AIC, QTR, THY). Uniqueness enforced against live traffic.
- **Determinism:** all randomness from a single seeded PRNG (mulberry32). A seed reproduces a
  session exactly — essential for debugging and for replayable "scenarios" later.

---

## 5. Simulation loop

Three distinct rates, which is the whole design of the loop:

| Rate | What runs at it |
| --- | --- |
| **20 Hz** (dt = 0.05 s), fixed timestep | Physics: turn, vertical, speed integration, LOC/GS capture, separation checks |
| **20 fps** | Scope redraw — glyph position, leader line. Motion reads as smooth |
| **1 Hz** | "Radar return": data-block values (altitude, speed, heading) and conflict-alert level for display |
| **0.2 Hz** | History dots. At 250 kt a 1 Hz dot moves ~0.6 px on a 50 NM scope — invisible. One dot every 5 s, six retained, gives 30 s of visible history, which is also how a real scope's slower sweep looks |

- Physics and rendering share the 20 Hz tick, so **no interpolation layer is needed** — the glyph
  simply draws wherever the sim currently is. That removes an entire class of "render state drifted
  from sim state" bug.
- The 1 Hz layer is a *sampling* of sim state into a `RadarReturn` snapshot per aircraft. Data
  blocks therefore hold still for a full second while the aircraft glides, which is the look you
  asked for and also stops the altitude digits from flickering.
- Physics is written dt-agnostic, so 20 Hz is a constant, not an assumption baked into the maths.
- **Time acceleration:** 1× / 2× / 4× by stepping physics more times per frame; the 1 Hz radar
  sample scales with *sim* time, so at 4× the data blocks refresh 4× per real second.
- **Pause** stops the accumulator; input remains live.

Cost sanity check: 25 aircraft × 20 physics steps/s = 500 updates/s, and a redraw is ~25 glyphs,
~150 trail dots, ~75 text lines and a blitted static layer, 20 times a second. Sub-millisecond
frames on old hardware. **There is no performance problem to design around here**, which is why §11
optimises for maintainability instead.

---

## 6. ILS approach logic

### 6.1 The clearance gate (`C` key)

The clearance is **accepted only if every condition holds**, and when rejected the log states
*which* condition failed. This is the single most valuable teaching surface in the app — it turns a
vague "it didn't work" into "you were 800 ft above the glideslope".

| # | Condition | Value | Source |
| --- | --- | --- | --- |
| 1 | Not already cleared, and inside the 50 NM circle | — | — |
| 2 | Intercept angle to the 180° final approach course | **≤ 45°** | your spec (IF 6.11.3 prefers ~30°) |
| 3 | At or below the G/S at the projected intercept point | `alt ≤ 318.4 × d_NM` | IF 6.11.4 |
| 4 | At or above MVA | ≥ 2000 ft | — |
| 5 | Within LOC coverage and closing on it | ≤ 25 NM from threshold, cross-track ≤ 10 NM, closing | LOC service volume |
| 6 | Level (not still descending through the intercept altitude) | `|vs| < 200 fpm` | IF 6.11.8 |

Soft warnings that do **not** block the clearance but are logged and scored: intercept angle
>30°, speed >210 kt inside 15 NM, intercept inside 6 NM (rushed).

### 6.2 Capture and landing

1. **LOC capture** — once cleared, when cross-track error < 0.5 NM the aircraft turns to track the
   final approach course, holding assigned altitude. Phase → `loc`.
   *Established* (the handoff criterion, IF 6.14.2) = `phase ≥ loc` AND `|cross-track| < 0.3 NM`
   AND `|heading − 180| < 5°` AND tracking inbound.
2. **G/S capture** — when the 3° path is reached from below, phase → `gs`; the aircraft descends at
   `fpm ≈ 5.31 × GS`, i.e. ~740 fpm at 140 kt.
3. **Deceleration on final** — per IF 6.15.10, once cleared, speed reverts to the aircraft's
   discretion: it decelerates to reach Vapp by ~4 NM. A speed the player assigns *after* clearance
   is honoured until 4 NM (the "maintain 170 kt to 5 mile final" technique of IF 6.14.4).
4. **Touchdown** — at the threshold: log the landing, add to stats, **despawn**.
5. **Go-around** (automatic) — if inside 5 NM any of: not established on LOC, >1000 ft above G/S,
   >20 kt above Vapp+30, or in-trail spacing < 2.5 NM. The aircraft climbs to 3000 ft on runway
   heading and returns to `inbound` as the player's problem, and the event is scored.

---

## 7. Controls and interaction

### 7.1 Selection

- Left-click an aircraft blip or its data block to select. Click empty space to deselect.
- `Tab` cycles selection by distance to the threshold (nearest first) — keyboard-only play.
- The selected aircraft is highlighted and its data block expands; the sidebar shows its
  Altitude / Speed / Heading exactly like the reference screenshot.

### 7.2 Keys

| Key | Action |
| --- | --- |
| `A` / `D` | Assigned heading −10° / +10° (wraps 010–360) |
| `W` / `S` | Assigned altitude +1000 / −1000 ft (clamped 2000–10,000) |
| `Q` / `E` | Assigned speed −10 / +10 kt (clamped per §3.3) |
| `C` | Clear for ILS approach (subject to §6.1) |
| `Tab` | Cycle selection |
| `Space` | Pause / resume |
| `1` `2` `4` | Time acceleration |
| `Esc` | Deselect |

**Commit semantics: each keypress applies immediately** to the target value — no OK/confirm step.
Targets are advisory to the aircraft, which is already rate-limited, so a burst of `S` presses is
harmless and reads naturally as "descend 6000 … no, 4000". Every change emits a readback line.

### 7.3 Radar display

Mirroring the reference screenshots:

- **Blip:** small aircraft glyph, plus a **leader line** showing the 1-minute projected position.
- **Data block**, three lines, offset from the blip:
  ```
  KLM133          ← callsign
  80 ↓60          ← current altitude / target, in hundreds of feet
  250M            ← IAS + wake category
  ```
  with the **assigned heading** shown alongside in a contrasting colour when it differs from the
  current heading (the yellow `040` in the screenshot).
- **Assigned-heading vector:** for 5 s after a turn instruction, a dashed pale-yellow line is drawn
  from the blip along the *target* heading, half again the length of the green leader line, capped
  with a tick and labelled with the heading. The green leader shows where the aircraft is pointing
  now, the yellow one where it is going; the gap between them *is* the outstanding turn. It fades
  out over its last second, and a further press restarts the window rather than extending it.
- **Altitude convention:** hundreds of feet, two digits (`80` = 8000 ft). `=70` = level at 7000,
  `↓60` = descending to 6000, `↑` for climbing.
- **Colour coding:** unselected traffic green; selected white/bright; conflict amber; violation red;
  handed-off-to-tower dimmed grey.
- **Static map layer** (range rings, centerline + 2 NM ticks, gate markers, runway) is drawn once
  to an offscreen canvas and blitted each frame.
- **Message log**, bottom of the scope: pilot readbacks and system messages, ~4 lines visible,
  styled like the screenshot's green text.
- **Label de-clutter:** data blocks are placed at the first of 8 candidate offsets that does not
  overlap an existing block. Cheap, and it matters a lot at 25 aircraft.

---

## 8. Objective and scoring

The session is endless; the score is a running quality report, not a life counter.

| Metric | Definition |
| --- | --- |
| Landings | Aircraft that touched down |
| Arrival rate achieved | Landings per hour of sim time |
| Separation violations | Count, plus total seconds in violation |
| Go-arounds | Automatic go-arounds triggered |
| Airspace exits | Aircraft that left the 50 NM circle laterally (handed back to Center — penalty) |
| Track-mile efficiency | Actual track miles flown ÷ straight-line distance from gate to threshold, averaged |
| Clearance rejections | Failed `C` attempts, by reason — the learning signal |

---

## 9. Separation and conflict detection

- **Violation:** horizontal < **3.0 NM** *and* vertical < **1000 ft** simultaneously (IF 6.2.2).
- **Alert tiers** (IF 6.2.4): **amber** at <3 NM and <1000 ft; **red + audible** at <1.5 NM and
  <500 ft.
- **Predicted conflict:** straight-line extrapolation of both aircraft 90 s ahead; if it breaches
  the minima, both blips get an amber halo. This is what makes the game teachable rather than
  punitive — you see it coming.
- **Exemption:** aircraft both `established` on the same LOC are not laterally separated in the
  usual sense (they are in-trail), so the pair is exempt from the 3 NM/1000 ft test and instead
  subject to the **in-trail rule: ≥ 3.0 NM** to the aircraft ahead until touchdown. Below 2.5 NM
  the trailing aircraft goes around (§6.2).
- Checks run on every physics step over all pairs. At 25 aircraft that is 300 pairs × 2 Hz —
  no spatial index needed.

## 10. Handoff to Tower

Automatic, when **all** hold (IF 6.14.1 / 6.14.2 / 6.14.3):

1. `established` on the LOC (per §6.2 step 1 — aligned with the centerline, not merely "in the cone").
2. G/S captured (`phase = gs`) or at/below the G/S and descending.
3. **Acceptable closure rate:** projected in-trail spacing at the threshold ≥ 3 NM given both
   aircraft's current ground speeds. If the follower is catching the leader, the aircraft is *kept*
   on frequency (explicitly per 6.14.3, "this may mean leaving the frequency change until very
   late") and the player still owns the speed problem.

On handoff: log `KLM133, contact Tower on 119.1`, dim the data block, and stop accepting player
commands for that aircraft. It continues to touchdown, then despawns.

---

## 11. Technology evaluation

### 11.1 What the workload actually is

- ~25 moving entities, 2 Hz physics, 1 Hz display refresh.
- Draw calls per refresh: ~25 glyphs, ~25 leader lines, ~150 trail dots, ~75 text lines, one
  blitted static layer.
- Zero networking, zero persistence beyond `localStorage`, zero assets (no sprites, no audio
  beyond one or two alert beeps).

This is a **text-and-lines instrument display**, not a game with a rendering problem. Any framework
choice will hit 60 fps. So the decision criteria are, in order: **simplicity of the code you have
to maintain**, **testability of the flight model**, and **absence of dependency churn**.

### 11.2 Options considered

| Option | Assessment |
| --- | --- |
| **Vanilla TypeScript + Canvas 2D + Vite** ✅ | Zero runtime dependencies. Full control over data-block placement and de-clutter (the fiddliest part of the UI). The flight model is plain functions, unit-testable with no DOM. Nothing to relearn in six months. **Chosen.** |
| React (+ Canvas for the scope) | Reasonable, and the sidebar is genuinely declarative. But the sidebar is *six fields and a log* — plain DOM is less code than the wiring React needs, and the scope has to be canvas anyway, so React would own only the easy 10 %. Deliberately left as a later, low-cost swap: the renderer is behind an interface. |
| SVG / D3 | Real contender. Free hit-testing, CSS styling, lovely for the static map. Loses on the label de-clutter and text metrics work, and puts ~2500 DOM nodes under per-second mutation. Verdict: use the *idea* (declarative static map) via a prerendered canvas layer, skip the DOM cost. |
| Pixi.js | A WebGL scene graph for 200 primitives. Text is the dominant content and WebGL text means bitmap fonts or texture atlases — strictly worse for this UI. Rejected. |
| Phaser | A 2D *game* engine: physics bodies, tilemaps, sprite animation, asset loader. None of it applies; all of it must be understood to debug. Rejected. |
| three.js | 3D. No. |
| Godot / Unity web export | Multi-MB download, separate toolchain, poor text/DOM integration. Rejected. |
| Svelte | If you *do* want reactivity later, this is the lightest fit (compiles away, no runtime). Noted as the fallback if the sidebar grows into a real panel. |

### 11.3 Stack decision

| Concern | Choice |
| --- | --- |
| Language | **TypeScript**, `strict: true`. Unit-suffixed type aliases (`Nm`, `Ft`, `Kts`, `Deg`, `Fpm`) plus a single conversion module. True branding (`number & {__k}`) was considered and rejected: it makes ordinary arithmetic require a cast at every step. The discipline lives in the naming — every variable carries its unit (`altFt`, `distNm`, `iasKts`). |
| Build | **Vite 8** on **Node 24 LTS** (pinned by `.nvmrc`) |
| Rendering | **Canvas 2D**, two layers: static map (offscreen, redrawn only on resize/zoom) + dynamic traffic |
| UI chrome | Plain HTML + CSS sidebar, driven by a small `render(state)` function |
| State | One `World` object; `step(world, dt)` mutates in place. No Redux/Zustand/signals. |
| Tests | **Vitest** on the pure sim — turn rate, energy coupling, G/S geometry, clearance gate, separation. Headless, fast, no DOM. |
| Lint/format | ESLint + Prettier |
| Deploy | Static build → GitHub Pages. No backend, ever. |

**Toolchain:** Node 18.20.8 (the machine default) is past end of life, so the project pins
**Node 24 LTS** via `.nvmrc`. Run `nvm use` in the project directory before `npm` commands.

### 11.4 Project structure

The one structural rule that keeps this maintainable: **`src/sim/` never imports from `render/`,
`input/`, or the DOM.** The simulation is a pure function of state and time, which is what makes it
testable and what will let the same engine drive a replay viewer or a second frontend later.

```
src/
  sim/                 # pure, headless, no DOM
    units.ts           # unit aliases, geometry, TAS
    constants.ts       # every tunable number, in one place
    rng.ts             # seeded mulberry32
    aircraft.ts        # Aircraft type, radar snapshot
    dynamics.ts        # turn / vertical / speed integration, energy coupling
    ils.ts             # clearance gate, LOC/GS capture, landing, go-around
    separation.ts      # pair checks, prediction, alert tiers, in-trail
    traffic.ts         # Poisson spawner, callsigns, gate assignment
    commands.ts        # player instructions + readbacks + speed floor
    world.ts           # World type, step(world, dt), stats, handoff, radar sampling
  scenario/
    airport.ts         # runway, gates, elevation  ← swap this for a new airport
    aircraftTypes.ts
    airlines.ts
  render/
    project.ts         # NM ↔ pixels
    mapLayer.ts        # static layer: rings, compass, centerline ticks, gates, runway
    trafficLayer.ts    # blips, leader lines, trails, data blocks, de-clutter
    scope.ts           # canvas sizing, DPR, layer order, hit testing
    sidebar.ts         # selected-aircraft readout, live clearance preview, stats
    messageLog.ts      # readback log + status line
    theme.ts           # all colours
  input/
    keyboard.ts
    pointer.ts
  app/
    main.ts            # loop, wiring, time accel, pause
  style.css
tests/                 # 52 tests, sim only — no DOM needed
docs/
  REQUIREMENTS.md      # this file
```

---

## 12. Milestones

Each milestone ends with something visible, so progress is never theoretical.

| # | Deliverable | Status |
| --- | --- | --- |
| **M0** | Scaffold + static scope: Vite + TS build, 50 NM rings, compass, runway, centerline with 2 NM ticks, four gates | ✅ done |
| **M1** | Flight model: 20 Hz fixed-timestep loop, 1 Hz radar sample, turn/energy dynamics, unit tests | ✅ done |
| **M2** | Control: click/Tab selection, `A/D/W/S/Q/E`, sidebar, data blocks, readback log | ✅ done |
| **M3** | Traffic: Poisson spawner at the gates, callsigns, flow-rate setting, spawn veto, airspace-exit despawn | ✅ done |
| **M4** | ILS: `C` clearance gate with per-condition refusals, LOC + G/S capture, deceleration schedule, touchdown | ✅ done |
| **M5** | Rules: separation violations, predicted-conflict halos, alert tiers, in-trail rule, auto go-around, auto handoff | ✅ done |
| **M6** | Polish: session stats, pause + time accel, flow control, restart, live clearance preview, label de-clutter | ✅ done — **except the conflict alert sound**, which is not implemented (see §15) |

---

## 13. Assumptions register

Recorded because these were decisions, not givens. Each is cheap to change; none is load-bearing
for the architecture.

| # | Assumption |
| --- | --- |
| A1 | Airport elevation 0 ft; AAL = MSL |
| A2 | No wind; heading = track; GS = TAS |
| A3 | No magnetic variation |
| A4 | Single landing direction, never changes |
| A5 | Flat MVA of 2000 ft; no terrain model |
| A6 | Aircraft always comply; no "unable", no pilot deviations, no emergencies, no fuel state |
| A7 | Center's handover is always conflict-free, at the gate's altitude (7000 or 8000 ft) / 250 kt / direct ARP |
| A8 | Aircraft turn the short way to an assigned heading; long-way-round vectors aren't expressible |
| A9 | 4 gates, 90° apart, offset 40° from the cardinals |
| A10 | Endless session, no win/lose state; quality is reported, not enforced |

---

## 14. Decisions taken

| Question | Decision (2026-08-14) |
| --- | --- |
| Radar refresh feel | **Smooth motion at 20 Hz, data blocks at 1 Hz.** Physics runs at the render rate so no interpolation layer exists (§5) |
| Bad-approach handling | **Both gates**: `C` refuses an out-of-limits clearance with the specific reason, *and* an unstable approach inside 5 NM auto-goes-around (§6) |
| Altitude ceiling | **10,000 ft**, giving climbs as a de-confliction tool; top two levels are stacking-only, outside LOC coverage (§3.3) |
| Airspace exit | **Scored penalty, aircraft despawns**, with an amber warning at 45 NM. No soft wall (§3.4) |

## 15. Still open

None of these blocks play; each is a small, contained change.

1. **Runway identity** — built as `18` with a 180° final approach course. Match the screenshot's
   `18C` instead? (In reality that implies parallels we are not modelling.)
2. **Speed floor policy** — currently a hard block below 180 kt (190 for heavies) outside 20 track
   miles, refused with an explanation. Softer alternative: allow it and score it.
3. **Wake categories** — displayed on the data block, but not used for spacing. Should heavies
   require 4–5 NM in trail?
4. **Sound** — no audio at all yet. IF 6.2.4 describes an audible alarm inside 1.5 NM / 500 ft;
   one Web Audio beep would cover it.
5. **Aircraft glyph** — a simple cross-and-nose symbol. Worth drawing a proper airliner shape?

---

## 16. Running it

```bash
nvm use          # Node 24 LTS, pinned in .nvmrc — the system default is 18 (EOL)
npm install
npm run dev      # http://localhost:5173
npm test         # 52 sim tests, headless, ~0.5 s
npm run build    # typecheck + static bundle into dist/
```

`?seed=1234` in the URL makes a session reproducible. In a dev build, `window.atc` exposes the live
world for console poking.
