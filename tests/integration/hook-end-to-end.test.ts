import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cliBuildOptions } from '../../scripts/build-options.mjs';
import { FakeWeb, tempDir, writeSkill } from './helpers.js';

const CLI = resolve('dist-test', 'cli.js');

// Test the same single-file bundle that ships, built with the release options.
beforeAll(async () => {
  await build(cliBuildOptions(CLI));
});

interface Run {
  stdout: string;
  status: number | null;
}

describe('skill-check CLI as a Claude Code hook (real files, local fake GitHub)', () => {
  const web = new FakeWeb();
  let root: string;
  let cleanup: () => Promise<void>;
  let env: Record<string, string>;
  let project: string;

  // Async on purpose: the fake GitHub server runs in this process and must keep answering.
  function run(args: string[], stdin = ''): Promise<Run> {
    return new Promise((done, fail) => {
      const child = spawn(process.execPath, [CLI, ...args], { env: { ...env, PATH: process.env.PATH ?? '' } });
      let stdout = '';
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
      child.on('error', fail);
      child.on('close', (status) => { done({ stdout, status }); });
      child.stdin.end(stdin);
    });
  }

  function hook(input: Record<string, unknown>): Promise<Run> {
    return run(['hook'], JSON.stringify({ session_id: 's1', cwd: project, transcript_path: 't', ...input }));
  }

  const useSkill = (skill: string) => ({ hook_event_name: 'PreToolUse', tool_name: 'Skill', tool_input: { skill } });
  const upstream = (version: string) => ({ body: `---\nname: deploy\nmetadata:\n  version: ${version}\n---\n` });

  beforeEach(async () => {
    await web.start();
    ({ path: root, cleanup } = await tempDir());
    project = join(root, 'project');
    await mkdir(project, { recursive: true });
    env = {
      CLAUDE_CONFIG_DIR: join(root, 'claude'),
      CLAUDE_PLUGIN_DATA: join(root, 'data'),
      SKILL_CHECK_GITHUB_API: web.baseUrl,
      SKILL_CHECK_GITHUB_RAW: web.baseUrl,
    };
    await writeSkill(join(root, 'claude', 'skills'), 'deploy', { version: '1.0.0', source: 'https://github.com/org/repo/tree/main/deploy' });
  });
  afterEach(async () => {
    await web.stop();
    await cleanup();
  });

  it('warns Claude and the user when an outdated skill is used, once per session', async () => {
    web.route('/org/repo/main/deploy/SKILL.md', upstream('1.2.0'));

    const first = await hook(useSkill('deploy'));
    expect(first.status).toBe(0);
    const output = JSON.parse(first.stdout) as { systemMessage: string; hookSpecificOutput: { hookEventName: string; additionalContext: string } };
    expect(output.hookSpecificOutput.hookEventName).toBe('PreToolUse');
    expect(output.hookSpecificOutput.additionalContext).toContain('installed 1.0.0, latest 1.2.0');
    expect(output.systemMessage).toContain('"deploy" is out of date');

    expect((await hook(useSkill('deploy'))).stdout).toBe('');
  });

  it('also warns for a skill the user typed as a slash command', async () => {
    web.route('/org/repo/main/deploy/SKILL.md', upstream('1.2.0'));
    const result = await hook({ hook_event_name: 'UserPromptSubmit', prompt: '/deploy now' });
    expect(JSON.parse(result.stdout)).toMatchObject({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit' } });
  });

  it('stays silent when the skill is current or not installed', async () => {
    web.route('/org/repo/main/deploy/SKILL.md', upstream('1.0.0'));
    expect((await hook(useSkill('deploy'))).stdout).toBe('');
    expect((await hook(useSkill('not-installed'))).stdout).toBe('');
  });

  it('stays silent and exits 0 when GitHub cannot be reached', async () => {
    await web.stop();
    expect(await hook(useSkill('deploy'))).toEqual({ stdout: '', status: 0 });
    await web.start();
  });

  it('never breaks the session on bad input', async () => {
    expect(await run(['hook'], 'garbage')).toEqual({ stdout: '', status: 0 });
    expect(await run(['hook'], '')).toEqual({ stdout: '', status: 0 });
  });

  it('refreshes all skills at session start so later uses need no network', async () => {
    web.route('/org/repo/main/deploy/SKILL.md', upstream('2.0.0'));
    expect(await hook({ hook_event_name: 'SessionStart', source: 'startup' })).toEqual({ stdout: '', status: 0 });
    const stored = JSON.parse(await readFile(join(root, 'data', 'status.json'), 'utf8')) as { entries: Record<string, { status: { kind: string } }> };
    expect(Object.values(stored.entries).map((e) => e.status.kind)).toEqual(['outdated']);

    await web.stop();
    expect((await hook(useSkill('deploy'))).stdout).toContain('latest 2.0.0');
    await web.start();
  });

  it('warns about an outdated Spec Kit project', async () => {
    await mkdir(join(project, '.specify'), { recursive: true });
    await writeFile(join(project, '.specify', 'integration.json'), JSON.stringify({ version: '0.12.0', integration: 'claude' }));
    await writeSkill(join(project, '.claude', 'skills'), 'speckit-plan');
    web.route('/repos/github/spec-kit/releases/latest', { body: JSON.stringify({ tag_name: 'v0.13.1' }) });

    const output = (await hook(useSkill('speckit-plan'))).stdout;
    expect(output).toContain('installed 0.12.0, latest v0.13.1');
    expect(output).toContain('specify integration upgrade claude');
  });

  it('check prints a status line per skill', async () => {
    web.route('/org/repo/main/deploy/SKILL.md', upstream('1.2.0'));
    const result = await run(['check', '--cwd', project]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('deploy (personal)');
    expect(result.stdout).toContain('outdated  1.0.0 -> 1.2.0');
  });

  it('writes raw hook input to a debug log when SKILL_CHECK_DEBUG is set', async () => {
    env.SKILL_CHECK_DEBUG = '1';
    await hook(useSkill('not-installed'));
    expect(await readFile(join(root, 'data', 'debug.log'), 'utf8')).toContain('"tool_name":"Skill"');
  });
});
