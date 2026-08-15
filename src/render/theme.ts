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

  /** Data block and leader line: the cool near-white of an Infinite Flight block. */
  traffic: '#cfdae6',
  trafficDim: '#5f7183',
  /** The blip itself is a shade bluer than its label, so the two read apart. */
  glyph: '#a6c8ea',
  selected: '#ffffff',
  handedOff: '#5d6f63',
  assigned: '#ffe14d',
  hint: '#f6eba6',
  warning: '#ffb020',
  violation: '#ff4a4a',

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
