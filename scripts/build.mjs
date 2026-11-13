import { build } from 'esbuild';
import { cliBuildOptions } from './build-options.mjs';

await build(cliBuildOptions('plugin/dist/cli.js'));
