/**
 * Two test projects: pure logic and the server run in Node (tests/unit), React components run in
 * jsdom (tests/ui). Coverage gates apply to all pure logic and server request paths; UI `.tsx` is
 * tested but not measured.
 */
import { coverageConfigDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // A zone with daylight saving, so domain code that quietly used local time would fail a test
    // instead of passing on a UTC CI runner. Dates must be zone-free; see tests/unit/dates.test.ts.
    env: { TZ: 'America/New_York' },
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['tests/unit/**/*.test.ts'], environment: 'node' },
      },
      {
        extends: true,
        test: {
          name: 'ui',
          include: ['tests/ui/**/*.test.tsx'],
          environment: 'jsdom',
          setupFiles: ['tests/ui/setup.ts'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/domain/**', 'src/shared/**', 'src/features/**/*.ts', 'server/**'],
      // Ambient declarations compile to nothing, so there is nothing to cover.
      exclude: [...coverageConfigDefaults.exclude, '**/*.d.ts'],
      reporter: ['text', 'json-summary', 'html'],
      thresholds: { lines: 95, statements: 95, functions: 95, branches: 90 },
    },
  },
});
