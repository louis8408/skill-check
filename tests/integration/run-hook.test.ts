import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/presentation/config.js';
import { createApp, type App } from '../../src/presentation/container.js';
import { runHook } from '../../src/presentation/hooks.js';
import { FakeWeb, tempDir, writeSkill } from './helpers.js';

// In-process counterpart of hook-end-to-end.test.ts: the real composition root and
// infrastructure, wired exactly as the CLI wires them.
describe('runHook with the real composition root', () => {
  const web = new FakeWeb();
  let root: string;
  let cleanup: () => Promise<void>;
  let app: App;

  const input = (extra: Record<string, unknown>) => JSON.stringify({ session_id: 's1', cwd: root, transcript_path: 't', ...extra });

  beforeEach(async () => {
    await web.start();
    ({ path: root, cleanup } = await tempDir());
    const config = loadConfig(
      { CLAUDE_CONFIG_DIR: join(root, 'claude'), CLAUDE_PLUGIN_DATA: join(root, 'data'), SKILL_CHECK_GITHUB_RAW: web.baseUrl, SKILL_CHECK_GITHUB_API: web.baseUrl, GH_TOKEN: 't', XDG_STATE_HOME: join(root, 'state') },
      root,
    );
    app = createApp(config, 'skill-check-test');
    await writeSkill(join(root, 'claude', 'skills'), 'deploy', { version: '1.0.0', source: 'https://github.com/o/r/tree/main/deploy' });
    web.route('/o/r/main/deploy/SKILL.md', { body: '---\nname: deploy\nmetadata:\n  version: 1.1.0\n---\n' });
  });
  afterEach(async () => {
    await web.stop();
    await cleanup();
  });

  it('returns hook JSON for an outdated skill', async () => {
    const out = await runHook(input({ hook_event_name: 'PreToolUse', tool_name: 'Skill', tool_input: { skill: 'deploy' } }), app);
    expect(JSON.parse(out)).toMatchObject({ hookSpecificOutput: { hookEventName: 'PreToolUse' } });
  });

  it('returns nothing for session start, non-skill events and invalid input', async () => {
    expect(await runHook(input({ hook_event_name: 'SessionStart', source: 'startup' }), app)).toBe('');
    expect(await runHook(input({ hook_event_name: 'UserPromptSubmit', prompt: 'hello' }), app)).toBe('');
    expect(await runHook('nope', app)).toBe('');
  });

  it('returns nothing once the session has been warned', async () => {
    const use = input({ hook_event_name: 'PreToolUse', tool_name: 'Skill', tool_input: { skill: 'deploy' } });
    await runHook(use, app);
    expect(await runHook(use, app)).toBe('');
  });
});
