import { describe, expect, it } from 'vitest';
import { parseSkillFile } from '../../../src/infrastructure/frontmatter.js';

describe('parseSkillFile', () => {
  it('reads name and the metadata map', () => {
    const text = [
      '---',
      'name: deploy',
      'description: Deploys things',
      'metadata:',
      '  version: 1.4.0',
      '  source: https://github.com/org/repo/tree/main/skills/deploy',
      '---',
      '# Deploy',
    ].join('\n');
    expect(parseSkillFile(text)).toEqual({
      name: 'deploy',
      metadata: { version: '1.4.0', source: 'https://github.com/org/repo/tree/main/skills/deploy' },
    });
  });

  it('keeps version strings exactly (1.10 must not become 1.1)', () => {
    const text = '---\nname: x\nmetadata:\n  version: 1.10\n---\n';
    expect(parseSkillFile(text).metadata.version).toBe('1.10');
  });

  it('handles CRLF line endings', () => {
    const text = '---\r\nname: x\r\nmetadata:\r\n  version: 2.0.0\r\n---\r\nbody';
    expect(parseSkillFile(text).metadata).toEqual({ version: '2.0.0' });
  });

  it('drops non-string metadata values', () => {
    const text = '---\nname: x\nmetadata:\n  version: 1.0.0\n  tags: [a, b]\n  nested:\n    k: v\n---\n';
    expect(parseSkillFile(text).metadata).toEqual({ version: '1.0.0' });
  });

  it('returns empty data when there is no or broken frontmatter', () => {
    expect(parseSkillFile('# just markdown')).toEqual({ name: null, metadata: {} });
    expect(parseSkillFile('---\nname: [unclosed\n---\n')).toEqual({ name: null, metadata: {} });
    expect(parseSkillFile('---\nmetadata: just-a-string\n---\n')).toEqual({ name: null, metadata: {} });
    expect(parseSkillFile('---\n- a list\n---\n')).toEqual({ name: null, metadata: {} });
  });
});
