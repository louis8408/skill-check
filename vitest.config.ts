import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 20_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // cli.ts is the process entry point (stdin/stdout/argv). It is exercised as a real
      // child process by tests/integration/hook-end-to-end.test.ts, which v8 cannot instrument.
      exclude: ['src/presentation/cli.ts'],
      reporter: ['text', 'lcov'],
      reportsDirectory: 'coverage',
    },
  },
});
