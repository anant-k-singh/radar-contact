# Approach Radar

A browser-based approach-control radar simulator. You are the Approach controller at a
single-runway airport: take arrivals from Center at the entry gates, vector and descend them onto
the ILS, keep them separated, and hand them to Tower once established.

Inspired by *Endless ATC*; the procedures follow the
[Infinite Flight ATC Manual](https://infiniteflight.com/guide/atc-manual/6.-radar/6.2-separation)
radar chapter.

```bash
nvm use && npm install
npm run dev      # http://localhost:5173
```

## Controls

| Key | Action |
| --- | --- |
| `A` / `D` | Heading −10° / +10° |
| `W` / `S` | Altitude +1000 / −1000 ft (2000–10,000) |
| `Q` / `E` | Speed −10 / +10 kt |
| `C` | Clear for the ILS approach |
| `Tab` | Cycle selection (nearest the runway first) |
| `Space` | Pause · `1` `2` `4` time rate · `Esc` deselect |

Click a blip or its data block to select it. Instructions are *targets* — the aircraft takes time
to get there, and descending while slowing takes about twice as long as either alone. After a turn
is assigned, a dashed yellow vector shows the target heading for five seconds alongside the green
leader line; the gap between them is the turn still to come.

Center hands arrivals over at the altitude printed under each gate marker — 7000 ft at KOVAL and
VANDA, which sit on the final approach side of the field, 8000 ft at TEMBA and RIMOL.

`C` is refused unless the aircraft is set up correctly, and the refusal says exactly what is wrong
("900 ft above the glideslope at 12.0 NM"). The sidebar previews that check live.

## What is where

- [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) — the full spec: rules, sources, numbers, decisions,
  and what is still open. Read this first.
- `src/sim/` — the simulation. Pure, headless, no DOM; this is what the tests cover.
- `src/render/` — Canvas 2D scope and the DOM sidebar.
- `src/scenario/` — airport, gates, aircraft types. Swap `airport.ts` to fly a different field.

```bash
npm test         # 54 tests over the flight model, ILS logic and separation rules
npm run build    # typecheck + static bundle (no backend, no runtime dependencies)
```
