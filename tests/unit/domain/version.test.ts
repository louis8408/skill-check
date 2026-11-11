import { describe, expect, it } from 'vitest';
import { compareVersions, parseVersion } from '../../../src/domain/version.js';

function cmp(a: string, b: string): number {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  if (!va || !vb) throw new Error(`unparseable: ${a} / ${b}`);
  return compareVersions(va, vb);
}

describe('parseVersion', () => {
  it('parses plain semver', () => {
    expect(parseVersion('1.4.0')).toEqual({ raw: '1.4.0', release: [1, 4, 0], prerelease: null });
  });

  it('strips a leading v and surrounding whitespace', () => {
    expect(parseVersion('  v0.13.1 ')?.release).toEqual([0, 13, 1]);
  });

  it('keeps pre-release identifiers and drops build metadata', () => {
    expect(parseVersion('2.0.0-rc.1+build.5')?.prerelease).toBe('rc.1');
    expect(parseVersion('1.0.0+build.5')?.prerelease).toBeNull();
  });

  it('understands PEP 440 dev versions used by Spec Kit', () => {
    expect(parseVersion('0.13.1.dev0')).toEqual({ raw: '0.13.1.dev0', release: [0, 13, 1], prerelease: 'dev0' });
  });

  it('returns null for things that are not versions', () => {
    expect(parseVersion('')).toBeNull();
    expect(parseVersion('latest')).toBeNull();
    expect(parseVersion('unknown')).toBeNull();
  });
});

describe('compareVersions', () => {
  it('orders release numbers numerically, not lexically', () => {
    expect(cmp('1.10.0', '1.9.0')).toBe(1);
    expect(cmp('0.9', '0.13.1')).toBe(-1);
  });

  it('treats missing trailing parts as zero', () => {
    expect(cmp('1.2', '1.2.0')).toBe(0);
  });

  it('ranks a pre-release below its release', () => {
    expect(cmp('0.13.1.dev0', '0.13.1')).toBe(-1);
    expect(cmp('2.0.0', '2.0.0-rc.1')).toBe(1);
  });

  it('compares pre-release identifiers numerically where both are numbers', () => {
    expect(cmp('1.0.0-rc.10', '1.0.0-rc.9')).toBe(1);
    expect(cmp('1.0.0-alpha', '1.0.0-beta')).toBe(-1);
    expect(cmp('1.0.0-alpha', '1.0.0-alpha.1')).toBe(-1);
  });

  it('ignores the leading v', () => {
    expect(cmp('v1.2.3', '1.2.3')).toBe(0);
  });
});
