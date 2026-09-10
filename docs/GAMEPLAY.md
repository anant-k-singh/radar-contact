# Gameplay guide

You are the Approach controller at a single-runway field. Center hands you arrivals at the edge of
the radar area, already established on a published STAR. Your job is to sequence them onto the ILS —
correctly spaced, at or below the glideslope, slow enough to configure — and hand each one to Tower
once it is established.

**There are two jobs.** Everything below is **Approach**, which is what three of the four fields
are. The fourth, `?airport=VABBS`, is **Area** control — the sector *outside* Mumbai's approach
airspace — and it is a different job with the same keys. Skip to
[Area control](#area-control-vabbs) for that one.

**Three approach fields ship.** `?airport=ZZZZ` is the default, a trainer landing on **runway 18** inside a
50 NM circle: four gates 90° apart, symmetrical routes, and a chart designed to be learnable.
`?airport=VABB` is **Mumbai, runway 27**, transcribed from the real AAI charts — a 60 NM area, five
gates weighted by where Mumbai's traffic actually comes from, a second runway it does not use, and
departures that fan out to eight exits. It also flies higher: Center hands arrivals over between
12,000 and 17,000 depending on the route, against ZZZZ's 11,000–13,000, so you have more vertical to
work with and further to bring them down. Everything below describes ZZZZ; VABB plays the same and is
harder, mostly because its arrivals all have to finish east of the field and two of the five gates
are on the departure side.

Procedures follow standard radar-control practice. Every number below is derived and justified in
[REQUIREMENTS.md](REQUIREMENTS.md).

---

## Controls

| Key | Action |
| --- | --- |
| `A` / `D` | Heading −10° / +10° |
| `W` / `S` | Altitude +1,000 / −1,000 ft — MVA to the field's ceiling (2,000–13,000 at ZZZZ, 3,000–17,000 at VABB) |
| `Q` / `E` | Speed −10 / +10 kt |
| `C` | Clear for the ILS approach |
| `H` | Enter / leave the published hold |
| `R` | Resume the arrival — hand the published profile back, or rejoin the route after vectors |
| `Tab` | Cycle selection, nearest the runway first |
| `1` … `5` | Time rate — each key doubles the one before it: `1` real time, `3` is 4×, `5` is 16× |
| `Space` | Pause · `Esc` deselect |
| `←` / `→` | Skip 10 s back / forward — replay only (see below) |

Click a blip or its data block to select it. **Arr −/+** in the sidebar sets arrivals per hour
(5–50, default 25) — turn it down to learn the field, up when you want to be buried. **Dep −/+**
sets departures per hour (0–24; ZZZZ opens at 10, VABB at 22); `off` gives you the arrivals-only field.

`?seed=1234` in the URL reproduces a session exactly, down to the pilot reaction times — **for the
same `?airport=`**. The gates an arrival is drawn from are part of the field, so one seed at two
fields is two different sessions.

## The departures

The runway departs as well as lands, and those aircraft are **not yours**. They belong to Departure
Control: they are drawn in the muted grey the scope uses for anything you cannot instruct, tagged
`DEP`, and they ignore you completely.

They fly one of three published SIDs, drawn on the scope in amber:

| SID | Where it goes | The restriction |
| --- | --- | --- |
| `SABAR1A` | Turns right, out to the west | At or below **4,000** until MORVA, then 14,000 |
| `KIROS1A` | Turns left, out to the east | At or below **4,000** until TELMU, then 14,000 |
| `RAMOX1A` | Straight ahead, out to the south | None — it just climbs |

The two turning departures cross the RIMOL and TEMBA downwinds, which is why they are held at 4,000:
underneath your arrivals, which are at 6,700 or so at that point. MORVA and TELMU sit two miles
*past* the crossing, not on it — a departure that started climbing the moment it was clear would be
back in your arrival's level before it was laterally clear of the route. Two miles is a minute or so
of level flight, and then it is climbing again. As published, the two never touch.

**But your arrivals are only where you left them.** Vector one south of the field and the departure
corridor is waiting there, at 4,000 climbing to 14,000 — and a bust against a departure counts
against you exactly like any other, because the arrival is the half you could have moved. The amber
lines on the scope are the thing to keep the base turn clear of.

You cannot help a departure and you cannot delay one. What you *do* control is the runway. A
departure is released only when the arrival ahead is far enough out *in time* — long enough for the
take-off roll plus forty seconds of margin, measured off the arrival's actual ground speed, so an
arrival still carrying speed holds the runway from further out. Underneath that there is a 3.5 NM
floor, a
minute after every landing, and 90 seconds between departures. In practice a departure needs about
6 NM between two arrivals to get out, and more behind a fast one — so a tight sequence quietly
starves them and a gap lets one go.

And if the tower gets it wrong anyway, **your arrival goes around**: anything inside 0.3 NM of a
runway that still has something on it climbs away, whatever was decided a minute earlier. That
includes the aircraft you landed a moment ago — the runway is not free for a minute after a
touchdown, so a sequence flown tighter than that is a go-around, not a landing.

**They queue.** A departure that cannot roll does not disappear — it waits at the holding point, and
the next one lines up behind it. `DEP QUEUE` in the stats gutter is how many are stacked up there.
It goes **amber above three** and **red above six**, and that is the only feedback you get on the
half of the runway you are not looking at. Nothing scores it, but a queue that climbs all session is
an arrival sequence that has taken the runway over.

## Reading the scope

A data block is two lines:

```
AFR731 BELGA          ← callsign, then the fix it is tracking to
65 ↓30  267M          ← altitude in hundreds, arrow to the assigned level, ground speed, wake class
```

The tag after the callsign is the fix while the aircraft is on its arrival, then:

| Tag | Meaning |
| --- | --- |
| `ILS` | Cleared for the approach, flying the intercept |
| `LOC` | Established on the localizer |
| `G/S` | Descending on the glideslope |
| `→FIX` | Rejoining the arrival: flying a heading to intercept the leg ending at that fix |
| `HOLD` | In the published hold at that fix |
| `H̶O̶L̶D̶` | Same, struck through: you've told it to leave, and it will at the next crossing of the fix |
| `G/A` | Going around |
| `TWR` | Handed to Tower — still flying, no longer taking your instructions |

`=30` instead of `↓30` means the aircraft is level at its assignment. The speed is *ground* speed:
what the radar measures, and what your spacing actually runs on. The assigned IAS is in the sidebar.

Behind each blip is a history trail — one dot every 10 seconds, ten dots, so 100 seconds of past
track. That's deliberately longer than the leader line projects forward, so a turn that began before
your last instruction is still visible.

Only *your* traffic has one. Departures and aircraft already handed to Tower are drawn without
trails: you read a trail on the way to giving an instruction, and there is no instruction to give
either of them.

## The airspace

You are working **ZZZZ, runway 18** — the field the simulator ships with. `?airport=` in the URL
picks a field; there is only one so far, and an unrecognised name falls back to it and says so in the
log.

Four gates, 90° apart and offset 40° from the cardinals, so nothing arrives already lined up with
the final approach course. One STAR from each:

| Gate | Bearing | Handover | Route ends |
| --- | --- | --- | --- |
| KOVAL | 040° | 11,000 ft | Level 3,000 ft, 2 NM east of the centerline at 16 NM final |
| VANDA | 320° | 11,000 ft | Level 3,000 ft, 2 NM west of the centerline at 16 NM final |
| TEMBA | 130° | 13,000 ft | Downwind descending 7,000 → 3,000, 6 NM east, ending 11 NM north of the field |
| RIMOL | 230° | 13,000 ft | Downwind descending 7,000 → 3,000, 6 NM west, ending 11 NM north of the field |

**KOVAL and VANDA** sit north of the field, the same side as the final approach course, so their
arrivals reach the localizer with far fewer track miles to lose the height in — which is why Center
hands them over 2,000 ft lower. Both run inbound to a corner fix abeam the field, then a level leg
at 3,000 ft that stops 2 NM short of the extended centerline, pointing at each other. Turn one onto
final; the other has to wait.

**TEMBA and RIMOL** run straight in until they cross 8 NM abeam the centerline, then turn north onto
a parallel downwind. Turn base when the gap in the sequence is there, and lose the height on the way
round.

Every route holds 250 kt to its first fix, comes back to 230 at the corner, and publishes its own
platform speed at the last one, so the speed comes off over the middle legs rather than from the
moment of handover.

No two routes cross, so the published tracks are always safe — and never sufficient. Reach the last
fix without a vector and the aircraft calls *"request further"*, flies straight ahead, and eventually
leaves your airspace, which the stats panel counts against you.

## Instructions take time

Every command is *transmitted*. The crew reads it back and flies it 1–3 seconds later. The scope
shows the value you assigned immediately, so the delay reads as a visible gap rather than as input
lag: after a turn, a dashed amber vector shows the assigned heading for five seconds alongside the
solid green leader line, and the angle between them is the turn still to come.

Consequences worth knowing:

- Increments compute from the *pending* value, not the live one, so rapid keypresses accumulate
  properly instead of collapsing.
- One outstanding instruction per kind. Re-issuing replaces it and restarts the timer.
- Refusals are immediate — that's the controller's own check, not the crew's. Readbacks are delayed.

### Descending and slowing compete

Each aircraft has one energy budget. Spend it going down and you keep your speed; spend it slowing
and you stay high. Ask for both and each takes roughly twice as long as it would alone. Heavies get
a smaller budget and are correspondingly harder to fix late.

This is the core mechanic, not a detail. Plan the descent early enough that the deceleration still
fits.

### What a heading costs you

A **heading** takes an aircraft off its route permanently — from then on it's flying vectors, and
everything is your problem. An **altitude** or a **speed** overrides only that part of the published
profile and leaves it tracking the STAR. That's how "descend 5,000" works without also costing you
the lateral picture.

### Speed limits

250 kt maximum. The floor is 180 kt while the aircraft is clean, dropping to 160 kt within 20 track
miles of the runway, where it can configure. Ask for less than that and the crew declines and tells
you why. Inside 5 NM the aircraft flies its own approach speed regardless of what you assigned.

## Getting an aircraft onto the ILS

1. **Vector it to intercept.** Aim for about 30° to the final approach course. 45° is the hard limit.
2. **Get it below the glideslope.** The slope is 318 ft per NM from the threshold — 4,882 ft at
   15 NM, 3,180 ft at 10 NM, 1,590 ft at 5 NM. The published platforms already sit under it; keep
   them that way.
3. **Level it off.** Less than 200 fpm — needed to capture the *glideslope*, not the localizer, so
   there is time.
4. **Slow it down.** Under 230 kt at the intercept.
5. **Press `C`.**

### The clearance is checked three times

**When you press `C`,** only the things that make a clearance *meaningless* refuse it, and the
refusal names the condition:

| Refusal | Meaning |
| --- | --- |
| `pastThreshold` | Behind the runway. Vector back around. |
| `belowMva` | Below the 2,000 ft minimum vectoring altitude. |

That is all. Range, closing, angle, level and speed describe where the aircraft is *now*, and a
clearance is about where it will be at the localizer — so you can clear one 40 NM out, still
descending, still perpendicular, or diverging from a final it has just overshot. Clear it and turn
it back in the same breath, then go and deal with something else.

Poor technique is *accepted*, with a warning logged: above the glideslope, fast inside 15 NM, a
rushed intercept inside 6 NM. A clearance is a prediction, and you're allowed to make one that
hasn't come true yet.

**When the aircraft actually reaches the localizer** — inside 25 NM, crossing the centerline on a
closing track — the prediction is tested: intercept angle ≤ 45° and speed at or under 230 kt. Fail
either and the aircraft flies straight through the centerline, the clearance is cancelled, and the
stats panel records which test failed. Until it gets there nothing is tested: an aircraft outside
25 NM or still tracking away is not intercepting, so it can cross the centerline freely and keeps
its clearance.

**When the glideslope descends through it,** the second intercept is tested on its own terms: on
the localizer, inside 25 NM, under 230 kt, level within 200 fpm, and at or just below the path.
Missing this one is cheap — the clearance survives, and an aircraft that flew through the path
descending levels off underneath it and captures further in. Only one that never gets level under
the path goes around at 5 NM.

The sidebar previews all of this live for the selected aircraft — range, cross-track, the glideslope
altitude at its present position, the intercept angle it would fly, and whether `C` would be
accepted right now.

## Separation

Radar minimum is **3 NM horizontally or 1,000 ft vertically**. Conflicts are predicted 90 seconds
ahead: an amber ring for the warning, red for an actual violation, with the pair and the exact gap
in the message log. The stats panel counts both the violations and the seconds spent inside them.

On final there is a second, larger number. The runway has to be vacated before the next aircraft
lands, so the in-trail minimum is **4 NM at 10 NM and beyond** — built where there is still room to
build it. Inside 10 NM the sequence is what it is and the ordinary 3 NM applies again.

The sidebar's **In trail** row shows the gap to the aircraft ahead and the minimum currently in
force. An aircraft that isn't properly spaced stays on your frequency instead of being transferred
to Tower.

## Go-arounds

Inside 5 NM the approach has to be stable. Any of these and the aircraft goes around, climbs to
3,000 ft, and comes back to you to be re-sequenced:

- More than 1,000 ft above the glideslope
- More than 45 kt above its approach speed
- Less than 2.5 NM behind the aircraft ahead

And one that has nothing to do with how the approach was flown: **inside 0.3 NM with something
still on the runway** — a departure rolling, or a landing inside the minute it takes to vacate.

A go-around isn't a game-over — it's the sim telling you the sequence broke two minutes ago.

## Holding

`H` puts an aircraft into a published right-hand hold at the fix it is tracking to: 230 kt,
one-minute legs. It has to be on its arrival — off the route there's no fix to hold at.

Press `H` again to take it out. Before it has ever reached the fix that cancels outright; afterwards
it finishes the loop it is on and leaves at the next crossing, and the block's `HOLD` tag is struck
through in the meantime so you can see which of your holding aircraft are on their way out.

Changed your mind? `H` again while it is struck through takes the exit back and the aircraft keeps
going round — it never left, so there is nothing to re-enter. Only once it has actually left the
pattern does `H` start a fresh hold.

The hold *suspends* the STAR rather than ending it, so leaving it resumes the route from the same
fix. If the pattern left the aircraft above the published descent profile, it flies back down to it
on ordinary rates rather than teleporting onto it. You can't clear an aircraft for the approach
while it's in the pattern; take it out first.

Use it when the sequence has gotten away from you and you need one aircraft to stop making the
problem worse.

## Getting one back on its arrival

Vector one of two converging arrivals away to break them up, and you now have an aircraft on your
hands for the rest of its approach. `R` gives it its route back.

Turn it so it points across the arrival, press `R`, and it holds that heading until it reaches a leg
and joins it — the same intercept the localizer gets, and 45° is the steepest crossing it will take.
The leg it joins is **the first one the heading vector crosses**, so what it will do is on the scope
in front of you: draw the heading out and see where it meets the route. Aim across the arc and it
joins further down and cuts the fixes between out, which is how you buy back some of the miles the
vector cost. The block reads `→ARDIS` while it is joining and plain `ARDIS` once it is on.

If the heading reaches nothing, or crosses too steeply to turn onto, you hear so at once with the
number in it — turn first, then press `R`. `R` again while it is joining cancels. Once it has been
cleared for the approach the arrival is over and `R` is refused: vector it off first.

From the moment the crew reads `R` back the aircraft is flying the arrival's published descent and
speeds again, not diving to the next fix's level — so it arrives at the leg already on profile and
looks like every other aircraft on that arrival.

It also works on an aircraft still on its route. Give one an altitude or a speed and the chart's
version of that axis is off; `R` hands it back, and the aircraft carries on down the published
profile from wherever it is. If it is *under* the profile it stays where it is and waits for the
descent to come down to it rather than climbing back up.

**They stack.** The four fixes closest to the gates — OKPUR, NIVEL, SUDIX, TAVIR — are where a
sequence backs up, so Center delivers each new arrival 1,000 ft above the highest aircraft already
holding at that fix. Hold three at NIVEL on 8,000, 9,000 and 10,000 and the next one off KOVAL
arrives at 11,000, already clear of them — and holding *that* one keeps it at 11,000 rather than
dropping it onto the published crossing. Fill the stack to the ceiling and that gate goes quiet
until it drains — which is the sim telling you the arrivals have nowhere left to go.

## Scoring

The gutter on the right keeps a running account:

| Row | What it means |
| --- | --- |
| `ON FINAL` | Aircraft currently established on the localizer or glideslope |
| `LANDINGS` | Completed landings |
| `RATE` | Landings per hour over the last 10 minutes of sim time |
| `DEPARTURES` | Departures that got airborne and away on their SID |
| `DEP RATE` | Departures off the runway per hour, over the same 10 minutes. Compare it with the `DEP` figure in the status line: the gap is what your final approach is costing them |
| `DEP QUEUE` | How many are holding short waiting for the runway right now. Amber above 3, red above 6 |
| `HANDED OFF` | Transferred to Tower |
| `VIOLATIONS` | Separation losses, and the total seconds spent inside one |
| `GO-AROUNDS` | Approaches that broke off inside 5 NM |
| `EXITS` | Aircraft that left your airspace |
| `TRACK MILES` | Route flown ÷ straight-line distance. 1.00× is theoretically perfect. |
| `REFUSED ILS` | Refused clearances, by reason |
| `MISSED INT` | Aircraft that flew through the localizer, by which test failed |

There is no win condition. There's a landing rate, and there's how honestly you got it.

## Area control (`?airport=VABBS`)

Everything above is Approach. **Area** is the position before it: you take Mumbai's inbounds at
cruise, 160 NM out, and hand them to Approach at the edge of the terminal area — sequenced, at the
right level, at the right speed, and **properly spaced**. You never see a runway and you never clear
anyone for an approach. The panel says `AREA RADAR` so you know which job you are doing.

The sector is a **wedge**, not a circle: from 50 to 160 NM, covering the southern half — 125° round
through south to 285°. That is roughly what one en-route controller owns.

**Eight ways in, two ways out.** Six published transitions funnel onto **KETOR** and two onto
**MOLGO**, which is the whole problem in one sentence: traffic arrives from eight directions between
FL280 and FL370 and has to leave down two streams in an orderly queue.

| Way out | Fed by | Approach wants | Which is every |
| --- | --- | --- | --- |
| **RCKT**, 10 NM past KETOR | BISET, DARMI, ERVIS, GUNDI, KABSO, SUGID | 8 an hour, at 15,000 / 260 kt | 7½ minutes |
| **RCMG**, 10 NM past MOLGO | AGELA, EPKOS | 15 an hour, at 14,000 / 260 kt | 4 minutes |

Those two rates are the score, and they are satisfied **separately** — flooding one while starving
the other is breaking both agreements, not averaging them. The stats gutter reads achieved against
agreed (`13/15`) for each.

### Reading the two panels

The gutter, top right, is the **scoreboard** — how the session is going:

```
DELIVERED            12     how many you have handed on
RCMG /h           13/15     achieved rate / agreed rate, for that gate
RCKT /h             9/8     amber: this stream is running fast
TOO CLOSE             3     deliveries inside the agreed interval
UNSEQUENCED           0     handed on still being vectored
OFF CROSSING          1     more than 200 ft or 10 kt off
```

`RCMG /h  13/15` therefore reads: *"you are delivering 13 an hour into RCMG, and Approach asked for
15."* Two numbers, achieved against agreed. Under is fine — it means a gap, which wastes capacity but
endangers nobody. **Over is the one that costs you**, and it goes amber.

The left panel is the **worklist** — what to do about the aircraft you have selected:

```
Route          KETOR2A/DARMI    which of the eight ways in it came down
Range           92.3 NM to run  to the delivery fix, not to the runway
Deliver to               RCKT   which stream it belongs to
Wanted every       7:30 (8/h)   the agreed interval — this is your spacing target
Arrives in            13:17     when it gets there if you do nothing
Sequence         lose 11:27     what you have to fix
```

Each gate also carries a **countdown** on the scope — `4:10` above RCMG — which is how long before
that stream will take another arrival without breaking its agreement. Amber while it is closed,
green at `0:00`. It is the one label on the scope that is about a *place* rather than an aircraft:
the data blocks say what each aircraft owes, and this says what the gate is ready for, so deciding
which of two to send first is one glance rather than two subtractions. A gate that has taken nothing
yet shows no clock — an empty stream will take anyone.

**`Wanted every` is the answer to "how much spacing?"** — you do not have to work it out from the
rate. RCKT wants one every 7:30; RCMG one every 4:00. `Sequence` then tells you where this aircraft
sits against that: `lose 11:27`, `in the slot`, `3:20 in hand`, or `not yet sequenced` while it is
still outside 120 NM.

### The deficit: `L2` and `G3`

The second line of a data block may end in **`L2`** — this aircraft is two minutes too early for its
slot and you have to lose two minutes — or **`G3`**, meaning three minutes of slack. It appears once
the aircraft is inside **120 NM**, at which point its place in the queue is fixed and the time is
yours to find.

The scope tells you the deficit and never what to do about it. You have three instruments and they
are very different:

| Tool | What it buys | The catch |
| --- | --- | --- |
| **Speed** (`Q`/`E`) | ~1 NM per minute for every 60 kt of difference | Free, but slow — issue it early or it does nothing. **250 kt is the floor** up here |
| **Vectors** (`A`/`D`) | 2 NM of track for every 1 NM off course, immediately | Takes the aircraft off its arrival, and an aircraft delivered on a vector is a fault |
| **Hold** (`H`) | About **4 minutes a circuit** | All or nothing. You cannot buy ninety seconds this way |

The assignable band is **250 to 320 kt**, not the 180–250 of an approach field. Both ends matter:
the ceiling is what lets you give an aircraft back the 280 it arrived on, and the floor is there
because 180 kt at FL300 is not a speed a jet has — the approach minima exist to stop an arrival
being slowed before it can take flap, and nothing in this sector is configuring to land. So speed
buys you 30 kt of reduction off the cruise, and no more. Past that it is track miles or the hold.

`R` still means "resume the arrival", and it is what you use after every vector — it hands the
published profile back and, if the aircraft is off course, flies it back onto the first leg your
assigned heading crosses. That may be a *different* transition than the one it came in on, which is
usually the right answer if you have vectored it nearer someone else's track.

### What counts as a bad delivery

- **Too close** — inside the agreed interval behind the last one. This is the one that matters; it
  is what overwhelms the controller you are handing to.
- **Unsequenced** — still on a vector at the gate, or it wandered into the terminal area off-route.
- **Off crossing** — more than 200 ft or 10 kt off what the arrival publishes there.

Being *late* is not a fault. It wastes capacity, and the achieved rate will say so.

Left completely alone, the autopilot breaks the spacing agreement on about **46%** of arrivals. That
is the baseline you are playing against.

### Your first ten minutes

1. **Turn the flow down** — `Arr −` to 10/h — until the rhythm makes sense. Put it back up later.
2. **Press `Tab`** and read the panel. `Deliver to` says which of the two queues this aircraft is
   in; `Wanted every` says the spacing that queue needs; `Sequence` says whether it is a problem.
3. **Sort the ones that say `lose`, and ignore the rest.** An aircraft `in the slot` needs nothing
   from you. Most of them are.
4. **Reach for speed first.** `Q` takes 10 kt off. Sixty knots of difference opens about a mile a
   minute, so 20 kt off an aircraft 40 minutes out is worth several minutes by the time it gets
   there — and it costs nothing. This is why the deficit is shown at 120 NM and not at 60: early is
   the only time speed works.
5. **Vector when speed will not be enough.** `A`/`D` turn it 10° at a time; every mile off course
   costs two miles of track. Then press **`R`** to put it back on the arrival — an aircraft still on
   a vector when it reaches the fix is scored `UNSEQUENCED`, which is worse than being early.
6. **Hold when you need minutes, not seconds.** `H` at KETOR or MOLGO buys about four minutes a
   circuit. It is the only tool that works in whole minutes, and it is why the two gates sit ten
   miles *inside* your boundary — so there is somewhere to put an aircraft that cannot be fixed any
   other way.

The levels tell you how much room each one has. The gate labels run **280 at DARMI up to 370 at
KABSO**, in order of how far that route has to run — so a high number on the boundary is an aircraft
with a long way to go, and a low one is nearly there.

---

## Watching it back

Your session is being recorded the whole time — the last **60 minutes of sim time**, so an hour at
4× is still an hour of flying rather than fifteen minutes of it. **Stop session & watch replay**,
bottom right of the scope, ends the session and plays it back from the beginning.

| Control | Action |
| --- | --- |
| Scrub bar | Drag anywhere in the recording |
| `−10s` / `+10s` | Or the left / right arrow keys |
| `0.5×` … `16×` | Playback rate, or the number keys as live. `0.5×` is worth it for the ten seconds a sequence falls apart |
| `⏸` / `▶` | Or `Space`. At the end the button becomes `↻` and starts over |
| `New session` | Throw the recording away and fly a fresh field |

The replay is the same scope with the controls taken off it. Aircraft still carry their data blocks,
assigned altitudes, history dots, alert colours and stats, and the message log replays at the times
things were said — but the leader line and the dashed assigned-heading vector are gone, because both
of them exist to show an instruction you are in the middle of giving.

What you get instead: **click an aircraft to see its whole path** — one line through the whole
flight, a shade dimmer ahead of where you are watching. That is the one thing the live scope cannot show you,
and it is usually where the answer is. A sequence that felt tight normally turns out to be a turn
given fifteen seconds late, and the path is the shape of those fifteen seconds.

Nothing is saved. A refresh loses the recording.
