import { describe, expect, it } from 'vitest';
import { formatWarning } from '../../../src/application/format-warning.js';
import { skill } from './fakes.js';

describe('formatWarning', () => {
  it('includes the update hint when there is one', () => {
    expect(formatWarning(skill('deploy'), { kind: 'outdated', installed: '1', latest: '2', updateHint: 'Run x.' })).toBe(
      '[skill-check] The skill "deploy" is out of date: installed 1, latest 2. Run x. Briefly tell the user about this, then continue with the task.',
    );
  });

  it('leaves the hint out cleanly when there is none', () => {
    expect(formatWarning(skill('deploy'), { kind: 'outdated', installed: '1', latest: '2', updateHint: '' })).toBe(
      '[skill-check] The skill "deploy" is out of date: installed 1, latest 2. Briefly tell the user about this, then continue with the task.',
    );
  });
});
