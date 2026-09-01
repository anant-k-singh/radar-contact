/**
 * The layering rules, as tests.
 *
 * These are the only thing that stops the decoupling growing back. Every one of
 * them was violated before this refactor, and each violation was invisible —
 * nothing failed, the code just quietly knew which airport it was flying.
 */
import { describe, expect, it } from 'vitest';

/**
 * Every source file, read at build time. `import.meta.glob` rather than the
 * filesystem, so this needs no node typings and no dependency of its own.
 */
const SOURCES: Record<string, string> = import.meta.glob('../src/**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** Repo-relative paths under `dir`, e.g. `src/sim`. */
function filesUnder(dir: string): string[] {
  const prefix = `../${dir}/`;
  return Object.keys(SOURCES)
    .filter((path) => path.startsWith(prefix))
    .map((path) => path.slice('../'.length));
}

/** Every `from '…'` in a file, paired with whether it was a type-only import. */
function imports(path: string): { from: string; typeOnly: boolean }[] {
  const source = SOURCES[`../${path}`] ?? '';
  const out: { from: string; typeOnly: boolean }[] = [];
  const pattern = /import\s+(type\s+)?([\s\S]*?)\s*from\s*'([^']+)'/g;
  for (const match of source.matchAll(pattern)) {
    const clause: string = match[2] ?? '';
    // `import { type A, type B }` is type-only too, just spelled per-specifier.
    const everySpecifierTyped =
      clause.trim().startsWith('{') &&
      clause
        .replace(/[{}]/g, '')
        .split(',')
        .filter((part) => part.trim())
        .every((part) => part.trim().startsWith('type '));
    out.push({ from: match[3]!, typeOnly: Boolean(match[1]) || everySpecifierTyped });
  }
  return out;
}

describe('layering', () => {
  // These rules are all of the form "no file does X", which passes just as
  // happily when there are no files. So check first that there are.
  it('is actually reading the source tree', () => {
    for (const dir of ['src/sim', 'src/render', 'src/scenario', 'src/replay', 'src/input']) {
      expect(filesUnder(dir).length, dir).toBeGreaterThan(2);
    }
    expect(imports('src/sim/world.ts').length).toBeGreaterThan(5);
    expect(imports('src/scenario/compile.ts').map((i) => i.from)).toContain('./airspace.js');
  });

  it('never lets the simulation reach into the renderer (§11.4)', () => {
    for (const path of filesUnder('src/sim')) {
      for (const { from } of imports(path)) {
        expect(from, path).not.toMatch(/render|input|app/);
      }
    }
  });

  it('never lets the data layer reach into the tunables layer', () => {
    // A scenario states facts about a field. The moment it can import
    // constants.ts, a number that is really a field's own — an entry altitude,
    // an airspace radius — has somewhere else to live, which is how they ended
    // up there in the first place.
    for (const path of filesUnder('src/scenario')) {
      for (const { from } of imports(path)) {
        if (!from.includes('/sim/')) continue;
        expect(from, `${path} may only import units from src/sim/`).toMatch(/\/sim\/units\.js$/);
      }
    }
  });

  it('never lets the simulation or the renderer name a field', () => {
    // The registry and the fields under it are the one place an airport is
    // chosen. Everything else is handed a Scenario — so a module that imports
    // either has, somewhere, stopped being able to fly a different airport.
    for (const dir of ['src/sim', 'src/render', 'src/replay', 'src/input']) {
      for (const path of filesUnder(dir)) {
        for (const { from } of imports(path)) {
          expect(from, path).not.toMatch(/scenario\/(registry|fields)/);
        }
      }
    }
  });

  it('keeps pilot.ts free of a runtime dependency on the world', () => {
    // A runtime import here is an import cycle: world.ts calls into pilot.ts.
    // The trap is real — pilot.ts needs the runway id for its readback, and the
    // obvious way to get one is off the world.
    const worldImports = imports('src/sim/pilot.ts').filter((i) => i.from.includes('world.js'));
    expect(worldImports.length).toBeGreaterThan(0);
    for (const entry of worldImports) expect(entry.typeOnly).toBe(true);
  });
});
