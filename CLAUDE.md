# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
nvm use                       # REQUIRED — Node 24 (.nvmrc). The machine default is 18, on which
                              # vitest dies with "node:util does not provide an export named styleText"
npm run dev                   # http://localhost:5173
npm run check                 # tsc --noEmit
npm test                      # all tests (~0.7 s)
npm run build                 # typecheck + static bundle to dist/
npx vitest run tests/star.test.ts          # one file
npx vitest run -t "flying a STAR"          # one describe/it by name
```

`?seed=1234` in the URL reproduces a session exactly. In a dev build `window.atc` is the live
`World`; `window.atc.timeScale = 4` is the quickest way to fast-forward while watching.

## Architecture

Three layers with a one-way dependency rule: **`src/sim/` never imports `src/render/`.** The sim is
pure and headless — no DOM, no canvas — which is what makes it testable. `src/scenario/` is data
(airport, gates, STARs, aircraft types); swapping `airport.ts` + `stars.ts` flies a different field.

**One mutable `World`, advanced by `step(world, dt)`** ([src/sim/world.ts](src/sim/world.ts)).
`main.ts` runs a fixed 20 Hz timestep from a rAF loop and redraws at 20 fps; the 1 Hz radar sample
and 0.2 Hz history dots happen *inside* `step` against sim time, so they scale correctly with time
acceleration. Aircraft see the world only through `step`'s ordering:

```
applyDueInstructions → stepStar → stepApproach → stepKinematics → exit check → handoff
```

### Targets take time, and three things compete to set them

Nothing snaps. Commands assign `targetHeadingDeg` / `targetAltitudeFt` / `targetIasKts`, and
`stepKinematics` moves toward them at bounded rates. `planRates` in [dynamics.ts](src/sim/dynamics.ts)
makes descending and decelerating share one energy budget — that coupling is the core mechanic, not
an incidental detail.

Per tick, exactly one authority writes each target, decided by aircraft state:

| Authority | When | Owns |
| --- | --- | --- |
| `stepStar` ([star.ts](src/sim/star.ts)) | `ac.star !== null` | all three axes, minus any the controller has taken over (`altitudeManual` / `speedManual`) |
| `stepHold` ([hold.ts](src/sim/hold.ts)) | `ac.star.hold !== null` | delegated to by `stepStar`; owns the lateral track, and holds altitude/speed level |
| `stepApproach` ([ils.ts](src/sim/ils.ts)) | `phase` is `loc`/`gs`/`goAround` | heading + speed; the glideslope also owns altitude |
| `applyDueInstructions` ([pilot.ts](src/sim/pilot.ts)) | an instruction comes due | whatever was instructed |

**Two places write `ac.altitudeFt` directly** rather than via kinematics — the glideslope and the
STAR's published profile. Both are signalled by passing `controlVertical: false` to
`stepKinematics`, which then charges the imposed vertical rate against the energy budget instead of
generating one. If you add a third, follow that seam.

Writing the profile on assumes the aircraft is *already* on it. It isn't while rejoining from a hold
(`StarNav.rejoining`), so those ticks fall back to kinematics — which is why `starOwnsVertical` must
be read **after** `stepStar`, not before: entering or leaving a hold changes who owns the vertical
on the very tick it happens.

Holding is the one thing that suspends a STAR instead of ending it, so anything that ends a hold
must also undo what it borrowed: `leaveHold` restores `altitudeManual` (a holding level is not a
standing assignment) and clears `turnDirection`, and `leaveStar` clears both for the vector case.
Holds are the only user of `Aircraft.turnDirection`, which forces a turn direction because the
pattern's exact-180° reversals have no "short way" for `headingDelta` to find.

### Instructions are transmitted, not applied

[commands.ts](src/sim/commands.ts) validates (speed floor, ceiling, ILS clearance gate) and calls
`issue()`; the crew acts 1–3 s later. Consequences to preserve when touching this:

- Increments compute from `assignedHeadingDeg`/`assignedAltitudeFt`/`assignedIasKts` (the pending
  value), never from the live target — otherwise rapid keypresses collapse.
- One outstanding instruction per kind; re-issuing replaces it and restarts the timer.
- Renderers show the *assigned* value immediately so the delay reads as a gap, not lag.
- Refusals are immediate (the controller's own check); readbacks are deferred.

Adding an instruction kind means extending the `Instruction` union and the `apply()` switch.

### Sim modules return events; only `world.ts` logs

`stepApproach` and `stepStar` return event arrays, and `applyDueInstructions` returns `Readback[]`.
`world.ts` turns them into log lines. This keeps the message log out of the flight model — and it is
why **`pilot.ts` imports `World` as a type only**: a runtime import would create a cycle. Preserve
that.

## Conventions

- **Every tunable number lives in [constants.ts](src/sim/constants.ts)**, grouped by the section of
  the spec it comes from. Don't inline magic numbers.
- **[docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) is the spec**, with the derivation of each number
  and a decisions/assumptions register. Code comments cite its `§` numbers and Infinite Flight ATC
  Manual clauses (`IF 6.14.3`). Behaviour changes belong there too — including in §14/§15 when a
  decision or an open question changes.
- Units are carried in variable names (`altFt`, `distNm`, `iasKts`); the `Nm`/`Ft`/`Kts` aliases are
  documentation, not enforcement. All conversions live in [units.ts](src/sim/units.ts).
- Comments explain *why* a number or rule exists, not what the line does. Match that density.
- Randomness comes from seeded mulberry32 streams. `world.rng` drives traffic; `world.pilotRng`
  drives reaction times — kept separate so player input can't shift the traffic a seed generates.
- `mapLayer.ts` is cached offscreen and keyed by canvas size; static scope furniture (rings, gates,
  STAR charts) goes there, anything per-frame goes in `trafficLayer.ts`.

## Testing notes

- `makeAircraft()` in [tests/helpers.ts](tests/helpers.ts) builds through the real spawn path but
  sets `star = null`, since a route would fly the aircraft off whatever setup the test built. Use
  `createArrival()` directly to test STAR behaviour.
- `pilotActs(world)` skips the reaction delay without flying the aircraft anywhere; `run(world, s)`
  advances sim time properly.
- An aircraft placed at/near the 50 NM boundary tracking outbound is despawned by the airspace-exit
  check on the first step — position test aircraft inside the circle unless that is the subject.
