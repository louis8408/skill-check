import { join } from 'node:path';

/** The coding agent skill-check runs inside. It decides where skills live and how hook input looks. */
export type Agent = 'claude' | 'codex';

export interface SkillFolders {
  /** Personal skill folders, in precedence order. */
  readonly personalDirs: readonly string[];
  /** Project skill folder, relative to the working directory or any parent. */
  readonly projectDir: string;
}

export interface Config {
  readonly agent: Agent;
  readonly skills: SkillFolders;
  readonly statusFile: string;
  readonly debugLog: string | null;
  readonly ttlMs: number;
  readonly inlineTimeoutMs: number;
  readonly refreshTimeoutMs: number;
  readonly githubApi: string;
  readonly githubRaw: string;
  readonly githubToken: string | null;
  /** Global lock file written by `npx skills` (vercel-labs/skills). */
  readonly skillsLockFile: string;
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

/** "--agent codex" -> 'codex'; no flag -> 'claude'; anything else -> null. */
export function parseAgent(args: readonly string[]): Agent | null {
  const index = args.indexOf('--agent');
  if (index === -1) return 'claude';
  const value = args[index + 1];
  return value === 'claude' || value === 'codex' ? value : null;
}

interface AgentLayout {
  /** The agent's own folder, where skill-check keeps state when not run as a plugin. */
  readonly home: string;
  readonly skills: SkillFolders;
}

function agentLayout(agent: Agent, env: Env, home: string): AgentLayout {
  if (agent === 'codex') {
    // Codex skill locations: https://learn.chatgpt.com/docs/build-skills (user, legacy and admin
    // folders, plus .agents/skills in the project). Bundled skills in skills/.system are skipped
    // by the catalog, like Claude Code plugin skills.
    const codexHome = nonEmpty(env.CODEX_HOME) ?? join(home, '.codex');
    return {
      home: codexHome,
      skills: {
        personalDirs: [join(home, '.agents', 'skills'), join(codexHome, 'skills'), join('/', 'etc', 'codex', 'skills')],
        projectDir: join('.agents', 'skills'),
      },
    };
  }
  const configDir = nonEmpty(env.CLAUDE_CONFIG_DIR) ?? join(home, '.claude');
  return { home: configDir, skills: { personalDirs: [join(configDir, 'skills')], projectDir: join('.claude', 'skills') } };
}

export function loadConfig(env: Env, home: string, agent: Agent = 'claude'): Config {
  const layout = agentLayout(agent, env, home);
  // A plugin gets a persistent data folder (Codex sets both names); otherwise keep state next to the agent's config.
  const dataDir = nonEmpty(env.CLAUDE_PLUGIN_DATA) ?? nonEmpty(env.PLUGIN_DATA) ?? join(layout.home, 'skill-check');
  return {
    agent,
    skills: layout.skills,
    statusFile: nonEmpty(env.SKILL_CHECK_STATUS_FILE) ?? join(dataDir, 'status.json'),
    debugLog: nonEmpty(env.SKILL_CHECK_DEBUG) ? join(dataDir, 'debug.log') : null,
    ttlMs: positiveNumber(env.SKILL_CHECK_TTL_HOURS, 24) * HOUR_MS,
    inlineTimeoutMs: positiveNumber(env.SKILL_CHECK_INLINE_TIMEOUT_MS, 2_000),
    refreshTimeoutMs: positiveNumber(env.SKILL_CHECK_REFRESH_TIMEOUT_MS, 10_000),
    githubApi: nonEmpty(env.SKILL_CHECK_GITHUB_API) ?? 'https://api.github.com',
    githubRaw: nonEmpty(env.SKILL_CHECK_GITHUB_RAW) ?? 'https://raw.githubusercontent.com',
    // Only a token the user gave skill-check: the plugin's optional "github_token" setting
    // (Claude Code passes it as CLAUDE_PLUGIN_OPTION_GITHUB_TOKEN) or SKILL_CHECK_GITHUB_TOKEN.
    // A GITHUB_TOKEN that happens to be in the environment is never picked up.
    githubToken: nonEmpty(env.CLAUDE_PLUGIN_OPTION_GITHUB_TOKEN) ?? nonEmpty(env.SKILL_CHECK_GITHUB_TOKEN),
    skillsLockFile: skillsLockFile(env, home),
  };
}

/** Same rule as `npx skills`: $XDG_STATE_HOME/skills/.skill-lock.json, else ~/.agents/.skill-lock.json. */
function skillsLockFile(env: Env, home: string): string {
  const state = nonEmpty(env.XDG_STATE_HOME);
  return state ? join(state, 'skills', '.skill-lock.json') : join(home, '.agents', '.skill-lock.json');
}
