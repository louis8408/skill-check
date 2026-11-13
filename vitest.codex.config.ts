import { defineConfig } from 'vitest/config';

// Real Codex CLI end-to-end tests (tests/codex). Opt-in: they need `codex` on PATH.
export default defineConfig({
  test: {
    include: ['tests/codex/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // One Codex at a time: the tests share a fake model and a CODEX_HOME.
    fileParallelism: false,
  },
});
