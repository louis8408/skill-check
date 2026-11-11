import { describe, expect, it } from 'vitest';
import { formatReport } from '../../../src/presentation/report.js';

const skill = (name: string, scope: 'personal' | 'project' = 'personal') => ({ name, directory: `/s/${name}`, scope, metadata: {} });

describe('formatReport', () => {
  it('prints one aligned line per skill with its status', () => {
    const text = formatReport([
      { skill: skill('deploy'), status: { kind: 'outdated', installed: '1.0.0', latest: '1.2.0', updateHint: 'Update it.' } },
      { skill: skill('speckit-plan', 'project'), status: { kind: 'current', installed: '0.13.1', latest: '0.13.1' } },
      { skill: skill('x'), status: { kind: 'unknown', reason: 'no version information' } },
    ]);
    expect(text.split('\n')).toEqual([
      'deploy (personal)       outdated  1.0.0 -> 1.2.0  Update it.',
      'speckit-plan (project)  current   0.13.1',
      'x (personal)            unknown   no version information',
      '',
    ]);
  });

  it('says so when there are no skills', () => {
    expect(formatReport([])).toBe('No skills found.\n');
  });
});
