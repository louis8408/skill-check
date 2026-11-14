import { describe, expect, it } from 'vitest';
import { SkillStatusChecker } from '../../../src/application/skill-status-checker.js';
import { FakeSource, skill } from './fakes.js';

describe('SkillStatusChecker', () => {
  it('uses the first source that applies to the skill', async () => {
    const skipped = new FakeSource('a', { installed: '1', latest: '9', updateHint: '' }, () => false);
    const used = new FakeSource('b', { installed: '2.0.0', latest: '2.1.0', updateHint: 'hint' });
    const status = await new SkillStatusChecker([skipped, used]).check(skill('x'), 1_000);
    expect(status).toEqual({ kind: 'outdated', installed: '2.0.0', latest: '2.1.0', updateHint: 'hint' });
    expect(skipped.calls).toBe(0);
  });

  it('is unknown when no source applies', async () => {
    const status = await new SkillStatusChecker([]).check(skill('x'), 1_000);
    expect(status).toEqual({ kind: 'unknown', reason: 'no version information (add metadata.source; see https://github.com/louis8408/skill-check#a-skill-shows-as-unknown)' });
  });

  it('copes with a source that rejects with something other than an Error', async () => {
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the case under test
    const stringy = { id: 'odd', appliesTo: () => true, resolve: () => Promise.reject('boom') };
    expect(await new SkillStatusChecker([stringy]).check(skill('x'), 1_000)).toEqual({ kind: 'unknown', reason: 'odd: boom' });
  });

  it('turns a failing source into an unknown status naming the source', async () => {
    const status = await new SkillStatusChecker([new FakeSource('github', new Error('HTTP 404'))]).check(skill('x'), 1_000);
    expect(status).toEqual({ kind: 'unknown', reason: 'github: HTTP 404' });
  });
});
