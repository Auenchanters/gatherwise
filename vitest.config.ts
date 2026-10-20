/** Coverage gates apply to all pure logic and server request paths. */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/domain/**', 'src/shared/**', 'server/**'],
      // Type-only modules compile to nothing, so there is nothing to cover.
      exclude: ['**/types.ts', '**/*.d.ts'],
      reporter: ['text', 'json-summary', 'html'],
      thresholds: { lines: 95, statements: 95, functions: 95, branches: 90 },
    },
  },
});
