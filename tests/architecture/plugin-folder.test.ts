// The plugin folder is what users install and what Anthropic's plugin directory inspects, so it
// holds only what the plugin runs and describes: manifests, hooks, the bundle, README, license.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..', '..');
const PLUGIN = join(ROOT, 'plugin');

const byName = (a: string, b: string): number => a.localeCompare(b);

const files = readdirSync(PLUGIN, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => relative(PLUGIN, join(entry.parentPath, entry.name)).replaceAll('\\', '/'))
  .sort(byName);

interface CommandHook {
  readonly type: string;
  readonly command: string;
  readonly args?: readonly string[];
}

function hooksIn(path: string): CommandHook[] {
  const config = JSON.parse(readFileSync(join(PLUGIN, path), 'utf8')) as {
    hooks: Record<string, { hooks: CommandHook[] }[]>;
  };
  return Object.values(config.hooks).flatMap((matchers) => matchers.flatMap((matcher) => matcher.hooks));
}

describe('plugin folder', () => {
  it('holds only the files the plugin ships', () => {
    expect(files).toEqual([
      '.claude-plugin/icon.png',
      '.claude-plugin/plugin.json',
      '.codex-plugin/plugin.json',
      'LICENSE',
      'NOTICE',
      'README.md',
      'dist/cli.js',
      'hooks/codex-hooks.json',
      'hooks/hooks.json',
    ].sort(byName));
  });

  it('has no package.json, so Claude Code runs no dependency install when it is installed', () => {
    expect(existsSync(join(PLUGIN, 'package.json'))).toBe(false);
  });

  it('has no file that starts with a shebang', () => {
    const withShebang = files.filter((file) => readFileSync(join(PLUGIN, file)).subarray(0, 2).toString() === '#!');
    expect(withShebang).toEqual([]);
  });

  it('carries the same LICENSE and NOTICE as the repository', () => {
    for (const name of ['LICENSE', 'NOTICE']) {
      expect(readFileSync(join(PLUGIN, name), 'utf8')).toBe(readFileSync(join(ROOT, name), 'utf8'));
    }
  });

  it('runs Claude Code hooks in exec form: node plus the bundle by its literal path', () => {
    const hooks = hooksIn('hooks/hooks.json');
    expect(hooks.length).toBeGreaterThan(0);
    for (const hook of hooks) {
      expect(hook).toMatchObject({ type: 'command', command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/dist/cli.js', 'hook'] });
    }
  });

  it('runs Codex hooks with the bundle and --agent codex', () => {
    const hooks = hooksIn('hooks/codex-hooks.json');
    expect(hooks.length).toBeGreaterThan(0);
    for (const hook of hooks) expect(hook.command).toBe('node "${PLUGIN_ROOT}/dist/cli.js" hook --agent codex');
  });
});
