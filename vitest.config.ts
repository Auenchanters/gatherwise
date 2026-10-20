/** Coverage gates apply to all pure logic and server request paths. */
import { coverageConfigDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    // A zone with daylight saving, so domain code that quietly used local time would fail a test
    // instead of passing on a UTC CI runner. Dates must be zone-free; see tests/unit/dates.test.ts.
    env: { TZ: 'America/New_York' },
    coverage: {
      provider: 'v8',
      include: ['src/domain/**', 'src/shared/**', 'server/**'],
      // Ambient declarations compile to nothing, so there is nothing to cover.
      exclude: [...coverageConfigDefaults.exclude, '**/*.d.ts'],
      reporter: ['text', 'json-summary', 'html'],
      thresholds: { lines: 95, statements: 95, functions: 95, branches: 90 },
    },
  },
});
