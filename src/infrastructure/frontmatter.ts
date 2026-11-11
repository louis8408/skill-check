import { parse } from 'yaml';

export interface SkillFile {
  readonly name: string | null;
  /** The `metadata` map; only string values are kept (as the Agent Skills spec defines it). */
  readonly metadata: Readonly<Record<string, string>>;
}

const EMPTY: SkillFile = { name: null, metadata: {} };
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseSkillFile(text: string): SkillFile {
  const match = FRONTMATTER.exec(text);
  if (!match) return EMPTY;

  let data: unknown;
  try {
    // The failsafe schema keeps every scalar a string, so "version: 1.10" stays "1.10".
    data = parse(match[1] ?? '', { schema: 'failsafe' });
  } catch {
    return EMPTY;
  }
  if (!isRecord(data)) return EMPTY;

  const metadata: Record<string, string> = {};
  if (isRecord(data.metadata)) {
    for (const [key, value] of Object.entries(data.metadata)) {
      if (typeof value === 'string') metadata[key] = value;
    }
  }
  return { name: typeof data.name === 'string' ? data.name : null, metadata };
}
