import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { run, VERSION, type Io } from '../../src/presentation/main.js';
import { FakeWeb, tempDir, writeSkill } from './helpers.js';

// The CLI logic, in-process. src/presentation/cli.ts only wires this to the real process.
describe('run (the skill-check CLI)', () => {
  const web = new FakeWeb();
  let root: string;
  let cleanup: () => Promise<void>;
  let output: string;
  let env: Record<string, string>;

  function io(stdin = ''): Io {
    return { env, home: root, cwd: join(root, 'project'), readStdin: () => Promise.resolve(stdin), write: (text) => (output += text) };
  }
  const hookInput = (skill: string) =>
    JSON.stringify({ session_id: 's1', cwd: join(root, 'project'), hook_event_name: 'PreToolUse', tool_name: 'Skill', tool_input: { skill } });

  beforeEach(async () => {
    await web.start();
    ({ path: root, cleanup } = await tempDir());
    await mkdir(join(root, 'project'), { recursive: true });
    output = '';
    env = {
      CLAUDE_CONFIG_DIR: join(root, 'claude'),
      CLAUDE_PLUGIN_DATA: join(root, 'data'),
      SKILL_CHECK_GITHUB_RAW: web.baseUrl,
      SKILL_CHECK_GITHUB_API: web.baseUrl,
      XDG_STATE_HOME: join(root, 'state'),
    };
    await writeSkill(join(root, 'claude', 'skills'), 'deploy', { version: '1.0.0', source: 'https://github.com/o/r/tree/main/deploy' });
    web.route('/o/r/main/deploy/SKILL.md', { body: '---\nname: deploy\nmetadata:\n  version: 2.0.0\n---\n' });
  });
  afterEach(async () => {
    await web.stop();
    await cleanup();
  });

  it('prints the version', async () => {
    await run(['--version'], io());
    await run(['-v'], io());
    expect(output).toBe(`${VERSION}\n${VERSION}\n`);
  });

  it('prints help for no or unknown commands', async () => {
    await run([], io());
    expect(output).toContain('Usage:');
  });

  it('hook: writes the warning JSON for an outdated skill', async () => {
    await run(['hook'], io(hookInput('deploy')));
    expect(JSON.parse(output)).toMatchObject({ hookSpecificOutput: { hookEventName: 'PreToolUse' } });
  });

  it('hook: writes nothing when there is nothing to say', async () => {
    await run(['hook'], io(hookInput('unknown-skill')));
    expect(output).toBe('');
  });

  it('hook: swallows failures and logs them when debugging (a hook must never break the session)', async () => {
    env.SKILL_CHECK_DEBUG = '1';
    env.SKILL_CHECK_STATUS_FILE = join(root, 'data'); // a directory: saving the status fails
    await mkdir(join(root, 'data'), { recursive: true });
    await run(['hook'], io(hookInput('deploy')));
    expect(output).toBe('');
    const log = await readFile(join(root, 'data', 'debug.log'), 'utf8');
    expect(log).toContain('"tool_name":"Skill"');
    expect(log).toContain('error: ');
  });

  it('hook: stays silent even when the debug log itself cannot be written', async () => {
    env.SKILL_CHECK_DEBUG = '1';
    env.CLAUDE_PLUGIN_DATA = join(root, 'not-a-folder');
    await writeFile(join(root, 'not-a-folder'), 'x');
    await expect(run(['hook'], io(hookInput('deploy')))).resolves.toBeUndefined();
    expect(output).toBe('');
  });

  it('hook --agent codex: reads Codex input and Codex skill folders', async () => {
    env.CODEX_HOME = join(root, 'codex');
    await writeSkill(join(root, '.agents', 'skills'), 'review', { version: '1.0.0', source: 'https://github.com/o/r/tree/main/review' });
    web.route('/o/r/main/review/SKILL.md', { body: '---\nname: review\nmetadata:\n  version: 3.0.0\n---\n' });
    const prompt = JSON.stringify({ session_id: 's1', cwd: join(root, 'project'), hook_event_name: 'UserPromptSubmit', prompt: 'use $review' });
    await run(['hook', '--agent', 'codex'], io(prompt));
    expect((JSON.parse(output) as { systemMessage: string }).systemMessage).toContain('"review" is out of date');
  });

  it('check --agent codex: reports Codex skills only', async () => {
    await writeSkill(join(root, '.agents', 'skills'), 'review');
    await run(['check', '--agent', 'codex', '--cwd', join(root, 'project')], io());
    expect(output).toContain('review (personal)');
    expect(output).not.toContain('deploy');
  });

  it('prints help and does nothing for an unknown agent', async () => {
    await run(['hook', '--agent', 'cursor'], io(hookInput('deploy')));
    expect(output).toContain('Usage:');
    expect(output).not.toContain('hookSpecificOutput');
  });

  it('check: reports skills visible from --cwd, or from the current folder', async () => {
    await run(['check', '--cwd', join(root, 'project')], io());
    expect(output).toContain('deploy (personal)  outdated  1.0.0 -> 2.0.0');
    output = '';
    await run(['check'], io());
    expect(output).toContain('deploy (personal)');
    output = '';
    await run(['check', '--cwd'], io());
    expect(output).toContain('deploy (personal)');
  });
});
