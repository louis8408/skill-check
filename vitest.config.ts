import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Needs the Codex CLI installed; run on its own with `npm run test:codex`.
    exclude: ['tests/codex/**', '**/node_modules/**'],
    testTimeout: 20_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // cli.ts only wires the real process (stdin/stdout/argv/env) to run() in main.ts, which is
      // covered in-process. cli.ts itself runs as a child process in hook-end-to-end.test.ts,
      // which v8 coverage cannot see.
      exclude: ['src/presentation/cli.ts'],
      reporter: ['text', 'lcov'],
      // Every line and branch of src is tested; a drop fails `npm run coverage` (and CI).
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
      reportsDirectory: 'coverage',
    },
  },
});
