/** Every colour and font in one place. */
export const THEME = {
  background: '#04070a',
  ring: '#123726',
  ringBright: '#1d5c3d',
  ringLabel: '#2f6b4c',
  compassTick: '#16402c',
  runway: '#d8e4dc',
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
  sidLabel: '#94804f',
  sidConstraint: '#b08a3c',

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
