# Icons

Two hand-maintained SVGs, because one mark cannot serve both sizes. **Edit both
together** — they share a palette and a subject, and a change to one alone makes
the favicon and the app icon disagree.

| File | Is | Drawn at |
| --- | --- | --- |
| `favicon.svg` | The reduced cut: ground, one ring, sweep, one aircraft, final approach | 16–64 px |
| `icon.svg` | The full cut: three range rings, cardinal cross, two aircraft being sequenced | 128 px and up |

The reduction is not decorative. At 32 px the full mark's inner rings collapse
into a grey wash and the two blips cannot be told apart, so the small cut drops
everything that does not survive and keeps the sweep, one blip and the runway —
the three things that say "radar" at a glance.

Colours come from `src/render/theme.ts`, so the icon and the scope it opens are
the same green.

## Regenerating the PNGs

The SVGs are the source; the PNGs are build products, committed only because
`apple-touch-icon` and the 32 px fallback need raster. macOS, no ImageMagick
required:

```sh
cd public
qlmanage -t -s 32   -o . favicon.svg && mv favicon.svg.png favicon-32.png
qlmanage -t -s 256  -o . icon.svg    && mv icon.svg.png apple-touch-icon.png
qlmanage -t -s 512  -o . icon.svg    && mv icon.svg.png icon-512.png
qlmanage -t -s 1024 -o . icon.svg    && mv icon.svg.png icon-1024.png
```

`icon-512.png` / `icon-1024.png` are not referenced by the page; they are the
sizes a store listing or a desktop wrapper asks for.
