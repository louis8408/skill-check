import { describe, expect, it } from 'vitest';
import { rawSkillUrl } from '../../../src/infrastructure/source-url.js';

const RAW = 'https://raw.githubusercontent.com';

describe('rawSkillUrl', () => {
  it('maps a GitHub tree URL of a skill folder to its raw SKILL.md', () => {
    expect(rawSkillUrl('https://github.com/org/repo/tree/main/skills/deploy', RAW)).toBe(
      'https://raw.githubusercontent.com/org/repo/main/skills/deploy/SKILL.md',
    );
  });

  it('maps a GitHub blob URL of a SKILL.md file', () => {
    expect(rawSkillUrl('https://github.com/org/repo/blob/v2/skills/deploy/SKILL.md', RAW)).toBe(
      'https://raw.githubusercontent.com/org/repo/v2/skills/deploy/SKILL.md',
    );
  });

  it('maps a bare repository URL to SKILL.md at the default branch', () => {
    expect(rawSkillUrl('https://github.com/org/repo', RAW)).toBe('https://raw.githubusercontent.com/org/repo/HEAD/SKILL.md');
    expect(rawSkillUrl('https://github.com/org/repo.git/', RAW)).toBe('https://raw.githubusercontent.com/org/repo/HEAD/SKILL.md');
  });

  it('uses other URLs as-is when they point at a markdown file, else appends SKILL.md', () => {
    expect(rawSkillUrl('https://example.com/skills/deploy/SKILL.md', RAW)).toBe('https://example.com/skills/deploy/SKILL.md');
    expect(rawSkillUrl('https://example.com/skills/deploy/', RAW)).toBe('https://example.com/skills/deploy/SKILL.md');
  });

  it('honours a different raw base (used for tests and GitHub mirrors)', () => {
    expect(rawSkillUrl('https://github.com/org/repo/tree/main/s', 'http://127.0.0.1:9/raw')).toBe('http://127.0.0.1:9/raw/org/repo/main/s/SKILL.md');
  });

  it('rejects things that are not http(s) URLs', () => {
    expect(() => rawSkillUrl('git@github.com:org/repo.git', RAW)).toThrow('unsupported source');
    expect(() => rawSkillUrl('file:///etc/passwd', RAW)).toThrow('unsupported source');
  });
});
