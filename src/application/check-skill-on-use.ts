import type { Clock, SkillCatalog, StatusStore } from '../domain/ports.js';
import { isFresh, type StoredStatus } from '../domain/status.js';
import { formatWarning } from './format-warning.js';
import type { SkillStatusChecker } from './skill-status-checker.js';

export interface CheckSkillOnUseOptions {
  /** How long a stored status is trusted before checking again. */
  readonly ttlMs: number;
  /** Time budget for a check when nothing fresh is stored (the agent waits for this). */
  readonly inlineTimeoutMs: number;
}

export interface SkillUse {
  readonly skillName: string;
  readonly cwd: string;
  readonly sessionId: string;
}

const MAX_REMEMBERED_SESSIONS = 20;

/** Runs when a skill is used: returns a warning if it is out of date, otherwise null. */
export class CheckSkillOnUse {
  constructor(
    private readonly catalog: SkillCatalog,
    private readonly checker: SkillStatusChecker,
    private readonly store: StatusStore,
    private readonly clock: Clock,
    private readonly options: CheckSkillOnUseOptions,
  ) {}

  async execute(use: SkillUse): Promise<string | null> {
    const skill = await this.catalog.find(use.skillName, use.cwd);
    if (!skill) return null;

    const entry = await this.currentEntry(skill.directory, () => this.checker.check(skill, this.options.inlineTimeoutMs));
    if (entry.status.kind !== 'outdated' || entry.warnedSessions.includes(use.sessionId)) return null;

    await this.store.put(skill.directory, {
      ...entry,
      warnedSessions: [...entry.warnedSessions, use.sessionId].slice(-MAX_REMEMBERED_SESSIONS),
    });
    return formatWarning(skill, entry.status);
  }

  private async currentEntry(key: string, check: () => ReturnType<SkillStatusChecker['check']>): Promise<StoredStatus> {
    const stored = await this.store.get(key);
    const now = this.clock.now();
    if (stored && isFresh(stored, now, this.options.ttlMs)) return stored;

    const entry: StoredStatus = { status: await check(), checkedAt: now, warnedSessions: stored?.warnedSessions ?? [] };
    await this.store.put(key, entry);
    return entry;
  }
}
