import type { SkillReport } from '../application/refresh-skill-statuses.js';
import type { SkillStatus } from '../domain/status.js';

function describe(status: SkillStatus): string {
  switch (status.kind) {
    case 'outdated':
      return `outdated  ${status.installed} -> ${status.latest}  ${status.updateHint}`;
    case 'current':
      return `current   ${status.installed}`;
    case 'unknown':
      return `unknown   ${status.reason}`;
  }
}

export function formatReport(reports: readonly SkillReport[]): string {
  if (reports.length === 0) return 'No skills found.\n';
  const labels = reports.map((r) => `${r.skill.name} (${r.skill.scope})`);
  const width = Math.max(...labels.map((label) => label.length));
  const lines = reports.map((r, i) => (labels[i] ?? '').padEnd(width) + '  ' + describe(r.status));
  return `${lines.join('\n')}\n`;
}
