import type { SkillVersionSource } from '../domain/ports.js';
import type { InstalledSkill } from '../domain/skill.js';
import { evaluateStatus, type SkillStatus } from '../domain/status.js';

export class SkillStatusChecker {
  constructor(private readonly sources: readonly SkillVersionSource[]) {}

  async check(skill: InstalledSkill, timeoutMs: number): Promise<SkillStatus> {
    const source = this.sources.find((s) => s.appliesTo(skill));
    if (!source) {
      return { kind: 'unknown', reason: 'no version information (add metadata.version and metadata.source)' };
    }
    try {
      return evaluateStatus(await source.resolve(skill, timeoutMs));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { kind: 'unknown', reason: `${source.id}: ${message}` };
    }
  }
}
