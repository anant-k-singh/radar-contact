import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base so a static build works from any subpath (e.g. GitHub Pages).
  base: './',
  build: { target: 'es2022' },
  plugins: [
    // Keep the AGPL notice in the shipped bundle. The minifier strips source
    // comments and `output.banner` is not honoured by this Vite/Rolldown, so
    // prepend it here: the hosted copy is the one most people receive, and
    // §13 obligations attach to network use.
    {
      name: 'agpl-banner',
      apply: 'build',
      generateBundle(_options, bundle) {
        const notice =
          '/*! @license AGPL-3.0-or-later\n' +
          ' * Approach Radar — Copyright (C) 2026 Anant Kumar Singh\n' +
          ' * Source: https://github.com/anant-k-singh/radar-contact\n' +
          ' * Running a modified version for users over a network obliges you to\n' +
          ' * offer them its complete corresponding source (AGPL §13).\n' +
          ' */\n';
        for (const chunk of Object.values(bundle)) {
          if (chunk.type === 'chunk' && chunk.isEntry) chunk.code = notice + chunk.code;
        }
      },
    },
  ],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
