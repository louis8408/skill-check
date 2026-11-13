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
      XDG_STATE_HOME: join(root, 'state'),
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
    // Real Spec Kit output: metadata.source is a relative template path, not a URL.
    await writeSkill(join(project, '.claude', 'skills'), 'speckit-plan', { author: '"github-spec-kit"', source: '"templates/commands/plan.md"' });
    web.route('/repos/github/spec-kit/releases/latest', { body: JSON.stringify({ tag_name: 'v0.13.1' }) });

    const output = (await hook(useSkill('speckit-plan'))).stdout;
    expect(output).toContain('installed 0.12.0, latest v0.13.1');
    expect(output).toContain('specify integration upgrade claude');
  });

  it('warns about a skill installed with npx skills whose upstream folder changed', async () => {
    await writeSkill(join(root, 'claude', 'skills'), 'react-best-practices');
    await mkdir(join(root, 'state', 'skills'), { recursive: true });
    await writeFile(
      join(root, 'state', 'skills', '.skill-lock.json'),
      JSON.stringify({
        version: 3,
        skills: {
          'react-best-practices': {
            source: 'vercel-labs/agent-skills',
            sourceType: 'github',
            sourceUrl: 'https://github.com/vercel-labs/agent-skills.git',
            skillPath: 'skills/react-best-practices/SKILL.md',
            skillFolderHash: 'aaaaaaa1111',
            updatedAt: '2026-01-23T10:00:00.000Z',
          },
        },
      }),
    );
    web.route('/repos/vercel-labs/agent-skills/git/trees/HEAD?recursive=1', {
      body: JSON.stringify({ sha: 'r', tree: [{ path: 'skills/react-best-practices', type: 'tree', sha: 'bbbbbbb2222' }] }),
    });

    const output = (await hook(useSkill('react-best-practices'))).stdout;
    expect(output).toContain('installed aaaaaaa (installed 2026-01-23), latest bbbbbbb');
    expect(output).toContain('npx skills update react-best-practices');
  });

  it('check prints a status line per skill', async () => {
    web.route('/org/repo/main/deploy/SKILL.md', upstream('1.2.0'));
    const result = await run(['check', '--cwd', project]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('deploy (personal)');
    expect(result.stdout).toContain('outdated  1.0.0 -> 1.2.0');
  });

  describe('as a Codex hook (--agent codex, input shapes captured from Codex CLI 0.169.0)', () => {
    function codexHook(input: Record<string, unknown>): Promise<Run> {
      return run(['hook', '--agent', 'codex'], JSON.stringify({ session_id: 'c1', cwd: project, transcript_path: 't', model: 'gpt', ...input }));
    }

    beforeEach(async () => {
      // Codex plugins get both PLUGIN_DATA and CLAUDE_PLUGIN_DATA; use only the Codex name here.
      env = { ...env, CODEX_HOME: join(root, 'codex'), PLUGIN_DATA: join(root, 'codex-data') };
      delete env.CLAUDE_PLUGIN_DATA;
      await writeSkill(join(project, '.agents', 'skills'), 'deploy', { version: '1.0.0', source: 'https://github.com/org/repo/tree/main/deploy' });
      web.route('/org/repo/main/deploy/SKILL.md', upstream('1.2.0'));
    });

    it('warns when the model opens an outdated skill with a shell command', async () => {
      const result = await codexHook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'call_0', tool_input: { command: 'Get-Content -Raw .agents/skills/deploy/SKILL.md' } });
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({ hookSpecificOutput: { hookEventName: 'PreToolUse' } });
      expect(result.stdout).toContain('installed 1.0.0, latest 1.2.0');
    });

    it('warns when the user mentions an outdated skill as $name', async () => {
      const result = await codexHook({ hook_event_name: 'UserPromptSubmit', turn_id: 't1', prompt: 'please use $deploy' });
      expect((JSON.parse(result.stdout) as { systemMessage: string }).systemMessage).toContain('"deploy" is out of date');
      const stored = JSON.parse(await readFile(join(root, 'codex-data', 'status.json'), 'utf8')) as object;
      expect(Object.keys(stored)).toContain('entries');
    });

    it('ignores Claude Code skill folders and Skill tool calls', async () => {
      expect((await codexHook({ hook_event_name: 'PreToolUse', tool_name: 'Skill', tool_input: { skill: 'deploy' } })).stdout).toBe('');
      const result = await run(['check', '--agent', 'codex', '--cwd', project]);
      expect(result.stdout).toContain('deploy (project)');
      expect(result.stdout).not.toContain('(personal)');
    });
  });

  it('writes raw hook input to a debug log when SKILL_CHECK_DEBUG is set', async () => {
    env.SKILL_CHECK_DEBUG = '1';
    await hook(useSkill('not-installed'));
    expect(await readFile(join(root, 'data', 'debug.log'), 'utf8')).toContain('"tool_name":"Skill"');
  });
});
