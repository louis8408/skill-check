import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { installedBySkills, legacySkillsFolderHash, skillsFolderHash } from '../../../src/infrastructure/skills-folder-hash.js';

const text = (path: string, content: string) => ({ path, content: Buffer.from(content, 'utf8') });

// Test vectors from vercel-labs/skills README.md, "Lock File Content Hash".
describe('skillsFolderHash (npx skills computedHash, lock version 2)', () => {
  it('matches the documented vector for no files', () => {
    expect(skillsFolderHash([])).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('matches the documented vector for one SKILL.md', () => {
    expect(skillsFolderHash([text('SKILL.md', '# hi\n')])).toBe('93c36952d8843b33e68ae970ebabcc03e1687c9bb0dd1ecaf357060318952f55');
  });

  it('matches the documented vector for two files, whatever order they arrive in', () => {
    const expected = 'b22c4d22aa319d2924312fa18fcbfedc88fa89c74dbd8f298c683e1caf7b7f24';
    expect(skillsFolderHash([text('SKILL.md', 'a\n'), text('docs/b.md', 'b\n')])).toBe(expected);
    expect(skillsFolderHash([text('docs/b.md', 'b\n'), text('SKILL.md', 'a\n')])).toBe(expected);
  });

  it('turns CRLF into LF in text files', () => {
    expect(skillsFolderHash([text('SKILL.md', '# hi\r\n')])).toBe(skillsFolderHash([text('SKILL.md', '# hi\n')]));
  });

  it('leaves binary files (with a NUL byte) unchanged', () => {
    const binary = Buffer.from([0x00, 0x0d, 0x0a]);
    const asText = Buffer.from([0x00, 0x0a]);
    expect(skillsFolderHash([{ path: 'a.bin', content: binary }])).not.toBe(skillsFolderHash([{ path: 'a.bin', content: asText }]));
  });

  it('sorts by the UTF-8 bytes of the path, not by locale', () => {
    // 'Z' (0x5a) sorts before 'a' (0x61) by bytes; a locale-aware sort puts 'a' first.
    const files = [text('a.md', 'x'), text('Z.md', 'y')];
    const byBytes = skillsFolderHash([text('Z.md', 'y'), text('a.md', 'x')]);
    expect(skillsFolderHash(files)).toBe(byBytes);
  });
});

describe('installedBySkills', () => {
  it('leaves out metadata.json files and .git, __pycache__ and __pypackages__ folders', () => {
    expect(installedBySkills('SKILL.md')).toBe(true);
    expect(installedBySkills('docs/guide.md')).toBe(true);
    expect(installedBySkills('metadata.json')).toBe(false);
    expect(installedBySkills('docs/metadata.json')).toBe(false);
    expect(installedBySkills('.git/config')).toBe(false);
    expect(installedBySkills('scripts/__pycache__/x.pyc')).toBe(false);
    expect(installedBySkills('__pypackages__/a/b.py')).toBe(false);
  });

  it('keeps a file that is only named like an excluded folder', () => {
    expect(installedBySkills('docs/.git')).toBe(true);
  });
});

// Lock version 1 (vercel-labs/skills src/local-lock.ts, computeLegacySkillFolderHash): every
// regular file except under .git/ and node_modules/, sorted with localeCompare, path then
// content with no framing and no line-ending changes.
describe('legacySkillsFolderHash (npx skills computedHash, lock version 1)', () => {
  const sha = (...parts: string[]) => parts.reduce((h, part) => h.update(part), createHash('sha256')).digest('hex');

  it('hashes path then content for each file, sorted with localeCompare', () => {
    expect(legacySkillsFolderHash([text('b.md', 'B'), text('A.md', 'a'), text('SKILL.md', 'x\r\n')])).toBe(sha('A.md', 'a', 'b.md', 'B', 'SKILL.md', 'x\r\n'));
  });

  it('leaves out .git and node_modules folders but keeps metadata.json', () => {
    const files = [text('SKILL.md', 's'), text('.git/HEAD', 'h'), text('lib/node_modules/x.js', 'x'), text('metadata.json', '{}')];
    expect(legacySkillsFolderHash(files)).toBe(sha('metadata.json', '{}', 'SKILL.md', 's'));
  });
});
