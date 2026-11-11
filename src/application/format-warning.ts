import type { InstalledSkill } from '../domain/skill.js';
import type { SkillStatus } from '../domain/status.js';

type Outdated = Extract<SkillStatus, { kind: 'outdated' }>;

/** Text added to the agent's context (and shown to the user) when an outdated skill is used. */
export function formatWarning(skill: InstalledSkill, status: Outdated): string {
  const hint = status.updateHint ? ` ${status.updateHint}` : '';
  return (
    `[skill-check] The skill "${skill.name}" is out of date: installed ${status.installed}, latest ${status.latest}.${hint} ` +
    'Briefly tell the user about this, then continue with the task.'
  );
}
