import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

/**
 * Tests cover the build logic only — levels, cycles, reachability, scoring and
 * query normalisation. That is the part where a silent mistake corrupts the
 * whole catalogue; the UI is checked by looking at it.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
