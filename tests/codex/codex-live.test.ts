import { spawn } from 'node:child_process';
import { cp, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cliBuildOptions } from '../../scripts/build-options.mjs';
import { FakeWeb, tempDir, writeSkill } from '../integration/helpers.js';
import { FakeModel, type ModelStep } from './fake-model.js';

/*
 * Runs the real Codex CLI (on PATH) with skill-check installed as a Codex plugin, against a
 * scripted fake model and a fake GitHub. Nothing leaves the machine and no account is needed.
 * Opt-in (`npm run test:codex`) because it needs Codex installed.
 *
 * It passes --dangerously-bypass-hook-trust: the hooks run in a throwaway CODEX_HOME created
 * here, and Codex otherwise only runs plugin hooks after someone approves them in /hooks.
 */

interface Run {
  readonly status: number | null;
  readonly output: string;
}

const REPO = resolve('.');
const PLUGIN_FILES = ['.codex-plugin', join('.agents', 'plugins'), 'hooks'];

describe('skill-check inside real Codex (fake model, fake GitHub)', () => {
  const model = new FakeModel();
  const web = new FakeWeb();
  let root: string;
  let cleanup: () => Promise<void>;
  let env: NodeJS.ProcessEnv;
  let project: string;

  // Async on purpose: the fake model and fake GitHub run in this process and must keep answering.
  function codex(args: string[], options: { cwd?: string; stdin?: string } = {}): Promise<Run> {
    return new Promise((done, fail) => {
      // npm installs Codex as a .cmd/.ps1 shim on Windows, which needs a shell to start.
      // Finding `codex` on PATH is the point: this tests the user's installed Codex.
      // eslint-disable-next-line sonarjs/no-os-command-from-path
      const child = spawn('codex', args, { cwd: options.cwd ?? root, env, shell: process.platform === 'win32' });
      let output = '';
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => (output += chunk));
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => (output += chunk));
      child.on('error', fail);
      child.on('close', (status) => { done({ status, output }); });
      child.stdin.end(options.stdin ?? '');
    });
  }

  /** One non-interactive Codex session in the project; the prompt goes in on stdin. */
  async function session(prompt: string, steps: ModelStep[]): Promise<Run> {
    model.play(steps);
    return codex(['exec', '--dangerously-bypass-hook-trust', '--skip-git-repo-check', '-'], { cwd: project, stdin: prompt });
  }

  beforeAll(async () => {
    await model.start();
    ({ path: root, cleanup } = await tempDir());
    const home = join(root, 'home');
    const codexHome = join(home, '.codex');
    await mkdir(codexHome, { recursive: true });
    env = {
      PATH: process.env.PATH,
      SYSTEMROOT: process.env.SYSTEMROOT,
      HOME: home,
      USERPROFILE: home,
      CODEX_HOME: codexHome,
    };
    await writeFile(
      join(codexHome, 'config.toml'),
      [
        'model = "fake-model"',
        'model_provider = "fake"',
        '',
        '[model_providers.fake]',
        'name = "fake"',
        `base_url = "${model.baseUrl}"`,
        'wire_api = "responses"',
        '',
      ].join('\n'),
    );

    // A marketplace holding the plugin exactly as it ships, with the bundle built from this source.
    const market = join(root, 'market');
    await Promise.all(PLUGIN_FILES.map((path) => cp(join(REPO, path), join(market, path), { recursive: true })));
    await build(cliBuildOptions(join(market, 'dist', 'cli.js')));
    for (const args of [['plugin', 'marketplace', 'add', market], ['plugin', 'add', 'skill-check@skill-check']]) {
      // eslint-disable-next-line no-await-in-loop -- the plugin can only be added once its marketplace is
      const result = await codex(args);
      expect(result.status, result.output).toBe(0);
    }
  }, 120_000);

  afterAll(async () => {
    await model.stop();
    await cleanup();
  });

  beforeEach(async () => {
    await web.start();
    // Point skill-check at the fake GitHub. Codex passes its environment on to plugin hooks.
    env = { ...env, SKILL_CHECK_GITHUB_RAW: web.baseUrl, SKILL_CHECK_GITHUB_API: web.baseUrl };
    project = join(root, `project-${String(Date.now())}`);
    await writeSkill(join(project, '.agents', 'skills'), 'deploy', { version: '1.0.0', source: 'https://github.com/org/repo/tree/main/deploy' });
    web.route('/org/repo/main/deploy/SKILL.md', { body: '---\nname: deploy\nmetadata:\n  version: 1.2.0\n---\n' });
    return () => web.stop();
  });

  const warning = '[skill-check] The skill "deploy" is out of date: installed 1.0.0, latest 1.2.0.';

  it('warns the model when the user mentions an outdated skill as $deploy', async () => {
    const result = await session('please use $deploy', [{ say: 'Deploying.' }]);
    expect(result.status, result.output).toBe(0);
    expect(model.developerTexts().some((text) => text.startsWith(warning))).toBe(true);
  }, 120_000);

  it('warns the model when it opens an outdated skill with a shell command', async () => {
    const result = await session('deploy the app', [{ exec: 'cat .agents/skills/deploy/SKILL.md' }, { say: 'Deploying.' }]);
    expect(result.status, result.output).toBe(0);
    expect(model.requests.length).toBeGreaterThanOrEqual(2);
    expect(model.developerTexts().some((text) => text.startsWith(warning))).toBe(true);
  }, 120_000);

  it('stays silent for a current skill', async () => {
    web.route('/org/repo/main/deploy/SKILL.md', { body: '---\nname: deploy\nmetadata:\n  version: 1.0.0\n---\n' });
    const result = await session('please use $deploy', [{ say: 'Deploying.' }]);
    expect(result.status, result.output).toBe(0);
    expect(model.developerTexts().some((text) => text.includes('[skill-check]'))).toBe(false);
  }, 120_000);
});
