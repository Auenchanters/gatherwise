/**
 * Two test projects: pure logic and the server run in Node (tests/unit), React components run in
 * jsdom (tests/ui). Coverage gates apply to all pure logic, the server request paths and every
 * component (`.tsx`) except the `main.tsx` bootstrap, which only mounts `App` on the page's root.
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
          // Rendering a whole plan and driving it with user-event takes seconds on a slow runner.
          testTimeout: 20_000,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: [
        'src/domain/**',
        'src/shared/**',
        'src/features/**/*.ts',
        'src/**/*.tsx',
        'server/**',
      ],
      exclude: [
        ...coverageConfigDefaults.exclude,
        // Ambient declarations compile to nothing, so there is nothing to cover.
        '**/*.d.ts',
        // The bootstrap: it reads #root and mounts `App`, and would need a real page to run.
        'src/main.tsx',
      ],
      reporter: ['text', 'json-summary', 'html'],
      thresholds: { lines: 95, statements: 95, functions: 95, branches: 90 },
    },
  },
});
