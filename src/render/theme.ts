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
   * High ground, one fill per 1000 ft band, low to high.
   *
   * A warm grey-brown ramp, and deliberately *dark* — this is the bottom layer of
   * the scope and everything the player actually works with is drawn on top of it,
   * so the brightest band has to stay below `starPath` or the chart stops reading
   * against the ground it crosses. The published palette that comes with the
   * contours is a hiking-map green-to-yellow, which is right for a map read on its
   * own and far too loud under a radar display.
   *
   * The ramp is in brightness rather than in hue: terrain means one thing, and a
   * band that is higher is simply more of it. The steps are even so the escarpment
   * reads as a slope rather than as an edge.
   */
  terrain: ['#0e1714', '#1b2a23', '#283d33', '#375142'],
  /**
   * The band labels. Brighter than any of the fills, because they now sit outside
   * the airspace on bare background rather than on the band they describe.
   */
  terrainLabel: '#6d8474',
  /**
   * The leader line from a band to its figure. Dimmer than the label: the line's
   * job is to say which area is meant and then get out of the way, and it crosses
   * the boundary and the outer range ring on its way out.
   */
  terrainCallout: '#3d5145',
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
