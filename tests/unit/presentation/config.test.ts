import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig, parseAgent } from '../../../src/presentation/config.js';

const HOME = join('/', 'home', 'me');

describe('loadConfig', () => {
  it('uses sensible defaults for Claude Code', () => {
    expect(loadConfig({}, HOME)).toEqual({
      agent: 'claude',
      skills: { personalDirs: [join(HOME, '.claude', 'skills')], projectDir: join('.claude', 'skills') },
      statusFile: join(HOME, '.claude', 'skill-check', 'status.json'),
      debugLog: null,
      ttlMs: 24 * 3_600_000,
      inlineTimeoutMs: 2_000,
      refreshTimeoutMs: 10_000,
      githubApi: 'https://api.github.com',
      githubRaw: 'https://raw.githubusercontent.com',
      githubToken: null,
      skillsLockFile: join(HOME, '.agents', '.skill-lock.json'),
    });
  });

  it('respects Claude Code and skill-check environment variables', () => {
    const config = loadConfig(
      {
        CLAUDE_CONFIG_DIR: '/cfg',
        CLAUDE_PLUGIN_DATA: '/plugin-data',
        SKILL_CHECK_TTL_HOURS: '2',
        SKILL_CHECK_INLINE_TIMEOUT_MS: '500',
        SKILL_CHECK_DEBUG: '1',
        GH_TOKEN: 'tok',
      },
      HOME,
    );
    expect(config.skills.personalDirs).toEqual([join('/cfg', 'skills')]);
    expect(config.statusFile).toBe(join('/plugin-data', 'status.json'));
    expect(config.debugLog).toBe(join('/plugin-data', 'debug.log'));
    expect(config.ttlMs).toBe(2 * 3_600_000);
    expect(config.inlineTimeoutMs).toBe(500);
    expect(config.githubToken).toBe('tok');
  });

  it('uses the Codex skill folders and Codex home for Codex', () => {
    const config = loadConfig({}, HOME, 'codex');
    expect(config.agent).toBe('codex');
    expect(config.skills).toEqual({
      personalDirs: [join(HOME, '.agents', 'skills'), join(HOME, '.codex', 'skills'), join('/', 'etc', 'codex', 'skills')],
      projectDir: join('.agents', 'skills'),
    });
    expect(config.statusFile).toBe(join(HOME, '.codex', 'skill-check', 'status.json'));
  });

  it('respects CODEX_HOME and the plugin data folder Codex provides', () => {
    const config = loadConfig({ CODEX_HOME: '/codex', PLUGIN_DATA: '/codex-data' }, HOME, 'codex');
    expect(config.skills.personalDirs).toContain(join('/codex', 'skills'));
    expect(config.statusFile).toBe(join('/codex-data', 'status.json'));
  });

  it('finds the npx skills lock file under XDG_STATE_HOME when set', () => {
    expect(loadConfig({ XDG_STATE_HOME: '/state' }, HOME).skillsLockFile).toBe(join('/state', 'skills', '.skill-lock.json'));
  });

  it('ignores invalid numbers', () => {
    expect(loadConfig({ SKILL_CHECK_TTL_HOURS: 'soon', SKILL_CHECK_INLINE_TIMEOUT_MS: '-5' }, HOME)).toMatchObject({
      ttlMs: 24 * 3_600_000,
      inlineTimeoutMs: 2_000,
    });
  });
});

describe('parseAgent', () => {
  it('reads --agent from the arguments and defaults to Claude Code', () => {
    expect(parseAgent(['--agent', 'codex'])).toBe('codex');
    expect(parseAgent(['--cwd', 'x', '--agent', 'claude'])).toBe('claude');
    expect(parseAgent([])).toBe('claude');
  });

  it('rejects an unknown agent', () => {
    expect(parseAgent(['--agent', 'cursor'])).toBeNull();
    expect(parseAgent(['--agent'])).toBeNull();
  });
});
