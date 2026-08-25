# Approach Radar Simulator — Requirements & Design Plan

**Status:** v1 built and playable · **Date:** 2026-08-14 · **Owner:** Anant

A browser-based, single-airport **approach radar** simulator. The player is the Approach
controller: accept arrivals handed over from Center at fixed entry gates, sequence and vector
them onto a single ILS, maintain separation, and hand off to Tower once established.

Inspiration: *Endless ATC* (mobile) for the scope look and control feel.

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
- Endless play at configurable arrival and departure flow rates, with a session stats panel.

### 1.2 Explicitly out of scope (v1) — parked for later

| Deferred | Why parked |
| --- | --- |
| ~~Departures / mixed traffic~~ | **Now in scope** — three SIDs off runway 18, flown by Departure Control rather than by the player (§4.7) |
| ~~Holding patterns~~ | **Now in scope** — added as a simplified direct-entry racetrack on the STAR (§4.6) |
| Wind (and therefore IAS vs GS divergence from wind) | Big complexity driver in intercept geometry; altitude-based TAS is modelled, wind is not |
| Terrain / MVA map | Single flat MVA constant instead |
| Parallel runways & reduced parallel separation | Only meaningful with ≥2 runways |
| Multiple airports, sector handoffs between radar positions | v2+ |
| Wake-turbulence spacing categories as a *rule* | Category is displayed, but the range-dependent in-trail minimum of §9.3 is the only spacing rule in v1 |
| Voice / phraseology audio, pilot "unable" negotiation | Text readback log only |
| Touch / mobile controls | Desktop keyboard + mouse only |
| Multiplayer, accounts, backend | Static site, no server |

---

## 2. The rules, and where the numbers come from

Everything quantitative below is either standard radar-control practice or a standard
flight-dynamics relationship. Each value is stated with the reasoning that fixes it, so it can be
argued with rather than merely obeyed.

### 2.1 Separation

- Aircraft must be no closer than **3 NM laterally or 1000 ft vertically** at any time.
- Alerting has two tiers: a red target inside **3 NM and 1000 ft**, and a red target with an
  audible alarm inside **1.5 NM and 500 ft**.

Derived rules → §9.

### 2.2 ILS approach

- The intercept heading should be **as close to 30° as possible** off the final approach course.
  Angles of **10° or less should be avoided** — too shallow to close on the localizer.
- To intercept the glideslope the aircraft must be **below** it. A typical glideslope is a **3°
  path** to the threshold: roughly **300 ft above the field at 1 NM, 600 ft at 2 NM**, and so on.
- A clearance may be issued without an intercept heading when the intercept angle is already
  reasonable (~30°), or when the aircraft joins the extended final **at 20 NM or beyond**. An
  altitude must still be assigned as the lowest authorised altitude until established.
- The ILS cone is about **11 NM** long, so the glideslope altitude there is about **3500 ft** above
  the field. The intercept altitude should sit below the glideslope at the intercept point — by
  convention **500 ft lower**.

### 2.3 Handover to Tower

- Before handover the aircraft must be **established on the intended approach path** *and* have an
  **acceptable closure rate on the aircraft ahead**.
- For an ILS, "established" means the localizer is intercepted — the aircraft is **aligned with the
  centerline**, regardless of whether it is inside or outside the cone. Being in the cone is not
  the same thing and is not sufficient.
- An unacceptable closure rate looks like this: the lead at 180 kt ground speed on final, the
  follower intercepting at 250 kt with only 3 NM of spacing. That pair is a go-around waiting to
  happen, and the follower should be kept on frequency until the separation is assured.

### 2.4 Speed control

- Indicated airspeed drifts from ground speed with altitude. At 250 kt IAS in still air: 3000 ft ≈
  260 (+10), 6000 ft ≈ 270 (+20), 9000 ft ≈ 290 (+40), 12,000 ft ≈ 300 (+50). That is about **2 %
  per 1000 ft**, the standard true-airspeed rule of thumb.
- Standardise on **two or three common speeds** — 250, 210 and 180 kt — rather than assigning
  arbitrary ones. Repetition is what makes a sequence predictable.
- Reduce the **trailing** aircraft first, or speed the lead up first, and allow **sufficient time
  and distance** for any speed change — especially high and clean, where deceleration is slowest.
- **Avoid slowing an aircraft below its clean speed until it is within 20 track miles** of
  touchdown. Expeditious approaches are only possible if aircraft keep their speed up until close
  in.
- Once cleared for the approach, **speed is at the aircraft's discretion** unless a further speed
  instruction is issued.

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
- **Radar area:** a 50 NM circle centred on the ARP with its **northern and southern caps cut off**
  by chords at **|y| = 42 NM**. Range rings at 10, 20, 30, 40 NM; the boundary itself is the two
  surviving arcs plus the two chords, and the compass rose rides that outline rather than a circle.
  The caps were dead airspace — no gate, no route, nothing but rose — and removing them lets the
  same 50 NM of usable width draw about **20 % larger**, because the canvas height carries 84 NM
  instead of 100. The scale is set so the chords fill the height exactly; on a narrow window the
  circle's east–west extent takes over instead. The four gates sit at |y| = 38.3 NM, comfortably
  inside the cuts, and the shape is defined once in `sim/airspace.ts` so the exit check and the
  drawing cannot disagree.
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

| Gate | Bearing from ARP | Inbound heading at entry | Handover altitude | STAR |
| --- | --- | --- | --- | --- |
| KOVAL | 040° | 220° | **11,000 ft** | KOVAL1A |
| TEMBA | 130° | 310° | 13,000 ft | TEMBA1A |
| RIMOL | 230° | 050° | 13,000 ft | RIMOL1A |
| VANDA | 320° | 140° | **11,000 ft** | VANDA1A |

**Center's handover contract:** every aircraft appears exactly at its gate at its gate altitude,
**250 kt IAS**, **established on the first leg of its STAR** (§4.5), level and steady.

KOVAL and VANDA lie north of the field — the same side as the final approach course for runway 18 —
so their arrivals reach the localizer with far fewer track miles in which to lose the height. Center
hands those two over 2000 ft lower, and their STARs are correspondingly shorter. The gate marker on
the scope carries its altitude in hundreds (`KOVAL 100`).

### 3.3 Player authority limits

| Parameter | Range | Step |
| --- | --- | --- |
| Heading | 010–360 | 10° |
| Altitude | 2000–13,000 ft | 1000 ft |
| Speed (IAS) | 180–250 kt outside 20 track miles; **160**–250 kt within | 10 kt |

Aircraft enter at 11,000–13,000 ft against an assignable ceiling of **13,000 ft**, so a climb is
available as a de-confliction tool everywhere except at the south gates, which arrive on the ceiling
itself. Twelve usable levels between MVA and ceiling. Departures go *above* it, to 14,000 ft (§4.7):
the ceiling is the top of what the controller may assign, not the top of the sky.

The 180 kt floor outside 20 track miles enforces the configuration gate (§2.4) rather than merely
suggesting it. An
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
| 11,000 ft | 34.5 NM — stacking altitude only |
| 12,000 ft | 37.7 NM — stacking altitude only |

Everything above 8000 ft sits outside the 25 NM LOC capture window (§6.1 condition 5), so those
levels are for holding traffic down-level and de-conflicting, not for intercepts. The STARs deliver
arrivals to **3000 ft** on every route. The north platform is the one that has to be an intercept
platform: those routes end 15.3 NM from the threshold measured along the final approach course,
where the glideslope is 4882 ft, so the level flown there must be below it — 3000 ft meets the slope
at 9.4 NM, comfortably inside the merge. The south routes end on a downwind that is turned base
rather than final, so their 3000 ft is where the descent has already been made rather than an
intercept level; whatever range the base turn is flown at beyond 9.4 NM, the aircraft is under the
slope and captures from below.

---

### 3.4 Leaving the airspace

There are no holding patterns in v1, so the boundary is the real constraint on how long you can
defer a sequencing decision. Crossing it outbound is a **scored failure, not a soft wall**:

- When an aircraft crosses the boundary of §3.1 while tracking outbound, it is handed back to
  Center, **despawns**, and the session logs an **airspace exit** (§8). Note this is 50 NM to the
  east and west but only **42 NM north and south**, where the caps are cut off — there is less
  room to run than the range rings suggest.
- Log line: `KLM133 leaving your airspace, returned to Center.`
- A warning fires **5 NM before the boundary** outbound (`amber` data block) so the exit is never
  a surprise. Measured against the shape, not the radius, so it fires on the chords too.
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

  // Controller targets — what it is flying now, not what was just transmitted
  targetHeadingDeg: Deg;
  targetAltitudeFt: Ft;
  targetIasKts: Kts;
  pending: PendingInstruction[];  // transmitted, not yet read back (§7.2)
  turnDirection: -1 | 1 | null;   // forces the turn direction; holds only (§4.6)

  star: StarNav | null;           // route being flown, null once vectored (§4.5)
                                  // carries the holding pattern, if any (§4.6)
  sid: SidNav | null;             // the SID, on a departure; null on every
                                  // arrival. Non-null *is* what makes an
                                  // aircraft a departure (§4.7)

  // Approach state
  phase: Phase;
  handedOff: boolean;
  speedAssignedAfterClearance: boolean;   // §2.3

  // Bookkeeping and display
  entryGate: string;
  trackMilesFlown: Nm;
  directDistanceNm: Nm;
  trail: Point[];                // history dots, one per 10 s
  radar: RadarReturn;            // the 1 Hz snapshot the data block shows
  alert: 'none' | 'warning' | 'violation';
}
```

`handedOff` is deliberately *not* a phase: an aircraft handed to Tower keeps
flying its approach, it just stops accepting instructions. `sid` is the same idea
from the other end — a departure was never on the frequency to be taken off it.
`Phase` carries the two departure states (`roll`, `climb`) alongside the five
approach ones, so everything that switches on a phase has one field to read
(§4.7).

### 4.2 Types and performance

| Type | Wake | Vapp | Min clean | Descent | Climb | Accel/Decel budget |
| --- | --- | --- | --- | --- | --- | --- |
| A320 / B738 / E190 | M | 140 kt | 190 kt | 1600 fpm | 1700 fpm | baseline |
| A332 / B77W / B788 | H | 145 kt | 200 kt | 1400 fpm | 1500 fpm | 0.85 × baseline |

Kept deliberately thin: two performance classes, several type codes mapping onto them. Enough to
make heavies feel heavier without a performance database.

Descent rates were pulled back from 1800/1600 fpm: aircraft were arriving at their levels faster
than the controller could plan around, which made altitude the easy axis and hollowed out the
sequencing problem. A slower descent also weakens the energy coupling of §4.3 — 1600 fpm leaves
900 fpm of the budget for deceleration rather than 700 — so descending-and-slowing now costs about
1.6× the time of slowing level, not 2.2×. Min clean rose with it, to 190/200 kt, keeping the speed
axis honest now that the vertical one is gentler.

### 4.3 Dynamics — the "targets take time" mechanic

Every parameter moves toward its target at a bounded rate. Nothing snaps.

**Heading.** Turn the short way at `ω = min(3.0, 509 / TAS)` °/s. No turn anticipation, no
roll-in/roll-out lag in v1 (roll dynamics are invisible at 1 Hz radar resolution).

**TAS.** `TAS = IAS × (1 + 0.02 × altitude_ft / 1000)`. Ground speed = TAS (no wind). This
reproduces the table in §2.4: 250 IAS at 9000 ft → 295 kt.

**Vertical + speed coupling (the core mechanic you asked about).** Modelled with *total energy*
rather than an arbitrary penalty, because the real constraint is that a jet at idle can dissipate
energy only so fast, and it does not care whether that energy leaves as altitude or as speed.

Specific energy height: `H_e = h + V² / 2g`. Converting a speed change into its altitude
equivalent: `Δh_equiv = (V / g) · ΔV`.

```
Worked example — descend AND slow simultaneously:
  Aircraft at 250 kt (422 ft/s), asked to descend 1600 fpm and reduce 250 → 230 kt.
  Energy-equivalent of 20 kt at 250 kt:  Δh = (422 / 32.2) × 33.8 ft/s = 443 ft.
  Idle + partial speedbrake budget:      2500 fpm of energy loss.
  Descent consumes 1600 fpm → 900 fpm left for deceleration.
  443 ft / 900 fpm ≈ 30 s  →  effective deceleration ≈ 0.67 kt/s.
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
- **Determinism:** all randomness from a single seeded PRNG (mulberry32), plus a second stream for
  pilot reaction times (§7.2) so how much the player talks cannot shift the traffic sequence. A seed
  reproduces a session exactly — essential for debugging and for replayable "scenarios" later.

### 4.5 STARs — standard arrival routes

Arrivals do not fly at the ARP and wait to be noticed: each gate has a published arrival that its
traffic flies on autopilot until the controller intervenes. Defined in
[`src/scenario/stars.ts`](../src/scenario/stars.ts) as a chain of waypoints, some carrying a
published crossing altitude or speed.

| STAR | Fixes | Profile |
| --- | --- | --- |
| VANDA1A | VANDA → OKPUR → ALVOR → ARDIS | 10,000/250 kt → 9000/250 kt → 7000/230 kt → 3000/200 kt, to a platform 2 NM west of the centerline at 16 NM |
| KOVAL1A | KOVAL → NIVEL → BELGA → BOXAR | mirror image, 2 NM east |
| RIMOL1A | RIMOL → SUDIX → LOMSA → PIKON | 13,000/250 kt → 10,000/250 kt → 7000/230 kt → 3000/210 kt, north up a downwind 6 NM west of the centerline, ending 11 NM north |
| TEMBA1A | TEMBA → TAVIR → DEMUX → KETAN | mirror image, 6 NM east |

Geometry, all four:

- The **north** routes run straight in from the gate to a corner 20 NM abeam, then turn onto a leg
  descending 7000 → 3000 that stops 2 NM short of the extended centerline at 16 NM final. The
  glideslope is at 5350 ft there, so the platform sits under it and the intercept captures from
  below. Turn one onto final and the other has to wait: they end pointing at each other, 4 NM apart,
  which is the sequencing problem the player is there to solve.
- The **south** routes run straight in until they cross 6 NM abeam the centerline, then turn north
  onto a downwind descending 7000 → 3000 that ends 11 NM north of the field. Turn base when the gap
  in the sequence is there — by then the height is already off, so the base turn is a turn rather
  than a descent as well.
- **No two routes cross**, and no route passes within 3 NM of another's fixes. Doing nothing is
  never an instant separation loss; it is only ever a deferred problem.

**Vertical.** The published altitudes are flown as a continuous descent, linearly interpolated
against distance-to-go between one constraint and the next, so every crossing altitude is made good
exactly rather than dived at and levelled off. The resulting rate is 350–700 fpm — an ordinary
descent — and its energy is still charged against the speed budget of §4.3, so an aircraft on the
profile decelerates more slowly than a level one.

**Speed.** **250 kt is published as far as the first fix** (OKPUR, NIVEL, SUDIX, TAVIR), comes off
to **230 kt at the corner** (ALVOR, BELGA, LOMSA, DEMUX), and reaches the platform speed — **200 kt
north, 210 kt south** — at the last fix. The north platform is lower and closer in, so it is also
the slower of the two; both stay above the 180 kt clean floor of §3.3, so neither can be refused as
published. The speed comes off over the middle legs, not from the moment of handover — §2.4's
"keep the speed up until close in" expressed as a published constraint, and it keeps the outer leg
of every route at a single predictable speed. An aircraft vectored off before its first fix
therefore keeps 250 kt.

The two southern first fixes cross **1000 ft higher** than the northern pair (10,000 vs 9000): those
routes start 2000 ft higher and are the longer pair, so the descent stays even instead of
front-loading into the first leg and then running level.

**Where these numbers live.** Every crossing is maintained **per route and per fix**, declared with
the geometry in `scenario/stars.ts` rather than as shared constants in `sim/constants.ts`. Two
successive retunes showed why: a shared "platform altitude" constant meant that moving one fix
silently moved three others, and each new distinction (north vs south, corner vs platform) needed
another constant before the change could even be expressed. Repetition across the four charts is
the point — a published crossing is a fact about one fix on one route, and it should be editable as
one. The arrival profile is expected to be retuned, so §14 records this as a decision, not an
accident of refactoring.

**Who owns which axis.** The route is an autopilot, and the controller takes axes back from it:

| Instruction | Effect on the STAR |
| --- | --- |
| Heading (`A`/`D`) | **Off the route entirely.** Whatever was not taken over stays as published — the descent to the next published level and the reduction to the published speed both stand, which is what "descend 5000, turn left heading 090" means |
| Altitude (`W`/`S`) | Published profile off, **lateral track kept** |
| Speed (`Q`/`E`) | Published speed off, **lateral track and descent kept** (speed control is not a vector) |
| `H` (hold) | **Stays on the route**, suspended at the holding fix (§4.6) |
| `C` (cleared ILS) | Off the route; the approach owns it from there |

Nothing rejoins a STAR. Once vectored, an aircraft is on vectors for the rest of its arrival.

**Running out of route.** Reaching the last fix ends the arrival: the aircraft calls
("*at ARDIS, end of the arrival — maintaining heading, request further*"), holds its heading, level
and speed, and flies on. Left alone it crosses the centerline and eventually exits the airspace
(§3.4). The routes buy the controller 3–5 minutes of level flight, not indefinite parking.

**Delivery into a holding stack.** The four entry fixes — OKPUR, NIVEL, SUDIX, TAVIR — are where a
sequence backs up, and a hold there is flown level. A second aircraft arriving on the published
crossing would fly straight into the first, so Center delivers it **1000 ft above the highest
aircraft already holding at that fix**, rounded onto the 1000 ft assignable grid. Three aircraft
stacked at NIVEL on 8000, 9000 and 10,000 means the next KOVAL1A arrival is handed over at 11,000
and crosses NIVEL there. That is what a stack is: an ordered column, filled from the bottom.

Only the run in to the entry fix is raised. Past it the chart is unchanged, so the aircraft rejoins
the published descent on the next leg rather than carrying the extra height down the whole arrival,
and the interpolation between the two makes the join a descent rather than a step. The raised list
is a property of the *aircraft* (`StarNav.altitudes`), not of the chart.

When the stack reaches `CEILING_FT` there is no level left to deliver anyone on, and **Center stops
handing traffic over on that route** until it drains — the gate simply goes quiet. Delivering above
the ceiling would put an arrival higher than the player may assign; delivering at the top of the
stack would create the conflict the stacking exists to prevent.

### 4.6 Holding patterns

The routes buy minutes; a hold buys as long as the controller wants. When the arrival rate outruns
the runway, the tool for it is a published hold at a fix on the STAR — the aircraft parks itself in
a racetrack and stops consuming the airspace on final. Implemented in
[`src/sim/hold.ts`](../src/sim/hold.ts).

**Only aircraft on a STAR can hold.** The pattern is anchored on the fix the aircraft is already
tracking to, so off the route there is no fix to hold at and the instruction is refused. A hold
**suspends** the STAR rather than replacing it: `ac.star` stays set and sequencing stays parked on
the holding fix, which is what makes rejoining it a matter of dropping the hold state.

**The pattern.** Standard (right-hand) turns, flown as a direct entry from wherever the aircraft is:

```
inbound  ──────────────▶ FIX ─┐  180° right
                              │
◀────────── 1 min ────────────┘
```

Press `H`, and the aircraft continues to the next fix on its route, slowing to 230 kt on the way —
the lateral track does not change until it gets there. Over the fix it turns right through 180°,
flies **one minute** of straight and level, turns right through 180° again, and tracks back to the
fix. Then it does it again, indefinitely.

The real procedure has three published entries (direct, parallel, teardrop) chosen from the angle of
arrival, all of it there to get an aircraft onto the inbound leg from an arbitrary direction without
leaving protected airspace. Here the aircraft always arrives along its own STAR leg, so the entry is
always a direct one and the geometry reduces to the loop above. The outbound leg is flown as the
**reciprocal of the track the aircraft crossed the fix on**, so the pattern aligns itself with the
arrival instead of needing a published inbound course on every fix.

The one-minute leg is timed **from the roll-out, not from the fix**: the minute is a minute of
straight flight, and the turn is not part of it. The resulting racetrack is 7–10 NM long at 230 kt
across the four routes.

**The turn direction is stated, not derived.** Both reversals in the pattern are *exactly* 180°, and
"turn the short way" (§4.3) has no answer for a reversal: `headingDelta` returns ±180 and the sign
falls out of floating-point rounding, so an aircraft that drifts a hundredth of a degree past the
target rolls out the other way and flies the pattern left-handed. `Aircraft.turnDirection` therefore
forces the direction for the duration of each reversal and is released at the roll-out, so the
tracking legs still correct whichever way is shorter. It is cleared whenever the hold ends, however
it ends — including by a vector, which must be free to turn the short way.

**Numbers.** 230 kt is the ICAO/FAA standard holding speed below 14,000 ft, and it is also the
published STAR arrival speed — so an aircraft sent into the pattern has one deceleration to make and
nothing else changes. One minute is the standard leg below 14,000 ft.

**Altitude is frozen** at the holding fix's published crossing altitude on entry. It has to be: the
STAR's descent profile is interpolated against distance-to-go, and distance-to-go stops decreasing
once the aircraft is going round in circles. Unlike the profile and the glideslope, the hold writes
only a *target* and lets kinematics fly it (§4.3) — a hold is level flight, not an imposed rate.

**What the controller can do to a holding aircraft:**

| Instruction | Effect |
| --- | --- |
| Altitude (`W`/`S`) | **Stays in the pattern**, at the new altitude — stacking a hold is the point. The level belongs to the hold and is given back on exit (below) |
| Speed (`Q`/`E`) | **Stays in the pattern**, at the new speed |
| Heading (`A`/`D`) | **Out of the pattern and off the STAR**, exactly as a vector off any other part of the route |
| `H` again | Leaves the pattern (below) |
| `C` (cleared ILS) | **Refused** — a holding aircraft is circling a fix, not tracking towards final; take it out of the hold first |

**Leaving.** Pressing `H` a second time depends on whether the pattern has actually begun:

- **Before the fix is reached** — the hold has not started, so it cancels outright and the aircraft
  simply carries on down the STAR ("*cancelling the hold, continuing on the arrival*").
- **Once established** — the crew finishes the loop it is flying and leaves at the **next crossing
  of the fix** ("*leaving KETAN on the next inbound*"). It does not cut the pattern short.

On leaving, the STAR resumes from the holding fix on the same tick, published profile and all: the
aircraft picks the descent back up where the hold interrupted it. This is the **one exception to
"nothing rejoins a STAR"** in §4.5 — and it is not really an exception, since the aircraft never
left the route in the first place.

**A holding level is not a standing altitude assignment.** "Descend 7000 in the hold" belongs to the
pattern, so the `altitudeManual` flag it sets must not outlive it: on exit the vertical goes back to
whoever had it *before* the hold began. Without that, stacking an aircraft in the pattern silently
cancels the published profile, and it flies the rest of the arrival level at the holding level — the
descent never resumes. An altitude assigned *before* the hold is a genuine takeover and does stand.

**Rejoining is a descent, not a jump.** The profile is normally written straight onto the aircraft,
which assumes it is already on it — fine for an ordinary arrival, but an aircraft leaving a hold is
typically thousands of feet above, and writing the chart onto it would teleport it (and report a
vertical rate in the millions of fpm). So while it is above the profile it descends *towards* it on
ordinary kinematic rates, and `starOwnsVertical` reports false for those ticks so kinematics
integrate the vertical. **The capture test is simply "no longer above"**: descending onto the
profile is the only way to rejoin, so the crossing is the capture and no tolerance window is needed
— which matters, because any window wide enough to be safe is also wide enough to be a visible step,
and one narrow enough to be invisible breaks ordinary arrivals where the profile levels off at a
platform faster than the aeroplane can follow.

**Display.** The data block shows `HOLD` in place of the fix name — a holding aircraft is circling
that fix rather than tracking to it, and that is the thing the controller has to see at a glance.
**`H` toggles one thing: whether the aircraft is to stay in the pattern.** That is three cases
rather than two, because an aircraft told to leave is still in the pattern until it next crosses the
fix — so pressing `H` there means *never mind*, not *enter again*, and it takes the exit back rather
than rebuilding a pattern the aircraft never left. Not holding → enter; holding → leave at the next
crossing; leaving → keep holding. Only once it has actually left does `H` enter a fresh hold.

Once the exit has been instructed the same word is **struck through** (`H̶O̶L̶D̶`, U+0336 combining
long stroke overlay on each character, so the font and the block layout are unchanged). The aircraft
is still in the pattern and still going round, but it is leaving at the next crossing of the fix —
a change to what `HOLD` *means* rather than a different state, which is why it is the same word
rather than a new tag.
The racetrack itself is **not drawn**: the trail dots already show it, and four overlapping
racetracks on a congested scope cost more legibility than they buy.

### 4.7 SIDs — standard instrument departures

Arrivals are not the only traffic in the airspace. Runway 18 also departs, and those departures are
**not the player's aircraft**: they are worked by Departure Control from the moment they roll, they
fly a published SID, and they leave. Defined in [`src/scenario/sids.ts`](../src/scenario/sids.ts),
flown by [`src/sim/departure.ts`](../src/sim/departure.ts).

What they are *for* is separation. A departure is a moving obstacle on a known track at a known
altitude, and the arrivals have to be worked around it — which is the same thing a real approach
controller spends the shift doing. Everything below follows from that.

#### A SID is a set of restrictions, not a profile

This is the one structural difference from a STAR and it is deliberate. A STAR publishes a
continuous descent profile that the autopilot is *flown onto* (§4.5); a SID publishes crossing
restrictions, and between them the aircraft climbs at whatever its own performance gives. So a SID
fix carries an `at or below` or an `at or above`, never a level to sit on, and the target altitude
is simply **the lowest `at or below` still in force, or the airspace ceiling once they are all
behind**. Two consequences worth keeping:

- Nothing writes `ac.altitudeFt` directly. There is no chart to sit on, so kinematics own the
  vertical for the whole climb and the `controlVertical: false` seam of §4.5 and §6.2 does not
  apply here. The level-off at a restriction falls out of the ordinary capture taper.
- The restriction is released **by position, not by the route sequencer**. Sequencing moves to the
  next fix early so the turn is flown as a fly-by, and starting the climb half a mile before the
  crossing fix would start it while still underneath the arrival.

#### The three routes

| SID | Turn off 18 | Fixes | Restrictions |
| --- | --- | --- | --- |
| `SABAR1A` | Right (west) | NORVU → MORVA → SABAR | ≤4000 to MORVA; 14,000+ at SABAR |
| `KIROS1A` | Left (east) | NORVU → TELMU → KIROS | ≤4000 to TELMU; 14,000+ at KIROS |
| `RAMOX1A` | Straight (south) | NORVU → RAMOX | none — unrestricted climb |

All three climb runway heading to NORVU, 3.2 NM off the departure end, so the turn happens at a
realistic thousand feet or so rather than at the wheels-up point. NORVU sits on the turning leg
itself, 4 NM south of the field, which the two turning routes then follow due west and due east.

**The turning SIDs cross the south STARs' downwind legs at x = ±6.** Those legs descend 7000 → 3000
as they run north, and at the crossing latitude an arrival on the published profile is still at
about **6700 ft**. A departure held at or below **4000 ft** therefore passes some 2700 ft
underneath it.

**The restriction ends two miles past the crossing, at MORVA / TELMU — not at the crossing
itself.** This is the part that is easy to get wrong, and it was got wrong first time round.
Releasing the climb where the tracks cross leaves the departure within 3 NM of the arrival route for
the next three miles, and three miles of climb is 1500 ft or more: it climbs straight back into the
gap it was just held under. Measured on the first attempt, a medium came back to within **980 ft**
of the downwind profile at 2.4 NM, which is a separation violation by our own rule (§9.1).

Two miles is the *shortest* hold-down that works, and it is short on purpose: every extra mile is
another twenty seconds of a departure cruising level at 4000 ft in plain view of the player, which
reads as an aircraft that has forgotten to climb rather than one being held down. What carries the
margin is the vertical, not the lateral — the arrival above is on 7000 at the corner and higher
still on the leg in from the gate, so the departure climbs away from 4000 with 3000 ft over its head
and is outside 3 NM before it has used a third of it. Measured across the fleet, the worst case
inside 3 NM of any STAR is **2329 ft** of vertical (E190, at exactly 3.00 NM, 4952 against 7281).
The level segment lasts 51 s for the slowest climber and 104 s for the one that reaches 4000 soonest.

No crossing altitude fixes that, either. The downwind tops out at 7000 ft, so the gap available at
the crossing is at most 7000 − *R*, and by the time the departure is laterally clear it has climbed
some 2200 ft of it; keeping 1000 ft would need the arrival above to be at 7200 or better. The
geometry decides, not the number. So the fix carrying the `at or below` is placed past the conflict
— which is what a real SID does — and the crossing itself is left unlabelled on the chart, visible
where the amber line passes under the blue one. `tests/departure.test.ts` asserts the property
directly: flying every type down every SID, **no departure is ever within 3 NM of a STAR without
1000 ft of vertical between them**.

Beyond that fix they climb to **14,000 ft** — deliberately 1000 ft above the assignable ceiling of
§3.3, because the south gates now hand arrivals over at exactly 13,000 and a departure has to finish
above the highest arrival rather than level with it — and leave due west and due east, through the
middle of the gaps between the arrival gates. The straight SID runs down the extended departure
centreline, the one direction with no arrival traffic in it at all: the nearest STAR fix is 6 NM
abeam.

#### Climb performance

Departure figures are **per type**, not per performance class, because for once there is real
per-type data covering exactly the regime flown here: the whole airspace (0–12,000 ft) sits inside
the EUROCONTROL Aircraft Performance Database's *initial climb* and *climb to FL150* bands.

| Type | V2 | Initial-climb IAS | Initial-climb ROC |
| --- | --- | --- | --- |
| A320 | 145 | 175 | 2500 |
| B738 | 145 | 165 | 3000 |
| E190 | 138 | 190 | 3000 |
| A332 | 145 | 175 | 2000 |
| B77W | 168 | 200 | 3000 |
| B788 | 165 | 190 | 2700 |

**3000 fpm is the ceiling on the table.** The APD quotes what the type can do at a light weight;
a loaded airliner does not use all of it, and a target winding up the scope faster than that reads
as a fighter rather than as traffic. Only the E190 is affected — the database gives it 3400, and it
is entered here at 3000. The limit is in the numbers rather than in a clamp in `dynamics.ts`: the
table is the one place a climb rate is decided, so there is nothing for a second rule to add.

The profile is the real one: rotate at V2, hold the initial-climb IAS until the flaps are up at
3000 ft AGL, then accelerate to **250 kt** — the below-10,000 speed limit, and our airspace is
lower than that, so 250 is the climb speed the whole way.

**Below the acceleration altitude the published rate is reduced by 500 fpm.** The APD figure is the
*clean* rate; for the first 3000 ft the flaps are still out and the drag costs the aircraft real
climb performance. Without it the initial climb reads as too eager — a departure leaping away from
the runway rather than climbing away from it.

`departureClimbFpm` is the *pure-climb* rate, quoted at a fixed climb speed, so the acceleration
segment is paid for out of what is left of a larger `DEPARTURE_THRUST_BUDGET_FPM` (4200 fpm) —
which is the real trade a crew makes, and reuses the energy-budget coupling of §4.3 unchanged. The
number matters: below about 4000, the steepest climber in the fleet is left with only the
`MIN_SPEED_RATE_KTS_S` floor and spends six minutes crawling to 250 kt, which is not what a
departure does. The arrival `climbFpm` is untouched — it is the gentler rate of a level change, not
of a departure at climb thrust.

**Are the published numbers achievable?** Yes, with margin, and the tests assert it for every type:

- **4000 across the downwind.** Even the slowest climber in the fleet is level at 4000 about 9 NM
  after the brakes come off, with the crossing 10 NM out and the fix that ends the restriction
  another 2 NM beyond — so the aircraft levels off and cruises the restricted segment. The
  restriction is a ceiling being *held*, not a performance limit being hit.
- **14,000 by the exit fix.** Measured for every type, the slowest climber (A332) levels off
  37.7 NM into the route against an exit fix at 39.2 NM — 1.5 NM to spare, and 6.5 to 10 NM for
  everything else. The straight SID's slowest is level at 33.2 NM against a 35.2 NM leg.

#### The take-off roll

A departure appears **stationary on the threshold** and rolls — the one aircraft in the simulation
that is not flying. It has its own integration in `departure.ts` and `stepKinematics` is skipped
entirely for it: takeoff acceleration is an order of magnitude above `MAX_ACCEL_KTS_S`, and an
aircraft on the ground must not turn, climb or gain TAS with altitude. It rotates at V2, after about
35 s and 0.7 NM for a medium, 50 s and 1.1 NM for a heavy — both comfortably inside the 1.6 NM
runway.

#### One runway, shared, and the hold-short queue

**The flow and the runway are two separate things, and keeping them apart is the model.** The flow
decides how often a departure turns up at the holding point; the runway decides when one rolls.
Between them sits a **queue**, and its length is the player's arrival spacing read from the other
side.

A departure joins the queue on the flow interval whatever the runway is doing, and never gives up
its place. The one at the head takes the runway on *any* tick it is free — not on the next scheduled
release — so a departure held for landing traffic goes the moment that traffic is out of the way. A
queue built while the flow was on still drains after it is turned back off: those aircraft are
already at the threshold.

The queue is a **count**, not a list of aircraft. Nothing observes a departure before it rolls — it
is not on the scope, not on a frequency, and has no callsign anyone can read — so the type, callsign
and SID are drawn at the release instead, and the state is exactly as large as it needs to be. It is
also the one *live* number in the stats gutter that no rebuilt replay frame could recompute, so it
is recorded in the session snapshot alongside the flow settings (§17).

The head of the queue is held while:

- an arrival is inside **3 NM on final**, or
- a landing aircraft is still rolling out — **60 s** after touchdown, or
- the previous departure rolled less than **90 s** ago, or
- anything is still on the runway.

**The arrival test is a time, not a distance.** The real rule is not a distance either: the
departure has to be *airborne, with room to spare, before the landing aircraft crosses the
threshold*. So the gate is

```
time to threshold  =  alongNm ÷ ground speed          ← the arrival's actual speed
required           =  longest take-off roll in the fleet  +  DEPARTURE_AIRBORNE_MARGIN_S
```

with a hard distance floor of **3.5 NM** underneath it, because the real rule has a distance in it
too and nothing should be released with an arrival that close however slowly it happens to be
flying.

**The two land almost on top of each other at an approach speed.** With a 40 s margin the clock
asks for 3.59 NM behind an arrival at 141 kt and the floor asks for 3.5, so the two rules agree
there and the clock governs cleanly at every speed above it. That is the figure the margin was
tuned to: much below it the floor starts overriding the clock in the ordinary case, which would
leave the constant naming a margin it was not actually applying.

Three things follow, and all three were wrong when this was a bare 3 NM:

- **The arrival's speed counts.** One still carrying 180 kt blocks from 4.61 NM; one already at its
  approach speed releases at 3.59. A distance gate could not tell them apart, and 3 NM was
  calibrated on the approach-speed case only.
- **The take-off roll is a computed number**, `v2Kts ÷ (TAKEOFF_ACCEL_KTS_S × budgetScale)` — 36 s
  for a medium, 49 s for the slowest heavy. The release uses the fleet maximum, because the type is
  not drawn until the release itself (the queue is a count, §4.7). Being conservative for a medium
  is the right way round: the cost is a departure held a few seconds longer than it needed to be.
- **The safety margin is its own term.** The old 3 NM was chosen so the *slowest* type would just
  clear, which meant every release sat at that type's edge by construction — a B77W rotated with the
  arrival at 0.8 NM and 300 ft. It now rotates with the arrival 1.63 NM out at 519 ft, and an A320
  with it 2.15 NM out at 685 ft.

  The theoretical floor on this term is about **8 s** — the time an arrival takes to cover the
  0.3 NM at which the go-around backstop (§6.2) would fire. 40 s is five times that: enough that a
  release is not one wobble away from a go-around, and not so much that the runway sits idle behind
  a gap it could have used.

`tests/departure.test.ts` flies all 36 departure/arrival type combinations and asserts the departure
is off the ground before the arrival lands, rather than trusting the arithmetic.

One consequence worth stating: a departure needs about **6 NM** between two arrivals to get out,
against 5.3 NM under the old bare-distance gate. A departure released 60 s after a landing has to
find the next arrival still outside the release distance, and those 60 s of a 141 kt approach have
already spent 2.4 NM of the gap. The whole timeline, at the tightest pair that still works:

```
t = 0     first arrival lands
t = 60    runway clear; second arrival at 3.6 NM, 90 s out → released
t = 109   departure airborne (49.4 s, the fleet's slowest)
t = 149   second arrival crosses the threshold
```

The in-trail minimum is 3–4 NM, so a departure still has to be *given* the gap rather than finding
one in an ordinary tight sequence. Against a faster arrival it needs more: 6.8 NM at 160 kt, 7.7 NM
at 180 kt.

**Why 90 s between departures.** It covers the wake-turbulence minimum behind a medium and the time
the first aircraft needs to be airborne and clear. It caps the runway at 40 departures an hour,
comfortably above the 20/h the player can ask for — which is deliberate: it means a growing queue is
always the *arrivals* eating the runway, never the release interval itself. An arrival landing
between two departures adds its own 60 s rolling-out interval on top.

This is what makes the departure flow a request rather than a promise — run a tight arrival sequence
and the departures back up behind it, exactly as they do in life.

#### Flow, and what the player can and cannot do

Departure flow is set separately from the arrival flow, **0–20/h in steps of 5**, default 10/h; zero
switches departures off entirely. Unlike the arrivals it is **not** a Poisson stream: 20/h means one
joining the queue every three minutes, exactly. The arrivals are random because Center's delivery is
the problem the player is given; the departures are an airline schedule. It also makes the queue
mean something — it grows because the runway is not releasing, never because the generator happened
to clump.

The type, callsign and SID still come from a **third** seeded stream (`world.departureRng`) drawn at
the release, alongside the traffic and pilot streams (§4.4), so `?seed=` reproduces the same
*arrival* problem whatever the departure flow is set to — asserted in `tests/departure.test.ts`.

The player has no authority over a departure at all. `isControllable` is false for one, every
command refuses with "is with Departure — not on your frequency", and Tab skips them: Tab is how
you reach the aircraft you are about to instruct, and at 20 departures an hour stepping through
traffic that takes no instructions is a key press wasted every time. They stay clickable, which is
how you read one's altitude.

**Display.** Drawn in the muted shade already used for aircraft handed to Tower — the shade means
"not yours to instruct", and the reason it is not yours is not worth a second colour. The data block
tag is `DEP`, and the assigned-altitude field shows the SID's own ceiling, so the departure's plan
is readable off the scope without a chart. The SID charts themselves are drawn in a warm amber
against the STARs' cool blue-grey: the two chart layers cross, and the one question asked of them
is which traffic is the player's.

Leaving the airspace on a SID is the *point* of a departure, not the failure an arrival's exit is
(§3.4): it counts in its own `DEPARTURES` tally, gets no boundary warning, and says so in the
ordinary voice rather than the alert one.

---

## 5. Simulation loop

Three distinct rates, which is the whole design of the loop:

| Rate | What runs at it |
| --- | --- |
| **20 Hz** (dt = 0.05 s), fixed timestep | Physics: turn, vertical, speed integration, LOC/GS capture, separation checks |
| **20 fps** | Scope redraw — glyph position, leader line. Motion reads as smooth |
| **1 Hz** | "Radar return": data-block values (altitude, speed, heading) and conflict-alert level for display |
| **0.1 Hz** | History dots. At 250 kt a 1 Hz dot moves ~0.6 px on a 50 NM scope — invisible. One dot every 10 s, ten retained, gives 100 s of visible history — longer than the minute the leader line projects forward, so a turn that started before the last instruction is still on the scope, and the dots are spaced far enough apart to read a speed off them. **Drawn only for traffic the player has authority over** — the trail is read on the way to an instruction, and on a departure or an aircraft already with Tower there is no instruction to make, so the dots are clutter over the busiest part of the scope |

- Physics and rendering share the 20 Hz tick, so **no interpolation layer is needed** — the glyph
  simply draws wherever the sim currently is. That removes an entire class of "render state drifted
  from sim state" bug.
- The 1 Hz layer is a *sampling* of sim state into a `RadarReturn` snapshot per aircraft. Data
  blocks therefore hold still for a full second while the aircraft glides, which is the look you
  asked for and also stops the altitude digits from flickering.
- Physics is written dt-agnostic, so 20 Hz is a constant, not an assumption baked into the maths.
- **Time acceleration:** 1× to 16× by stepping physics more times per frame; the 1 Hz radar
  sample scales with *sim* time, so at 4× the data blocks refresh 4× per real second.
- **Pause** stops the accumulator; input remains live.

Cost sanity check: 25 aircraft × 20 physics steps/s = 500 updates/s, and a redraw is ~25 glyphs,
~150 trail dots, ~75 text lines and a blitted static layer, 20 times a second. Sub-millisecond
frames on old hardware. **There is no performance problem to design around here**, which is why §11
optimises for maintainability instead.

---

## 6. ILS approach logic

### 6.1 The clearance gate (`C` key)

A clearance is a statement about what the aircraft will do **when it reaches the localizer**, not
about where it is when the clearance is given. So the gate only refuses the cases where the
clearance could never mean anything — the geometry is nonsense, or the localizer is not receivable.
Everything about the aircraft's instantaneous state is a prediction at this point, and is settled
for real by §6.1a.

| # | Condition | Value | Source |
| --- | --- | --- | --- |
| 1 | Not already cleared, not going around, not with Tower | — | — |
| 2 | Before the threshold | `d > 0` | — |
| 3 | At or above MVA | ≥ 2000 ft | — |
| 4 | Within LOC coverage | ≤ 25 NM from threshold | LOC service volume |
| 5 | Closing on the localizer | cross-track error decreasing | a diverging track never reaches the window |

Soft warnings that do **not** block the clearance but are logged and scored: above the G/S (with
the height, and a note that it must be at or below by the intercept), speed >210 kt inside 15 NM,
intercept inside 6 NM (rushed).

This is why the controller may turn an aircraft onto a 30° intercept and clear it in the same
breath, or clear one that is still descending to the platform because they can see it will level
off in time. Both are ordinary technique in a busy sequence, and refusing them out of hand cost
attention the controller did not have to spare.

### 6.1a The intercept window

Tested **at the localizer** — the tick on which the aircraft first arrives inside the 0.5 NM
capture band, closing:

| # | Condition | Value | Source |
| --- | --- | --- | --- |
| 1 | Intercept angle to the 180° final approach course | **≤ 45°** | your spec (§2.2 prefers ~30°) |
| 2 | Level, not still descending through the intercept altitude | `|vs| ≤ 200 fpm` | §2.2 |
| 3 | Speed | **≤ 230 kt** | above the published platform speeds; a faster turn overshoots |

Fail any of them and the aircraft **flies through the localizer**: the clearance is cancelled, the
phase reverts to `inbound`, the crew reports *"unable to intercept — 80° exceeds 45°. Through the
localizer, request vectors"*, and the controller has to vector it back round and clear it again.
It does **not** go around — a missed intercept 15 NM out is a vectoring problem, not a runway one.
The cost is track miles and the sequence, which is the honest price.

The glideslope is deliberately not checked here. It has its own capture, from below only (§6.2.2),
which is what "checked individually, at the time of intercept" means on the vertical axis: an
aircraft that intercepts the LOC above the path simply never captures the G/S and is caught by the
5 NM stability gate.

Soft warnings at the intercept, logged and scored but not blocking: angle >30°, and **above the
glideslope**. The second one matters more than it looks. The path *falls away* as the aircraft
flies inbound, so an aircraft that reaches the localizer above it never captures — it is already a
go-around at 5 NM, several minutes before anything visibly goes wrong. Since §6.1 no longer refuses
a high clearance, the intercept is the last moment the controller can be told while a descent still
fixes it, and the sidebar says so continuously for the whole `loc` leg rather than reporting
"waiting for the glideslope" to an aircraft that will wait forever.

### 6.2 Capture and landing

1. **LOC capture** — once cleared, when cross-track error < 0.5 NM *and the intercept window of
   §6.1a is satisfied*, the aircraft turns to track the final approach course, holding assigned
   altitude. Phase → `loc`.
   *Established* (the handoff criterion, §2.3) = `phase ≥ loc` AND `|cross-track| < 0.3 NM`
   AND `|heading − 180| < 5°` AND tracking inbound.
2. **G/S capture** — when the 3° path is reached from below, phase → `gs`; the aircraft descends at
   `fpm ≈ 5.31 × GS`, i.e. ~740 fpm at 140 kt.
3. **Deceleration on final** — once cleared, speed reverts to the aircraft's
   discretion, on a schedule keyed to along-track distance: ≤250 kt beyond 12 NM, ≤210 kt from
   12 NM, ≤180 kt from 8 NM, and **Vapp from 5 NM regardless**. Each gate only ever slows the
   aircraft — the schedule never speeds one back up. A speed the player assigns **once the aircraft
   is established** (`loc` or `gs`) replaces the schedule entirely and is honoured until 5 NM (the
   "maintain 170 kt to 5 mile final" technique of §2.3), which is also the trap: assign 210
   and forget, and the 5 NM gate drops the target straight to Vapp with the aircraft 70 kt above
   it, failing the stability check below.
   A speed assigned while merely *cleared* — before the intercept — is **ordinary speed control**
   and does not arm 6.14.4. Since §6.1a lets the clearance be given 20 NM out, sequencing speed
   control lands in that window constantly; treating it as the technique would silently carry the
   speed to 5 NM and go around a correctly-flown approach.
   The rate itself is the ordinary 1 kt/s of §4.3; on a 3° path the descent only spends ~740 fpm of
   the 2500 fpm energy budget, so the coupling rarely binds on final — it binds when the controller
   asks for descent *and* deceleration together before the intercept.
4. **Touchdown** — at the threshold: log the landing, add to stats, **despawn**.
5. **Go-around** (automatic) — if inside 5 NM any of: not established on LOC, >1000 ft above G/S,
   more than 45 kt above Vapp, or in-trail spacing < 2.5 NM. That last one is a backstop, not the spacing
   rule: the 4 NM gap is enforced out at 10 NM (§9.3), and by 5 NM only a genuinely unusable gap is
   worth a go-around. The aircraft climbs to 3000 ft on runway
   heading and returns to `inbound` as the player's problem, and the event is scored.
6. **Go-around, runway occupied** — separately from the stability gate and much later, at
   **0.3 NM**: if anything is still on the runway (§9.4), the arrival goes around. This is not about
   how the approach was flown, it is about what is on the concrete, and it is the reason the release
   logic of §4.7 is allowed to be a prediction: a decision made a minute ago cannot bind an aircraft
   about to land on an occupied runway. 0.3 NM is about eight seconds at an approach speed — inside
   where a crew would have committed, outside the threshold itself.

---

## 7. Controls and interaction

### 7.1 Selection

- Left-click an aircraft blip or its data block to select. Click empty space to deselect.
- `Tab` cycles selection by distance to the threshold (nearest first) — keyboard-only play.
- The selected aircraft is highlighted and its data block expands; the sidebar shows its
  Altitude / Speed / Heading exactly like the reference screenshot — each as *current → assigned*.
- The sidebar speed pair is **IAS**, because IAS is what an instruction sets. Ground speed is a
  detail row below it, with the altitude bonus printed alongside (`287 kt (IAS +37)`), so the two
  numbers on screen can be reconciled without arithmetic.
- **The message log follows the selection**: with an aircraft selected it shows only the lines
  about that aircraft, and with nothing selected the whole frequency. At 20-plus aircraft the log
  scrolls faster than it can be read, so the readback to an instruction just given is usually gone
  by the time it is looked for; filtering makes the last five lines the ones that answer "what did
  I tell *this* aircraft, and what did it say". A separation call names two aircraft and appears
  under either of them. This holds in replay too, where reading one aircraft's exchanges back is
  most of what a review is (§17.2).
- The altitude row carries the **current vertical rate in brackets** — `7001 (−1200) → 5000` —
  dim rather than yellow, since it is a trend the aircraft is producing, not a value assigned to
  it. Rounded to 50 fpm and blank in level flight, so it reads as a trend rather than jitter.

### 7.2 Keys

| Key | Action |
| --- | --- |
| `A` / `D` | Assigned heading −10° / +10° (wraps 010–360) |
| `W` / `S` | Assigned altitude +1000 / −1000 ft (clamped 2000–13,000) |
| `Q` / `E` | Assigned speed −10 / +10 kt (clamped per §3.3) |
| `C` | Clear for ILS approach (subject to §6.1) |
| `H` | Hold at the next fix / leave the hold (§4.6, STAR only) |
| `Tab` | Cycle selection |
| `Space` | Pause / resume |
| `1` … `5` | Time acceleration: key *i* selects 2^(i−1), so 1× / 2× / 4× / 8× / 16× |
| `Esc` | Deselect |

**Commit semantics: each keypress transmits immediately** — no OK/confirm step. What it does *not*
do is take effect immediately.

**Pilot reaction time.** An instruction is read back and flown **1–3 s** after it is transmitted
(uniform, from its own PRNG stream). The consequences are the point:

- Only **one instruction of each kind** can be outstanding, so a burst of `D` presses inside the
  window is *one* turn instruction at the final value, read back once — "turn right heading 210",
  not four separate 10° turns. A burst of `S` still reads naturally as "descend 4000".
- The scope shows the **assigned** value from the moment it is transmitted (the dashed heading
  vector, the sidebar's `→` targets), while the aircraft is still flying the old one. The gap
  between the two is the reaction, not lag.
- At 4× time acceleration the delay is 4× more expensive in track miles, which is the honest cost
  of running the session fast.
- An approach clearance transmitted while something else is still being read back is acted on
  **after** it. "Turn left 210, cleared ILS" is one transmission, but each half draws its own
  reaction time, so without this the clearance could be flown first and the turn then arrive
  behind it looking like a vector *off* the approach — silently cancelling the clearance just
  given. The crew never acts out of order.

Refusals — below the speed floor, at the ceiling, an ILS clearance that fails §6.1 — are heard
immediately, because they are the controller's own check, not the crew's. A **missed intercept**
(§6.1a) is the opposite: it is heard when it happens, at the localizer, because only the aircraft
knows whether the controller's prediction came true.

### 7.3 Radar display

Mirroring the reference screenshots:

- **Blip:** a filled top-down airliner silhouette, rotated to the current heading, plus a **leader
  line** showing the 1-minute projected position. **Wake category sizes it** — a heavy draws at
  1.2× and a medium at 0.8×, so the aircraft that will need the wider gap is the one that looks
  bigger, without reading the `H` off its block.
- **Data block**, two lines, offset from the blip:
  ```
  KLM133 ARDIS    ← callsign + state tag (next fix, ILS/LOC/G/S, G/A or TWR)
  80 ↓60  287M    ← altitude / target in hundreds of feet, then ground speed + wake category
  ```
  Altitude and speed share a line because "how low and how fast" is one question, and the shorter
  block collides with fewer of its neighbours.

  The speed on the block is **ground speed, not the assigned IAS** (§4.4). Radar measures motion
  over the ground, and ground speed is also what the in-trail spacing closes at — so it is the
  number to read when judging a sequence. It is *not* the number an instruction sets: a descending
  aircraft's block speed falls as it loses the altitude bonus even with the IAS held constant. The
  IAS, current and assigned, is in the sidebar for the selected aircraft.
  with the **assigned heading** shown alongside in a contrasting colour when it differs from the
  current heading (the yellow `040` in the screenshot).
- **Assigned-heading vector:** for 5 s after a turn instruction, a dashed pale-yellow line is drawn
  from the blip along the *target* heading, half again the length of the green leader line, capped
  with a tick and labelled with the heading. The green leader shows where the aircraft is pointing
  now, the yellow one where it is going; the gap between them *is* the outstanding turn. It fades
  out over its last second, and a further press restarts the window rather than extending it.
- **Altitude convention:** hundreds of feet, two digits (`80` = 8000 ft). `=70` = level at 7000,
  `↓60` = descending to 6000, `↑` for climbing.
- **Colour coding:** data blocks and leader lines are a cool near-white; the blip is a shade bluer
  than its own label so the two read apart. Over that, in order of precedence: **violation** bright
  red *and ringed*, **conflict warning** light red, **go-around** light yellow, **selected** white,
  **handed off to Tower** dimmed grey. The two alert levels differ in brightness rather than hue —
  a warning is the same problem as a violation a few seconds earlier — and the ring is held back
  for the violation alone so the escalation reads across the scope without the two reds having to
  be told apart. A go-around outranks the selection because the selection already has a ring of its
  own, while a go-around is the state that must be noticed unprompted.
- **Static map layer** (range rings, centerline + 2 NM ticks, gate markers, runway) is drawn once
  to an offscreen canvas and blitted each frame.
- **Message log**, bottom of the scope: pilot readbacks and system messages, ~4 lines visible,
  styled like the screenshot's green text. Filtered to the selected aircraft (§7.1). Each line
  carries the aircraft it is about rather than being matched on its callsign text, so the filter
  does not depend on how a message happens to be worded.
- **Label de-clutter:** data blocks are placed at the first of 8 candidate offsets that does not
  overlap an existing block. Cheap, and it matters a lot at 25 aircraft.

---

## 8. Objective and scoring

The session is endless; the score is a running quality report, not a life counter.

| Metric | Definition |
| --- | --- |
| Landings | Aircraft that touched down |
| Landing rate | Landings per hour over the **trailing 12 minutes** of sim time (§8.2) |
| Separation violations | Count, plus total seconds in violation |
| Go-arounds | Automatic go-arounds triggered |
| Airspace exits | Aircraft that left the 50 NM circle laterally (handed back to Center — penalty) |
| Track-mile efficiency | Actual track miles flown ÷ straight-line distance from gate to threshold, averaged |
| Clearance rejections | Failed `C` attempts, by reason — the learning signal |
| Missed intercepts | Clearances accepted that then failed the §6.1a window at the localizer, by reason |
| Departures | Departures that got airborne and left the area on their SID (§4.7) |
| Departure rate | Departures per hour off the runway, over the same trailing 12 minutes (§8.2) |
| Departure queue | How many are holding short right now — amber above **3**, red above **6** (§8.2) |

### 8.2 Landing rate

Quoted over a **trailing 12 minutes** rather than the whole session, because the useful question is
"how is it going *now*" — the number to compare against the arrival flow you are being fed. A
session average only ever converges, and hides the twelve minutes where the sequence fell apart.

Landings inside the window are counted and extrapolated over however much of it has elapsed, so at
minute 5 three landings read as 36/h rather than 18/h. Below **2 minutes** elapsed the sample is too
short to extrapolate honestly and the field reads `—`. A quiet twelve minutes decays the rate to 0/h
while the `Landings` total stands, which is the point of having both.

The **departure rate** is the same measure on the other movement, and is timed at the take-off
*roll* rather than at the airspace exit that the `Departures` total counts — the rate is about what
the runway got away, and an exit happens eight minutes downstream of the runway decision that caused
it.

The **departure queue** is neither: it is a live gauge, not a windowed rate. It is the one number
here that is caused by the player without being about them — they have no authority over a
departure, but the gaps they leave on final are what releases one, so a queue that only grows is a
final that has stopped giving the runway back. It turns **amber above 3** and **red above 6**: three
deep is a final working the runway hard, six deep is one that has taken it over. Neither tier costs
anything — nothing scores a departure yet (§15.11) — they are there to be noticed.

---

## 9. Separation and conflict detection

- **Violation:** horizontal < **3.0 NM** *and* vertical < **1000 ft** simultaneously (§2.1).
- **Alert tiers** (§2.1): **amber** at <3 NM and <1000 ft; **red + audible** at <1.5 NM and
  <500 ft.
- **Predicted conflict:** straight-line extrapolation of both aircraft 90 s ahead; if it breaches
  the minima, both blips get an amber halo. This is what makes the game teachable rather than
  punitive — you see it coming.
- **Exemption:** aircraft both `established` on the same LOC are not laterally separated in the
  usual sense (they are in-trail), so the pair is exempt from the 3 NM/1000 ft test and instead
  subject to the in-trail rule below.
- Checks run on every physics step over all pairs. At 25 aircraft that is 300 pairs × 2 Hz —
  no spatial index needed.

### 9.3 In-trail spacing and the sequencing gap

Radar separation is 3 NM, but the *landing* interval is limited by the runway rather than the radar:
the aircraft ahead has to touch down, roll out and vacate before the next one crosses the threshold.
At 140 kt, 3 NM is only 77 seconds — not enough. The gap therefore has to be **4 NM**.

Where that is enforced matters more than the number. A gap can only be built while there is still
room to vector and slow, and it erodes on the way in as the pair decelerates; by short final the
sequence is simply what it is, and squeezing an aircraft there fixes nothing while costing a
go-around. So the minimum is range-dependent, and the requirement bites *early*:

| Where | Minimum to the aircraft ahead |
| --- | --- |
| On final, **10 NM and beyond** | **4.0 NM** — the sequencing gap, built where it can still be built |
| On final, inside 10 NM | **3.0 NM** — ordinary radar separation; the sequence is set |

Enforced at two points: the handoff is withheld until the projected spacing at the threshold meets
whichever minimum applies at the aircraft's current range (§10 step 3), so an aircraft that is not
yet properly sequenced stays on your frequency; and a bust raises the red halo and scores a
separation violation. Inside 5 NM the go-around backstop stays at **2.5 NM** (§6.2) — that is the
point at which the runway genuinely will not be clear and nobody can do anything about it.

Practically this makes speed control on final the core skill: 4 NM at a common 160 kt is a 90 s
landing interval, i.e. a ceiling of about 40 movements an hour, which is what the flow-rate slider
is being measured against.

### 9.4 The runway environment

Radar separation does not apply to a departure that is still on or just off the runway. An arrival
landing over an aircraft that is still rolling is not a radar problem — it is the tower's, and
*runway* separation is what governs it. So a pair is skipped while either aircraft is a departure
that is either still rolling, or below **1000 ft AGL and within 5 NM of the threshold**.

Both halves of that test matter: the height alone would carry the exemption with an aircraft the
player has managed to get in front of somewhere else, and the distance alone would exempt one still
sitting on the runway at 5 NM. It is the same kind of exemption two aircraft on one localizer
already get (§9.3) — a different rule applies there, not no rule.

Everywhere else a departure is ordinary traffic: it raises warnings and violations against arrivals
like anything else on the scope, which is the whole reason it is worth having on the scope.

**What "occupied" means.** The runway is occupied while a departure is in `phase === 'roll'`, or for
`DEPARTURE_HOLD_AFTER_LANDING_S` (60 s) after a touchdown. The second half is a *time* because the
landing that owns the runway has already been despawned — it stops being an air-traffic problem the
moment it touches down (§6.2 step 4), so the runway remembers it instead. That 60 s used to hold
only the next departure; it now also sends an arrival around at 0.3 NM, which is what makes the
occupancy real rather than a rule about departures. An in-trail sequence at the §9.3 minimum is
77–103 s apart and never trips it; one flown tighter than about 2.3 NM does.

## 10. Handoff to Tower

Automatic, when **all** hold (§2.3):

1. `established` on the LOC (per §6.2 step 1 — aligned with the centerline, not merely "in the cone").
2. G/S captured (`phase = gs`) or at/below the G/S and descending.
3. **Acceptable closure rate:** projected in-trail spacing at the threshold ≥ the minimum in force
   at the aircraft's current range — 4 NM at 10 NM and beyond, 3 NM inside it (§9.3) — given both
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
    pathLayer.ts       # the selected aircraft's whole path, in replay (§17.3)
  replay/              # reads the sim, never writes to it
    recorder.ts        # rolling 60 min of sim time, sampled at 5 Hz into per-aircraft tracks
    playback.ts        # rebuilds a World at any frame + the transport
    replayBar.ts       # the stop-and-watch button, and the transport controls
  input/
    controller.ts      # the one surface input drives — live session or playback
    keyboard.ts
    pointer.ts
  app/
    main.ts            # loop, wiring, time accel, pause, live/replay switch
  style.css
tests/                 # 135 tests, sim + replay, no DOM needed
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
| **M7** | Replay: always-on rolling recording, stop-and-watch transport with scrub / ±10 s / 0.5–16×, whole-path drawing, controls withheld (§17) | ✅ done |

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
| A6 | Aircraft always comply, after a 1–3 s reaction; no "unable", no pilot deviations, no emergencies, no fuel state |
| A7 | Center's handover is always conflict-free, at the gate's altitude (11,000 or 13,000 ft) / 250 kt / on the STAR — or above it, when the entry fix already has a holding stack (§4.5) |
| A8 | Aircraft turn the short way to an assigned heading; long-way-round vectors aren't expressible |
| A9 | 4 gates, 90° apart, offset 40° from the cardinals |
| A10 | Endless session, no win/lose state; quality is reported, not enforced |
| A11 | One STAR per gate, never rejoined once vectored off; no route changes. Holding is the one way back onto a route, and only because the aircraft never leaves it (§4.6) |
| A12 | Departures always fly their SID exactly and are never re-routed, delayed airborne or given a level change by Departure Control. What the player sees is the published route, every time (§4.7) |
| A13 | A departure's climb rate depends only on type and on whether the flaps are up. No weight, temperature, thrust derate or runway-length effect (§4.7) |

---

## 14. Decisions taken

| Question | Decision (2026-08-14) |
| --- | --- |
| Radar refresh feel | **Smooth motion at 20 Hz, data blocks at 1 Hz.** Physics runs at the render rate so no interpolation layer exists (§5) |
| Bad-approach handling | **Both gates**: `C` refuses an out-of-limits clearance with the specific reason, *and* an unstable approach inside 5 NM auto-goes-around (§6) |
| Altitude ceiling | **13,000 ft assignable**, giving climbs as a de-confliction tool; everything above 8000 ft is stacking-only, outside LOC coverage. Departures climb through it to 14,000 (§3.3, §4.7) |
| Airspace exit | **Scored penalty, aircraft despawns**, with an amber warning 5 NM before the boundary. No soft wall (§3.4) |

| Question | Decision (2026-08-15) |
| --- | --- |
| Arrival routing | **Four published STARs, flown on autopilot** to a platform — 3000 ft / 200 kt north, 3000 ft / 210 kt south — rather than "direct ARP and wait" (§4.5) |
| Where crossing altitudes and speeds live | **Per route and per fix, in `scenario/stars.ts`, not as shared constants.** Shared constants coupled fixes that are only incidentally equal, so retuning one crossing moved three others and every new distinction needed a new constant first. Repeating the twelve crossings is the cheaper trade when the profile is expected to change (§4.5) |
| What a vector cancels | **Heading takes the aircraft off the route; altitude and speed take only their own axis.** Descending an aircraft on its STAR is the single most common real instruction and must not cost the lateral track (§4.5) |
| Descent profile | **Continuous, interpolated between published altitudes** — crossing altitudes made good exactly, no dive-and-drive (§4.5) |
| Pilot reaction | **1–3 s**, one outstanding instruction per axis, assigned values shown immediately (§7.2) |

| Question | Decision (2026-08-15, later) |
| --- | --- |
| When an ILS clearance is tested | **Twice, for different things.** The clearance gate keeps only what makes a clearance meaningless (§6.1); the intercept window — angle, level, speed — is tested at the localizer (§6.1a). A controller must be able to turn an aircraft onto the intercept and clear it in the same breath, or clear one that will level off before it gets there. Refusing on instantaneous state forced a vector-wait-watch-clear rhythm that cost the most attention exactly when there was least to spare |
| What a missed intercept costs | **The aircraft flies through the localizer**, the clearance is cancelled, and it must be re-vectored and re-cleared. Not a go-around: at 15 NM this is a vectoring failure, not a runway one, and track miles plus a broken sequence are the honest price |
| The intercept speed limit | **230 kt**, a ceiling the published platform speeds (200/210 kt) sit under with margin. It is the one condition the controller can only fix well in advance, which is the point — an aircraft left at 250 kt off the STAR will not intercept |
| Whether the G/S is part of the intercept window | **No — it keeps its own capture, from below only.** That already *is* an individual check at the time of intercept, and an aircraft that intercepts the LOC high is caught by the 5 NM stability gate (§6.2.5) |
| What arms the 6.14.4 speed technique | **Established, not merely cleared.** Once the clearance can precede the intercept by 20 NM, "speed assigned after the clearance" stops being a reliable proxy for "maintain XXX to X mile final" — it catches every ordinary sequencing reduction as well, switches off the deceleration schedule, and goes an otherwise good approach around for excessive speed (§6.2.3) |

| Question | Decision (2026-08-15, display) |
| --- | --- |
| Airspace shape | **The circle's caps are cut at \|y\| = 42 NM** and the scope zooms to the chords (§3.1). The cut cannot go tighter than the entry gates at \|y\| = 38.3 NM without handing arrivals over from outside the airspace; 42 leaves them 3.7 NM and buys ~20 % more scale |
| Which speed the data block shows | **Ground speed.** Radar measures motion over the ground, and closure on final is a ground-speed problem. The consequence is deliberate: a descending aircraft's block speed drops without anyone touching its IAS (§7.3) |
| Which speed an instruction sets | **IAS, unchanged** — that is what a crew flies. The sidebar shows the IAS pair for the selected aircraft and prints the altitude bonus next to the ground speed, so the two are reconcilable on sight rather than mysterious (§7.1) |
| Vertical rate on the readout | **In brackets beside the altitude, dim, rounded to 50 fpm, blank when level.** The assigned figures are yellow; a rate is something the aircraft is doing, not something it was told (§7.1) |

| Question | Decision (2026-08-15, holding) |
| --- | --- |
| Who may hold | **Only aircraft on a STAR.** The pattern is anchored on the fix the aircraft is already tracking to, so off the route there is nothing to anchor it to. It also keeps the feature to the case it is for: metering the arrival flow before it reaches the vectoring area (§4.6) |
| Which fix | **Whichever fix the aircraft is currently tracking to**, including the last one on the route. Holding at the final fix is exactly where a congested field wants the aircraft parked, and allowing it means the STAR simply never completes until the hold is left |
| Entry procedure | **Direct entry only.** The published parallel and teardrop entries exist to join the inbound leg from an arbitrary direction; an aircraft on its own STAR leg is always arriving in the direct sector, so modelling the other two would add a state machine that never runs (§4.6) |
| Inbound course | **The reciprocal of the track the aircraft crossed the fix on**, rather than a published course per fix. The pattern aligns itself with the arrival, so no fix needs new chart data and the geometry is identical from every gate |
| Altitude in the pattern | **Frozen at the fix's published crossing altitude**, flown level as an ordinary target. The STAR profile is keyed to distance-to-go, which stops decreasing in a hold, so the profile cannot own the vertical there (§4.6) |
| What a hold does to the STAR | **Suspends it, does not end it.** `ac.star` stays set and sequencing stays on the holding fix, so leaving the hold resumes the published profile from that fix — the one route-rejoin in the model, and only because the aircraft never left (§4.5, A11) |
| Second `H` before the fix | **Cancels outright.** Nothing has happened yet; making the aircraft fly a full pattern it was never established in to undo a keypress would be a punishment, not a simulation |
| Second `H` once established | **Completes the loop and leaves at the next crossing of the fix.** A hold exit is a fix-referenced instruction in the real world, and cutting the pattern short mid-leg would put the aircraft somewhere the controller has not planned for |
| Turn direction | **Always right**, even where the geometry pushes toward the boundary. Standard holds are right-hand; a left-hand pattern is a published exception, and choosing the direction per fix would hide the airspace cost of holding at a corner. Where it runs out of room, that is the controller's problem to see (§3.4) |
| Drawing the pattern | **No racetrack on the scope, just `HOLD` on the block.** The history trail already shows the shape, and four overlapping racetracks cost more legibility on a congested scope than they buy |
| `C` while holding | **Refused.** A holding aircraft is not tracking towards final, so a clearance would be a prediction that cannot come true; take it out of the hold first (§6.1) |

| Question | Decision (2026-08-25, departures) |
| --- | --- |
| Whose aircraft a departure is | **Departure Control's, never the player's.** The player has no authority over one at all — it is traffic to be worked around, not traffic to be worked. Giving them away is what keeps the workload the arrival problem it already is, while still doubling the things in the way (§4.7) |
| How a departure appears | **Stationary on the threshold, and it rolls.** The alternative — materialising airborne off the departure end, the way an arrival materialises at a gate — is cheaper, but a take-off roll is what makes the shared runway legible: you can see why the next one is waiting (§4.7) |
| What a SID publishes | **Restrictions, not a profile.** A STAR is a descent profile the aircraft is flown onto; a SID is a set of crossings with the aircraft's own performance in between. Modelling it as a profile would have meant inventing climb gradients that no chart carries (§4.7) |
| Where the crossing restriction ends | **Five miles past the crossing, not at it.** Releasing the climb at the crossing puts the departure back inside 1000 ft of the arrival route three miles later, which is a violation by our own rule — measured at 980 ft. No crossing altitude fixes it either, since the downwind tops out at 7000: the geometry decides, so the `at or below` is carried by a fix beyond the conflict (§4.7) |
| Departures and separation | **Full radar separation, and violations count.** Advisory-only alerts were the alternative, on the grounds that the player cannot instruct a departure — but that is exactly why it counts: the arrival is the half they *can* move (§9.4) |
| The runway | **Shared, and it holds departures.** Arrival inside 3 NM on final, or a landing rolling out, blocks the release; the departure joins a hold-short queue and goes late rather than not at all. The set flow is therefore an upper bound that a busy final eats into, and the queue length is what shows it (§4.7) |
| Climb performance | **Per type, from the EUROCONTROL APD.** Everything else in the model is two performance classes, and stays that way — but the whole airspace sits inside the APD's initial-climb band, so for departures there is real per-type data covering exactly the regime flown (§4.7) |
| A third random stream | **Yes**, alongside traffic and pilot reaction. `?seed=` has to mean the same arrival problem whatever the departure flow is set to (§4.4) |

| Question | Decision (2026-08-20, replay) |
| --- | --- |
| When recording starts | **Always on, rolling.** A start button gets pressed after the interesting thing has happened; one button that stops the session and plays it back is the whole interface (§17.1) |
| How long is kept | **The last 60 minutes of sim time**, in memory only, lost on refresh. Game time rather than wall-clock, so time acceleration records more session rather than the same hour of watching |
| Sample rate | **5 Hz, replayed as sampled.** Fine enough that 20 fps motion reads as smooth without an interpolation layer, and coarse enough that an hour is a few MB. Replaying samples rather than interpolating means playback cannot show a state that was never flown |
| Snapshots or inputs | **State samples, not a deterministic re-simulation.** Re-running the seed plus the player's keystrokes would be smaller and exact, but it makes rewind a re-simulation and couples playback to the sim staying bit-identical for ever. Samples are inert |
| Snapshots or tracks | **Per-aircraft tracks** (the transpose of a frame list). An aircraft's whole path is then contiguous, which is what §17.3's path drawing and the rebuilt history dots both need |
| What playback shows | **Everything the live scope showed except the instruction artefacts** — no leader line, no assigned-heading vector, no controls (§17.3). Stats, blocks, alert colours and the message log are unchanged, because reviewing them is the point |
| What playback adds | **The selected aircraft's whole path**, one solid line, the part still to come a shade dimmer. A live scope cannot show it; a recording already contains it |

## 15. Still open

None of these blocks play; each is a small, contained change.

1. **Runway identity** — built as `18` with a 180° final approach course. Match the screenshot's
   `18C` instead? (In reality that implies parallels we are not modelling.)
2. **Speed floor policy** — currently a hard block below 180 kt (190 for heavies) outside 20 track
   miles, refused with an explanation. Softer alternative: allow it and score it.
3. **Wake categories** — displayed on the data block, but not used for spacing. Should heavies
   require 4–5 NM in trail?
4. **Sound** — no audio at all yet. §2.1 describes an audible alarm inside 1.5 NM / 500 ft;
   one Web Audio beep would cover it.
5. **Aircraft glyph** — a simple cross-and-nose symbol. Worth drawing a proper airliner shape?
6. **Rejoining a STAR** — there is no "resume own navigation"; once *vectored*, an aircraft is on
   vectors for good. A `direct <fix>` instruction would be the natural way to give the route back.
   Holding (§4.6) is not this: it suspends the route rather than leaving it.
9. **Holding is unmetered** — nothing scores time spent in a pattern, and nothing stops the whole
   arrival flow being parked indefinitely. Track miles flown already grow while holding, so the
   efficiency ratio (§8) absorbs some of it, but a deliberate delay cost would say more.
10. **One hold per fix** — two aircraft told to hold at the same fix fly the same racetrack at the
    same published altitude and will trigger a separation violation. Real holds stack at 1000 ft
    intervals; here the controller has to assign the levels by hand, which is arguably the more
    honest exercise but is worth revisiting if it reads as a trap.
7. **Should "closing on the localizer" also move to the intercept window?** It is the one
   instantaneous condition left in §6.1. The argument for keeping it there is that a diverging
   track never reaches the window at all, so there is nothing to defer the check to; the argument
   against is that the controller may intend to turn it in a moment, exactly as with the angle.
8. **The two north routes end pointing at each other** at the same level, 4 NM apart. Deliberate —
   it is the sequencing problem — but if it proves unfair rather than hard, staggering ARDIS and
   BOXAR by 1000 ft is a one-line change.
11. **Departures are still unscored** (§4.7). The `DEP RATE` and `DEP QUEUE` rows now *show* what
    the runway got away against what was asked for, and what is stacked up behind it, so starving
    the departures is visible and colour-coded — but nothing counts it. Folding the shortfall into the session's quality figures would make the runway a
    resource to balance rather than one to monopolise.
12. **A departure is never re-routed** (A12). Real departures get level stops, radar vectors and
    "climb unrestricted" from Departure Control as the arrival picture changes. Modelling any of
    that would make the amber lines a prediction rather than a promise — which is more realistic
    and considerably less learnable.
13. **Both turning SIDs share NORVU**, so a west and an east departure fly the same 3 NM of track.
    The 90 s release interval means they are never close — at the 165–200 kt of an initial climb
    that is 4 NM or more of in-trail spacing, and the two-hour saturated soak finds no departure
    pair at all — but the margin is smaller than it was at two minutes, and if the release interval
    is ever shortened again each SID needs its own initial fix.
14. **The conflict predictor takes its two minima independently** (§9.2): the closest horizontal
    approach in the look-ahead window and the closest vertical approach, whether or not they happen
    at the same moment. That was harmless while everything in the airspace was descending inbound,
    but a departure climbing out towards an arrival coming in trips it a few times an hour on
    geometry that resolves itself — the pair is flagged amber and then both turn away. Requiring the
    two minima to coincide would remove the false positives, and would tighten the warning for
    arrivals as well.

---

## 16. Running it

```bash
nvm use          # Node 24 LTS, pinned in .nvmrc — the system default is 18 (EOL)
npm install
npm run dev      # http://localhost:5173
npm test         # 161 tests, headless, ~1.5 s
npm run build    # typecheck + static bundle into dist/
```

`?seed=1234` in the URL makes a session reproducible. In a dev build, `window.atc` exposes the live
world for console poking and `window.atcRecording` the rolling recording behind it (§17).

---

## 17. Session replay

A controller learns most from the sequence they have just flown, and the one thing a live scope
cannot show is what a decision led to. Replay is that: the last hour of the session, playable back
at the scope, with the controls taken away.

### 17.1 What is recorded, and how much

**Recording is always on.** There is no start button, because a start button only ever gets pressed
*after* the interesting thing has happened. The recorder holds a rolling **60 minutes of sim time**
— game time, not wall-clock, so a session flown at 8× keeps its last hour of *flying* rather than
its last hour of watching — and it lives in memory only. A refresh loses it, which is the intended
trade: nothing to manage, nothing to clean up, no storage permission.

| Decision | Value | Why |
| --- | --- | --- |
| Sample rate | **5 Hz of sim time** | Four times coarser than physics, five times finer than a radar return. Motion at 20 fps redraw reads as smooth without an interpolation layer, and playback shows samples exactly as they were taken — no rebuilt state that can disagree with what was flown |
| Window | **3600 s of sim time** | An hour is longer than any session anyone flies in one sitting; the cap exists so an unattended tab at 8× cannot grow without bound |
| Prune batching | **60 s of slack** | Dropping old frames splices every channel of every track, so it is done once a minute rather than five times a second. A recording is therefore between 60 and 61 minutes long |
| Storage | **Per aircraft, not per frame** | See below |

A departure track carries two extra channels — the SID's chart name and the index of the fix being
tracked — for exactly the reason an arrival's carries the STAR's. `sid` being non-null is what makes
an aircraft read as a departure everywhere downstream (muted, `DEP`, uncontrollable), so playback
has to rebuild it or a replay would show a departure as ordinary traffic. `phase` gained the two
departure states and still packs into its three bits (§4.7).

**Tracks, not snapshots.** The obvious shape is a list of world snapshots. The recorder stores the
transpose: one *track* per aircraft, each field a flat array indexed by frame. Two reasons, both of
which playback needs anyway:

- An aircraft's whole path is one contiguous array — which is exactly what §17.3's path drawing
  asks for, and what the history dots are rebuilt from instead of being stored per frame.
- It is a few numbers per aircraft-frame instead of an object per aircraft-frame. A busy hour is
  ~180,000 samples: single-digit MB, at which point there is no memory problem to design around.

What each sample holds is *what the display reads*: live position, altitude, heading and IAS; the
1 Hz radar sample as its own set of figures (§5); the three assigned targets; and one packed
integer for phase, alert level, handoff, route index and the manual/pending flags. Session stats
and the message log are recorded on the side — stats only when they change, which is a handful of
times a session. The two flow settings and the **hold-short queue length** ride along in the same
snapshot: the queue is displayed but has no aircraft anywhere in the recording to be rebuilt from
(§4.7), so it is stored rather than recomputed.

Everything derivable is **not** recorded and is recomputed at playback from the real sim functions:
final-approach geometry, in-trail spacing, the clearance preview, the landing rate. A recording
therefore cannot drift from the live readout, because the readout is computed the same way from the
same numbers.

### 17.2 Playing it back

`worldAtFrame` rebuilds a `World` of the ordinary shape, so every existing renderer draws a replay
without knowing it is one — the scope, the sidebar and the stats gutter are handed the same object
they always get. Two things are rebuilt rather than stored:

- **History dots**, from the track. The live scope lays a dot every 10 s on a grid anchored at zero
  and the recorder samples on a 0.2 s grid anchored at the same zero, so every dot has a frame
  sitting under it — within one physics tick, which is 0.007 NM at 250 kt. The one subtlety is that
  `step` advances the clock *before* testing it, so the dot for a 10 s mark does not exist yet at a
  frame landing exactly on that mark; counting dots off the frame alone draws one too many.
- **Separation**, by running the real `analyzeSeparation` over the rebuilt traffic, which is what
  gives the sidebar its in-trail figures. The per-aircraft *alert colour* still comes from the
  recording: on the scope that colour is a 1 Hz sample, not an instantaneous truth.

The transport is elapsed/total with a scrub bar, ±10 s, and 0.5×–16× — 0.5× being the one rate live
play does not have, since watching a sequence unravel slowly is the point. Arrow keys skip, space
holds, and the number keys set the rate, so the keyboard means the same things it did live.

Selection is held by the *transport*, not written onto the world: a replay frame is rebuilt every
redraw and anything written onto it is thrown away. It is also kept as an intent rather than a
fact — an aircraft exists for only part of the recording, so scrubbing outside its life leaves the
sidebar and the path quiet and brings them back rather than deselecting for good.

### 17.3 What the replay deliberately does not show

Stopping the session takes the controls away, so the display loses the parts of itself that only
exist because there were controls:

| Dropped | Why |
| --- | --- |
| The 1-minute leader line | It answers "where will this be in a minute" — a question only somebody who can change the answer needs to ask |
| The dashed assigned-heading vector | It exists to show a turn that has just been instructed and not yet flown. Nothing is being instructed |
| The sidebar's key list and session controls | None of them act on a recording, so they go rather than sit there refusing to work. Flow and restart belong to a live session |
| "Press C to clear" | The clearance preview stays — it says whether the approach was makeable at that moment, which is the thing worth reviewing — but as a description rather than an offer |

Everything else stays exactly as it was: data blocks with their assigned targets, history dots,
violation rings and alert colours, the message log replaying at the times things were said, and the
whole session stats block.

The panel lives in the bottom-right corner of the scope, over the canvas. The stats gutter (§11.2)
already keeps the airspace clear of the right-hand edge, so the overlap is a sliver of the boundary
south-east of TEMBA — an aircraft can sit under the transport for a few seconds of its run in from
that gate. Accepted rather than solved: the alternative is moving the transport off the corner it
was asked for, or reserving a second gutter that costs every session some scale.

**Added, because a replay can answer it and a live scope cannot:** clicking an aircraft draws its
*whole* path through the recording — one solid line, a shade dimmer where it has not yet got to —
rather than the last 100 s of dots. Both halves are drawn well above the STAR chart's own colour:
the track lies exactly along a published leg for most of its length, and a path no brighter than
the chart under it is invisible for every part of the flight that went to plan. "What did this one actually end up doing" is the
question a review is for, and the answer is already in the track.
