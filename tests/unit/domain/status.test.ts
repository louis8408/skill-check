import { describe, expect, it } from 'vitest';
import { evaluateStatus, isFresh } from '../../../src/domain/status.js';

describe('evaluateStatus', () => {
  it('is outdated when the latest version is newer', () => {
    expect(evaluateStatus({ installed: '0.12.0', latest: 'v0.13.1', updateHint: 'upgrade it' })).toEqual({
      kind: 'outdated',
      installed: '0.12.0',
      latest: 'v0.13.1',
      updateHint: 'upgrade it',
    });
  });

  it('is current when versions are equal', () => {
    expect(evaluateStatus({ installed: '1.0.0', latest: '1.0.0', updateHint: '' }).kind).toBe('current');
  });

  it('is current when the installed version is ahead (e.g. a local dev build)', () => {
    expect(evaluateStatus({ installed: '0.14.0.dev0', latest: '0.13.1', updateHint: '' }).kind).toBe('current');
  });

  it('trusts an order the source worked out itself (content/revision checks, not version numbers)', () => {
    expect(evaluateStatus({ installed: 'a1b2c3d (2026-01-23)', latest: '805687f (2026-04-14)', updateHint: 'h', order: 'older' })).toEqual({
      kind: 'outdated',
      installed: 'a1b2c3d (2026-01-23)',
      latest: '805687f (2026-04-14)',
      updateHint: 'h',
    });
    expect(evaluateStatus({ installed: '1.0.0', latest: '1.0.0', updateHint: '', order: 'same' }).kind).toBe('current');
  });

  it('is unknown when either version cannot be parsed', () => {
    expect(evaluateStatus({ installed: 'unknown', latest: '1.0.0', updateHint: '' })).toEqual({
      kind: 'unknown',
      reason: 'cannot compare versions "unknown" and "1.0.0"',
    });
  });
});

describe('isFresh', () => {
  it('is fresh inside the time-to-live and stale after it', () => {
    const entry = { status: { kind: 'unknown', reason: 'x' } as const, checkedAt: 1_000, warnedSessions: [] };
    expect(isFresh(entry, 1_500, 1_000)).toBe(true);
    expect(isFresh(entry, 2_001, 1_000)).toBe(false);
  });
});
