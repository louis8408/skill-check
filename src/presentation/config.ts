import { join } from 'node:path';

export interface Config {
  readonly configDir: string;
  readonly statusFile: string;
  readonly debugLog: string | null;
  readonly ttlMs: number;
  readonly inlineTimeoutMs: number;
  readonly refreshTimeoutMs: number;
  readonly githubApi: string;
  readonly githubRaw: string;
  readonly githubToken: string | null;
}

type Env = Readonly<Record<string, string | undefined>>;

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return value !== undefined && Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function nonEmpty(value: string | undefined): string | null {
  return value !== undefined && value.trim() !== '' ? value.trim() : null;
}

const HOUR_MS = 3_600_000;

export function loadConfig(env: Env, home: string): Config {
  const configDir = nonEmpty(env.CLAUDE_CONFIG_DIR) ?? join(home, '.claude');
  // A plugin gets a persistent data folder; otherwise keep state next to the Claude config.
  const dataDir = nonEmpty(env.CLAUDE_PLUGIN_DATA) ?? join(configDir, 'skill-check');
  return {
    configDir,
    statusFile: nonEmpty(env.SKILL_CHECK_STATUS_FILE) ?? join(dataDir, 'status.json'),
    debugLog: nonEmpty(env.SKILL_CHECK_DEBUG) ? join(dataDir, 'debug.log') : null,
    ttlMs: positiveNumber(env.SKILL_CHECK_TTL_HOURS, 24) * HOUR_MS,
    inlineTimeoutMs: positiveNumber(env.SKILL_CHECK_INLINE_TIMEOUT_MS, 2_000),
    refreshTimeoutMs: positiveNumber(env.SKILL_CHECK_REFRESH_TIMEOUT_MS, 10_000),
    githubApi: nonEmpty(env.SKILL_CHECK_GITHUB_API) ?? 'https://api.github.com',
    githubRaw: nonEmpty(env.SKILL_CHECK_GITHUB_RAW) ?? 'https://raw.githubusercontent.com',
    githubToken: nonEmpty(env.GITHUB_TOKEN) ?? nonEmpty(env.GH_TOKEN),
  };
}
