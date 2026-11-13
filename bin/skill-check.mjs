#!/usr/bin/env node
// npm entry point for the CLI. The bundle itself has no shebang, because Anthropic's plugin
// directory doesn't accept a plugin file that starts with one; the hooks run it with `node`.
import '../plugin/dist/cli.js';
