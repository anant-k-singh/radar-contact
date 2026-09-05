/** Every colour and font in one place. */
export const THEME = {
  background: '#04070a',
  ring: '#123726',
  ringBright: '#1d5c3d',
  ringLabel: '#2f6b4c',
  compassTick: '#16402c',
  runway: '#d8e4dc',
  /**
   * A runway that is not in use: present on the field, not part of the job.
   *
   * Dimmer than the active strip but not by much — it is a line two miles long on
   * a sixty-mile scope, and taken far enough down it stopped reading as pavement
   * at all. The width is what says which one is in use.
   */
  runwayInactive: '#7e938a',
  /**
   * The coast. A cold light blue, the one thing on the scope that is neither
   * airspace nor aircraft — it is there to say where you are, so it reads at a
   * glance and then stops asking for attention.
   */
  coastline: '#3f7fa8',
  /**
   * The ends of the high-ground ramp: the lowest band's fill and the highest.
   *
   * Two colours rather than a list, because the number of steps is the *field's*
   * and not the theme's — see `terrainRamp`. Stated as the ends of a range so a
   * field with four bands and one with fourteen are the same design decision.
   *
   * A warm grey-brown, and deliberately *dark* — this is the bottom layer of the
   * scope and everything the player actually works with is drawn on top of it, so
   * the brightest band has to stay below `starPath` (luminance 70.6) or the chart
   * stops reading against the ground it crosses. That ceiling is what caps the
   * range, and therefore how many steps are distinguishable within it. The
   * published palette that comes with the contours is a hiking-map
   * green-to-yellow, right for a map read on its own and far too loud under a
   * radar display.
   *
   * The ramp is in brightness rather than in hue: terrain means one thing, and a
   * band that is higher is simply more of it.
   */
  terrainLow: '#0e1714',
  terrainHigh: '#375142',
  centerline: '#2f6fd0',
  centerlineTick: '#3f86e8',
  gate: '#2f7a58',
  gateLabel: '#3d8f68',
  starPath: '#2d4c5c',
  starFix: '#456a7d',
  starLabel: '#4f7c92',
  starConstraint: '#8a763f',

  /**
   * The SIDs, in a warm amber against the STARs' cool blue-grey. The two chart
   * layers cross, and the one question the player asks looking at them is which
   * traffic is theirs — so the departure routes are the other temperature
   * entirely rather than another shade of the same one.
   */
  sidPath: '#5c4a2a',
  sidFix: '#7d6b45',
  sidConstraint: '#b08a3c',
  /**
   * The hovered SID: its track, its fix rings and the figures the default chart
   * thins away. Brighter than `sidConstraint` because the whole point is that the
   * hovered route lifts off a layer drawn at `SID_ALPHA` to recede.
   */
  sidHover: '#e8c069',

  /** Data block and leader line: the cool near-white of a radar block. */
  traffic: '#cfdae6',
  trafficDim: '#5f7183',
  /** The blip itself is a shade bluer than its label, so the two read apart. */
  glyph: '#a6c8ea',
  /** A go-around blip, so it is spotted without reading the block. */
  glyphGoAround: '#f2e394',
  /**
   * The selection is a change of *hue*, not a step in brightness. White is the
   * same colour as `traffic` a little brighter, and at 11.5 px on this
   * background that difference does not survive being read across a crowd of
   * blocks. Cyan is the one bright hue the scope has left — the SIDs own amber
   * and the rings own green — so it never has to be told apart from something
   * else that means something.
   */
  selected: '#5fe3ff',
  /**
   * The selected *blip* stays white. The block is what had to be picked out of
   * a crowd of blocks, and the glyph is already the one inside the ring — a
   * cyan blip would only weaken the one place the hue has to mean "read this".
   */
  selectedGlyph: '#ffffff',
  handedOff: '#5d6f63',
  assigned: '#ffe14d',
  hint: '#f6eba6',
  /**
   * The two alert levels are a hue apart, not a step in brightness. Red means
   * separation is *gone*, and nothing else on the scope is allowed to spend it:
   * a warning is a few seconds of notice, so it takes amber. The violation also
   * gets a ring drawn round it, so the step up reads without comparing hues.
   */
  warning: '#ffcc44',
  violation: '#ff2b2b',

  /**
   * The selected aircraft's whole path in replay. Both halves have to sit
   * clearly above `starPath`, which the track spends most of its length lying
   * exactly on top of: a path the same brightness as the chart underneath it is
   * invisible for the whole part of the flight that was flown as published.
   * What is still to come is one step down, enough to read the direction of
   * travel without disappearing into the chart.
   */
  pathFlown: '#7fc4ff',
  pathRemaining: '#4b7fa8',

  logPilot: '#74e874',
  logSystem: '#9fb4a8',
  logAlert: '#ffb020',

  /**
   * Data blocks are the one place that is not monospaced. A proportional UI
   * sans is what the reference looks like, and at two lines there is no longer
   * a column of figures to keep aligned — the weight comes off with it, since
   * 600 on a small block reads as shouting.
   */
  fontBlock: '400 11.5px -apple-system, "SF Pro Text", "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  fontSmall: '11px "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace',
  fontLabel: '10px "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace',
  fontLog: '12px "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace',
} as const;

/**
 * The terrain ramp for a field with `bands` bands, darkest first.
 *
 * Stretched to fit rather than fixed, so every field uses the whole usable
 * contrast range whatever its band count. The alternative — one shade meaning one
 * altitude everywhere — was considered and rejected: it would have left VABB's
 * four bands crowded into the bottom of a scale built for Geneva's fourteen, and
 * a field's terrain has to read against *itself* first. The cost is that a shade
 * cannot be read as an altitude on its own, which is what `MSA @ pointer` is for.
 *
 * Interpolated in sRGB and **shaped**, not linear. A constant step in sRGB is not
 * a constant *apparent* step near black: the linear ramp gave the bottom three
 * bands 3.8–4.4 units of luminance each, which at those levels was not readable,
 * while the top of the ramp had steps to spare. `TERRAIN_RAMP_GAMMA` under 1
 * front-loads the range, taking the first three steps to 5.5/5.4/4.7 and costing
 * the crowded upper bands about a tenth of a unit each.
 *
 * The range itself is as wide as it can usefully be, and both ends are pinned by
 * something real. The top is `starPath`: VABB draws arrival routes *directly
 * over* its two brightest bands, 0.0 and 0.1 NM away, so a brighter top costs
 * those lines their contrast. The bottom is the background — the lowest band has
 * only the background to read against, since it has no darker neighbour, and at
 * 1.9× it stopped being visible at all. 2.2× is where it reads, and taking it
 * lower to buy wider steps was a trade in the wrong direction.
 *
 * So the range is fixed and the shaping is the only free variable, which is what
 * `TERRAIN_RAMP_GAMMA` is for.
 *
 * The step shrinks as bands are added, and at some count it stops being legible:
 * fourteen bands over this range give about 4 units of luminance each, which is
 * near the limit for irregular patches on a dark ground. That is a bound on how
 * finely a field may usefully band its terrain, not something this can fix — the
 * ceiling is `starPath`, and lifting it costs the STAR lines their contrast.
 */
/**
 * Shapes the ramp so the dark end gets wider steps than the bright end.
 *
 * Below 1 because a fixed sRGB step is worth less near black — the bands that
 * needed help were 4000/5000/6000, the darkest three. Far below 1 and the top
 * bands crowd instead, which at fourteen bands they cannot afford: past 0.85 the
 * minimum step falls under 3 units and the bright end goes flat, which is the
 * same complaint at the other end of the ramp. 0.85 is the last value where both
 * ends hold, and `tests/terrain.test.ts` asserts each of them.
 */
const TERRAIN_RAMP_GAMMA = 0.85;

export function terrainRamp(bands: number): string[] {
  if (bands <= 0) return [];
  if (bands === 1) return [THEME.terrainLow];
  const lo = rgb(THEME.terrainLow);
  const hi = rgb(THEME.terrainHigh);
  return Array.from({ length: bands }, (_, i) => {
    const t = Math.pow(i / (bands - 1), TERRAIN_RAMP_GAMMA);
    return hex(lo.map((c, k) => c + (hi[k]! - c) * t));
  });
}

const rgb = (color: string): number[] => [
  parseInt(color.slice(1, 3), 16),
  parseInt(color.slice(3, 5), 16),
  parseInt(color.slice(5, 7), 16),
];

const hex = (channels: number[]): string =>
  `#${channels.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
