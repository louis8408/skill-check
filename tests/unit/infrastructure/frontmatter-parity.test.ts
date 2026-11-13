import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { parseSkillFile, type SkillFile } from '../../../src/infrastructure/frontmatter.js';

/**
 * parseSkillFile is a small YAML subset parser. This checks it against the `yaml` package
 * (a dev dependency only), which reads the same frontmatter with the failsafe schema.
 */
function reference(text: string): SkillFile {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  const empty = { name: null, metadata: {} };
  if (!match) return empty;
  let data: unknown;
  try {
    data = parse(match[1] ?? '', { schema: 'failsafe', logLevel: 'error' });
  } catch {
    return empty;
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return empty;
  const record = data as Record<string, unknown>;
  const metadata: Record<string, string> = {};
  const meta = record.metadata;
  if (typeof meta === 'object' && meta !== null && !Array.isArray(meta)) {
    for (const [key, value] of Object.entries(meta)) if (typeof value === 'string') metadata[key] = value;
  }
  return { name: typeof record.name === 'string' ? record.name : null, metadata };
}

const frontmatter = (...lines: string[]) => ['---', ...lines, '---', '# body'].join('\n');

// Shapes seen in real SKILL.md files (anthropics/skills, vercel-labs/agent-skills,
// huggingface/skills, openai/skills, github/awesome-copilot, obra/superpowers, Spec Kit).
const CASES: Record<string, string> = {
  'plain values': frontmatter('name: deploy', 'description: Deploys things', 'metadata:', '  version: 1.4.0', '  source: https://github.com/o/r/tree/main/deploy'),
  'version-like numbers stay strings': frontmatter('name: x', 'metadata:', '  version: 1.10', '  build: 007', '  flag: true'),
  'double-quoted with escapes': frontmatter('name: "deploy"', 'metadata:', '  version: "1.0"', '  note: "a \\"quoted\\" \\u00e9 \\\\ word"'),
  'single-quoted with doubled quotes': frontmatter("name: 'deploy'", 'metadata:', "  author: 'it''s me'", "  source: 'https://x.y/z'"),
  'comments everywhere': frontmatter('# leading comment', 'name: deploy # trailing', 'metadata: # the map', '  # inside', '  version: 2.0.0 # bumped', '  url: https://x.y/#anchor'),
  'quoted values with #': frontmatter('name: x', 'metadata:', '  a: "has # hash"', "  b: 'also # here'"),
  'folded description block': frontmatter('name: deploy', 'description: >', '  Deploys the service', '  to staging.', '', '  Second paragraph.', 'metadata:', '  version: 1.0.0'),
  'literal block with chomping': frontmatter('name: x', 'description: |-', '  line one', '    indented', '  line three', 'metadata:', '  notes: |', '    keep', '    lines', '  keep: |+', '    trailing', '', '  last: x'),
  'block scalar with indentation indicator': frontmatter('name: x', 'metadata:', '  code: |2', '      four spaces in', '    two', '  after: y'),
  'multi-line plain scalar': frontmatter('name: x', 'description: A long', '  description that', '  wraps', 'metadata:', '  version: 1.0.0', '  summary: first', '    second'),
  'multi-line quoted scalar': frontmatter('name: x', 'description: "Use when', '  the user asks"', 'metadata:', "  note: 'one", '', "    two'"),
  'non-string metadata values are dropped': frontmatter('name: x', 'metadata:', '  version: 1.0.0', '  tags: [a, b]', '  list:', '    - a', '    - b', '  nested:', '    k: v', '  empty:'),
  'flow mapping metadata': frontmatter('name: x', 'metadata: {version: "1.2.0", source: https://x.y/z, author: me}'),
  'flow mapping with nested values': frontmatter('name: x', 'metadata: {version: 1.0, tags: [a, b]}'),
  'metadata indented by four': frontmatter('name: x', 'metadata:', '    version: 3.0.0', '    source: s'),
  'other top-level keys of every kind': frontmatter('name: x', 'allowed-tools:', '  - Read', '  - Grep', 'license: Apache-2.0', 'compatibility: "Requires .specify/"', 'metadata:', '  author: "github-spec-kit"', '  source: "templates/commands/plan.md"'),
  'CRLF line endings': '---\r\nname: x\r\nmetadata:\r\n  version: 2.0.0\r\n---\r\nbody',
  'metadata as a string': frontmatter('name: x', 'metadata: just-a-string'),
  'empty name': frontmatter('name:', 'metadata:', '  version: 1'),
  'quoted keys': frontmatter('"name": x', 'metadata:', "  'version': 1.0.0"),
  'key with no space after the colon is a plain value': frontmatter('name: a:b', 'metadata:', '  source: https://x.y'),
  'unknown escape': frontmatter('name: x', 'metadata:', '  bad: "\\q"', '  good: y'),
  'unterminated quote': frontmatter('name: "x', 'metadata:', '  version: 1'),
  'text after a closing quote': frontmatter('name: "x" y', 'metadata:', '  version: 1'),
  'duplicate keys': frontmatter('name: x', 'name: y'),
  'a list at the top': frontmatter('- a list'),
  'broken flow sequence': frontmatter('name: [unclosed'),
  'folded metadata values': frontmatter('name: x', 'metadata:', '  summary: >', '    one', '    two', '', '    three', '      indented', '    four', '  clip: >-', '    a', '    b'),
  'literal blocks: strip, keep, indicator after chomping, blank lines inside': frontmatter('name: x', 'metadata:', '  a: |-', '    one', '', '    two', '  b: |-2', '      deep', '  c: |+', '    kept', '', '', '  d: |', '', '  e: >', '    x'),
  'block scalar with a bad header': frontmatter('name: x', 'metadata:', '  a: |x', '    y', '  b: ok'),
  'hex and unicode escapes': frontmatter('name: "\\x41\\u00e9\\U0001F600"', 'metadata:', '  tab: "a\\tb"'),
  'bad hex escape': frontmatter('name: "\\xZZ"'),
  'comment lines inside metadata only': frontmatter('name: x', 'metadata:', '  # nothing yet'),
  'flow mapping with a bare key and a comment': frontmatter('name: x', 'metadata: {a, b: c} # note'),
  'flow mapping that is not closed': frontmatter('name: x', 'metadata: {a: 1'),
  'flow mapping with a list item': frontmatter('name: x', 'metadata: {- a}'),
  'empty flow mapping': frontmatter('name: x', 'metadata: {}'),
  'metadata entries that dedent badly': frontmatter('name: x', 'metadata:', '    a: 1', '  b: 2'),
  'a line that is not an entry': frontmatter('name: x', 'just text'),
  'a key that is only a colon': frontmatter(': x', 'name: y'),
  'anchors and tags on scalars': frontmatter('name: !!str x', 'metadata:', '  a: &anchor v', '  c: !tag v', '  d: &both !tag w', '  e: &empty'),
  'multi-line plain value with a comment line': frontmatter('name: x', 'metadata:', '  summary: first', '    second # tail'),
  'name holding a nested block': frontmatter('name:', '  first: a'),
  'a comment line ends a multi-line plain value': frontmatter('name: x', 'metadata:', '  summary: first', '    # note', '  b: y'),
  'flow mapping key with an empty value': frontmatter('name: x', 'metadata: {a:, b: c}'),
  'no frontmatter': '# just markdown',
  'unclosed frontmatter': '---\nname: x\n',
};

describe('parseSkillFile matches the yaml package', () => {
  for (const [title, text] of Object.entries(CASES)) {
    it(title, () => {
      expect(parseSkillFile(text)).toEqual(reference(text));
    });
  }

  // The one deliberate difference: aliases are not resolved (no SKILL.md in the corpus uses one).
  it('leaves out aliases instead of resolving them', () => {
    const text = frontmatter('name: x', 'metadata:', '  a: &anchor v', '  b: *anchor');
    expect(parseSkillFile(text).metadata).toEqual({ a: 'v' });
    expect(reference(text).metadata).toEqual({ a: 'v', b: 'v' });
  });

  // Set SKILL_CHECK_CORPUS to a folder of cloned skill repositories to compare every SKILL.md in it.
  const corpus = process.env.SKILL_CHECK_CORPUS;
  it.runIf(corpus !== undefined)('agrees on every SKILL.md in SKILL_CHECK_CORPUS', () => {
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory() && entry.name !== '.git' && entry.name !== 'node_modules') walk(path);
        else if (entry.name === 'SKILL.md') files.push(path);
      }
    };
    walk(corpus ?? '');
    const mismatches = files.filter((file) => {
      const text = readFileSync(file, 'utf8');
      return JSON.stringify(parseSkillFile(text)) !== JSON.stringify(reference(text));
    });
    expect(files.length).toBeGreaterThan(0);
    expect(mismatches).toEqual([]);
  });
});
