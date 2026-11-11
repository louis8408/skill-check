import { describe, expect, it } from 'vitest';
import { CheckSkillOnUse } from '../../../src/application/check-skill-on-use.js';
import { SkillStatusChecker } from '../../../src/application/skill-status-checker.js';
import { FakeCatalog, FakeSource, FixedClock, MemoryStore, skill } from './fakes.js';

const HOUR = 3_600_000;
const outdatedInfo = { installed: '1.0.0', latest: '1.2.0', updateHint: 'Run the updater.' };

function setup(sourceResult: ConstructorParameters<typeof FakeSource>[1] = outdatedInfo) {
  const store = new MemoryStore();
  const clock = new FixedClock(10 * HOUR);
  const source = new FakeSource('fake', sourceResult);
  const useCase = new CheckSkillOnUse(
    new FakeCatalog([skill('deploy')]),
    new SkillStatusChecker([source]),
    store,
    clock,
    { ttlMs: 24 * HOUR, inlineTimeoutMs: 1_500 },
  );
  return { store, clock, source, useCase };
}

describe('CheckSkillOnUse', () => {
  it('warns when the skill is out of date, naming both versions and the update hint', async () => {
    const { useCase } = setup();
    const warning = await useCase.execute({ skillName: 'deploy', cwd: '/p', sessionId: 's1' });
    expect(warning).toContain('"deploy"');
    expect(warning).toContain('1.0.0');
    expect(warning).toContain('1.2.0');
    expect(warning).toContain('Run the updater.');
  });

  it('warns only once per session for the same skill', async () => {
    const { useCase } = setup();
    await useCase.execute({ skillName: 'deploy', cwd: '/p', sessionId: 's1' });
    expect(await useCase.execute({ skillName: 'deploy', cwd: '/p', sessionId: 's1' })).toBeNull();
    expect(await useCase.execute({ skillName: 'deploy', cwd: '/p', sessionId: 's2' })).not.toBeNull();
  });

  it('uses a fresh cached status instead of checking again', async () => {
    const { useCase, source } = setup();
    await useCase.execute({ skillName: 'deploy', cwd: '/p', sessionId: 's1' });
    await useCase.execute({ skillName: 'deploy', cwd: '/p', sessionId: 's2' });
    expect(source.calls).toBe(1);
  });

  it('checks again once the cached status is stale', async () => {
    const { useCase, source, clock } = setup();
    await useCase.execute({ skillName: 'deploy', cwd: '/p', sessionId: 's1' });
    clock.time += 25 * HOUR;
    await useCase.execute({ skillName: 'deploy', cwd: '/p', sessionId: 's2' });
    expect(source.calls).toBe(2);
  });

  it('says nothing when the skill is current', async () => {
    const { useCase } = setup({ installed: '1.2.0', latest: '1.2.0', updateHint: '' });
    expect(await useCase.execute({ skillName: 'deploy', cwd: '/p', sessionId: 's1' })).toBeNull();
  });

  it('says nothing for unknown skills', async () => {
    const { useCase, source } = setup();
    expect(await useCase.execute({ skillName: 'nope', cwd: '/p', sessionId: 's1' })).toBeNull();
    expect(source.calls).toBe(0);
  });

  it('says nothing (and caches "unknown") when the version source fails', async () => {
    const { useCase, store } = setup(new Error('offline'));
    expect(await useCase.execute({ skillName: 'deploy', cwd: '/p', sessionId: 's1' })).toBeNull();
    expect(store.entries.get('/skills/deploy')?.status).toEqual({ kind: 'unknown', reason: 'fake: offline' });
  });
});
