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
  const rows = reports.map((r) => ({ label: `${r.skill.name} (${r.skill.scope})`, status: r.status }));
  const width = Math.max(...rows.map((row) => row.label.length));
  const lines = rows.map((row) => row.label.padEnd(width) + '  ' + describe(row.status));
  return `${lines.join('\n')}\n`;
}
