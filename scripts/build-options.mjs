// Shared esbuild options for the release bundle (scripts/build.mjs) and the end-to-end tests.
// The CLI has no runtime dependencies; it is bundled into one readable file so the hook
// starts fast and the plugin works without `npm install`.
export function cliBuildOptions(outfile) {
  return {
    entryPoints: ['src/presentation/cli.ts'],
    outfile,
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    legalComments: 'none',
    logLevel: 'warning',
  };
}
