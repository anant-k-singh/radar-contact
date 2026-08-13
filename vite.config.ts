import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base so a static build works from any subpath (e.g. GitHub Pages).
  base: './',
  build: { target: 'es2022' },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
