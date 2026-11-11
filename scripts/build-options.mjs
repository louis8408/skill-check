// Shared esbuild options for the release bundle (scripts/build.mjs) and the end-to-end tests.
// The CLI is bundled into one dependency-free file so the hook starts fast and the
// plugin works without `npm install`.
export function cliBuildOptions(outfile) {
  return {
    entryPoints: ['src/presentation/cli.ts'],
    outfile,
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    // Bundled CommonJS dependencies (yaml) call require(); give the ESM bundle one.
    banner: {
      js: "#!/usr/bin/env node\nimport { createRequire as __createRequire } from 'node:module';\nconst require = __createRequire(import.meta.url);",
    },
    legalComments: 'none',
    logLevel: 'warning',
  };
}
