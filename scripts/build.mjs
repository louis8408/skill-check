// Bundles the CLI into a single dependency-free file so the hook starts fast
// and the plugin works without `npm install`.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/presentation/cli.ts'],
  outfile: 'dist/cli.js',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  banner: { js: '#!/usr/bin/env node' },
  legalComments: 'none',
  logLevel: 'warning',
});
