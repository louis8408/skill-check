import type { Clock, SkillCatalog, StatusStore } from '../domain/ports.js';
import type { InstalledSkill } from '../domain/skill.js';
import type { SkillStatus } from '../domain/status.js';
import type { SkillStatusChecker } from './skill-status-checker.js';

export interface RefreshOptions {
  readonly timeoutMs: number;
}

export interface SkillReport {
  readonly skill: InstalledSkill;
  readonly status: SkillStatus;
}

/** Checks every visible skill and stores the results (runs in the background at session start). */
export class RefreshSkillStatuses {
  constructor(
    private readonly catalog: SkillCatalog,
    private readonly checker: SkillStatusChecker,
    private readonly store: StatusStore,
    private readonly clock: Clock,
    private readonly options: RefreshOptions,
  ) {}

  async execute(request: { readonly cwd: string }): Promise<SkillReport[]> {
    const skills = await this.catalog.list(request.cwd);
    const reports = await Promise.all(
      skills.map(async (skill) => ({ skill, status: await this.checker.check(skill, this.options.timeoutMs) })),
    );
    // Store sequentially: implementations may write a single shared file.
    for (const { skill, status } of reports) {
      const previous = await this.store.get(skill.directory);
      await this.store.put(skill.directory, {
        status,
        checkedAt: this.clock.now(),
        warnedSessions: previous?.warnedSessions ?? [],
      });
    }
    return reports;
  }
}
