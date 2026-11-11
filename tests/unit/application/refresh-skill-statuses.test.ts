import { describe, expect, it } from 'vitest';
import { RefreshSkillStatuses } from '../../../src/application/refresh-skill-statuses.js';
import { SkillStatusChecker } from '../../../src/application/skill-status-checker.js';
import { FakeCatalog, FakeSource, FixedClock, MemoryStore, skill } from './fakes.js';

describe('RefreshSkillStatuses', () => {
  it('checks every skill, stores each status and returns a report', async () => {
    const store = new MemoryStore();
    const old = skill('old', { metadata: { version: '1.0.0' } });
    const fresh = skill('fresh', { metadata: { version: '2.0.0' } });
    const source = new FakeSource('fake', { installed: '1.0.0', latest: '1.1.0', updateHint: 'h' }, (s) => s.name === 'old');
    const refresh = new RefreshSkillStatuses(new FakeCatalog([old, fresh]), new SkillStatusChecker([source]), store, new FixedClock(42), {
      timeoutMs: 1_000,
    });

    const report = await refresh.execute({ cwd: '/p' });

    expect(report.map((r) => [r.skill.name, r.status.kind])).toEqual([
      ['old', 'outdated'],
      ['fresh', 'unknown'],
    ]);
    expect(store.entries.get('/skills/old')).toEqual({
      status: { kind: 'outdated', installed: '1.0.0', latest: '1.1.0', updateHint: 'h' },
      checkedAt: 42,
      warnedSessions: [],
    });
  });

  it('keeps the sessions already warned when it refreshes a status', async () => {
    const store = new MemoryStore();
    await store.put('/skills/old', { status: { kind: 'unknown', reason: 'x' }, checkedAt: 0, warnedSessions: ['s1'] });
    const source = new FakeSource('fake', { installed: '1.0.0', latest: '1.1.0', updateHint: 'h' });
    const refresh = new RefreshSkillStatuses(new FakeCatalog([skill('old')]), new SkillStatusChecker([source]), store, new FixedClock(42), {
      timeoutMs: 1_000,
    });

    await refresh.execute({ cwd: '/p' });

    expect(store.entries.get('/skills/old')?.warnedSessions).toEqual(['s1']);
  });
});
