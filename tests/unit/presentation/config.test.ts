import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../../src/presentation/config.js';

const HOME = join('/', 'home', 'me');

describe('loadConfig', () => {
  it('uses sensible defaults', () => {
    expect(loadConfig({}, HOME)).toEqual({
      configDir: join(HOME, '.claude'),
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
    expect(config.configDir).toBe('/cfg');
    expect(config.statusFile).toBe(join('/plugin-data', 'status.json'));
    expect(config.debugLog).toBe(join('/plugin-data', 'debug.log'));
    expect(config.ttlMs).toBe(2 * 3_600_000);
    expect(config.inlineTimeoutMs).toBe(500);
    expect(config.githubToken).toBe('tok');
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
