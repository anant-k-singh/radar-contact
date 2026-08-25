# Gameplay guide

You are the Approach controller at ZZZZ, a single-runway field landing on **runway 18**. Center
hands you arrivals at the edge of a 50 NM circle, already established on a published STAR. Your job
is to sequence them onto the ILS — correctly spaced, at or below the glideslope, slow enough to
configure — and hand each one to Tower once it is established.

Procedures follow standard radar-control practice. Every number below is derived and justified in
[REQUIREMENTS.md](REQUIREMENTS.md).

---

## Controls

| Key | Action |
| --- | --- |
| `A` / `D` | Heading −10° / +10° |
| `W` / `S` | Altitude +1,000 / −1,000 ft (2,000–12,000) |
| `Q` / `E` | Speed −10 / +10 kt |
| `C` | Clear for the ILS approach |
| `H` | Enter / leave the published hold |
| `Tab` | Cycle selection, nearest the runway first |
| `1` … `5` | Time rate — each key doubles the one before it: `1` real time, `3` is 4×, `5` is 16× |
| `Space` | Pause · `Esc` deselect |
| `←` / `→` | Skip 10 s back / forward — replay only (see below) |

Click a blip or its data block to select it. **Arr −/+** in the sidebar sets arrivals per hour
(5–50, default 25) — turn it down to learn the field, up when you want to be buried. **Dep −/+**
sets departures per hour (0–20, default 10); `off` gives you the arrivals-only field.

`?seed=1234` in the URL reproduces a session exactly, down to the pilot reaction times.

## The departures

Runway 18 departs as well as lands, and those aircraft are **not yours**. They belong to Departure
Control: they are drawn in the muted grey the scope uses for anything you cannot instruct, tagged
`DEP`, and they ignore you completely.

They fly one of three published SIDs, drawn on the scope in amber:

| SID | Where it goes | The restriction |
| --- | --- | --- |
| `SABAR1A` | Turns right, out to the west | At or below **4,000** until MORVA, then 13,000 |
| `KIROS1A` | Turns left, out to the east | At or below **4,000** until TELMU, then 13,000 |
| `RAMOX1A` | Straight ahead, out to the south | None — it just climbs |

The two turning departures cross the RIMOL and TEMBA downwinds, which is why they are held at 4,000:
underneath your arrivals, which are at 6,700 or so at that point. MORVA and TELMU sit two miles
*past* the crossing, not on it — a departure that started climbing the moment it was clear would be
back in your arrival's level before it was laterally clear of the route. Two miles is a minute or so
of level flight, and then it is climbing again. As published, the two never touch.

**But your arrivals are only where you left them.** Vector one south of the field and the departure
corridor is waiting there, at 4,000 climbing to 13,000 — and a bust against a departure counts
against you exactly like any other, because the arrival is the half you could have moved. The amber
lines on the scope are the thing to keep the base turn clear of.

You cannot help a departure and you cannot delay one. What you *do* control is the runway. A
departure is released only when the arrival ahead is far enough out *in time* — long enough for the
take-off roll plus a minute of margin, measured off the arrival's actual ground speed, so an arrival
still carrying speed holds the runway from further out. Underneath that there is a 4 NM floor, a
minute after every landing, and 90 seconds between departures. In practice a departure needs about
6.5 NM between two arrivals to get out, so a tight sequence quietly starves them and a gap lets one
go.

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
| `HOLD` | In the published hold at that fix |
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

Four gates, 90° apart and offset 40° from the cardinals, so nothing arrives already lined up with
the final approach course. One STAR from each:

| Gate | Bearing | Handover | Route ends |
| --- | --- | --- | --- |
| KOVAL | 040° | 9,000 ft | Level 3,000 ft, 2 NM east of the centerline at 16 NM final |
| VANDA | 320° | 9,000 ft | Level 3,000 ft, 2 NM west of the centerline at 16 NM final |
| TEMBA | 130° | 12,000 ft | Downwind descending 7,000 → 3,000, 6 NM east, ending 11 NM north of the field |
| RIMOL | 230° | 12,000 ft | Downwind descending 7,000 → 3,000, 6 NM west, ending 11 NM north of the field |

**KOVAL and VANDA** sit north of the field, the same side as the final approach course, so their
arrivals reach the localizer with far fewer track miles to lose the height in — which is why Center
hands them over 1,000 ft lower. Both run inbound to a corner fix abeam the field, then a level leg
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
3. **Level it off.** The intercept test wants less than 200 fpm at the moment the aircraft reaches
   the localizer.
4. **Slow it down.** Under 230 kt at the intercept.
5. **Press `C`.**

### The clearance is checked twice

**When you press `C`,** only the things that make a clearance *meaningless* refuse it, and the
refusal names the condition:

| Refusal | Meaning |
| --- | --- |
| `notClosing` | The track takes the aircraft away from the localizer. It will never get there. |
| `pastThreshold` | Behind the runway. Vector back around. |
| `outOfRange` | Beyond the 25 NM localizer service volume. |
| `belowMva` | Below the 2,000 ft minimum vectoring altitude. |

Poor technique is *accepted*, with a warning logged: above the glideslope, fast inside 15 NM, a
rushed intercept inside 6 NM. A clearance is a prediction, and you're allowed to make one that
hasn't come true yet.

**When the aircraft actually reaches the localizer,** the prediction is tested for real: intercept
angle ≤ 45°, vertical speed within 200 fpm, speed at or under 230 kt. Fail any one and the aircraft
flies straight through the centerline, and the stats panel records which test failed.

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

The hold *suspends* the STAR rather than ending it, so leaving it resumes the route from the same
fix. If the pattern left the aircraft above the published descent profile, it flies back down to it
on ordinary rates rather than teleporting onto it. You can't clear an aircraft for the approach
while it's in the pattern; take it out first.

Use it when the sequence has gotten away from you and you need one aircraft to stop making the
problem worse.

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
