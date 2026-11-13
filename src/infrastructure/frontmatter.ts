/**
 * Reads the two things skill-check needs from a SKILL.md frontmatter: `name` and the
 * `metadata` string map. A small YAML subset parser instead of a YAML library keeps the
 * hook bundle small (every hook run loads it) and the plugin free of runtime dependencies.
 *
 * Like YAML's failsafe schema, every scalar is a string ("version: 1.10" stays "1.10").
 * Supported: block mappings, plain / single-quoted / double-quoted scalars (including
 * multi-line), literal and folded block scalars, comments, anchors and tags on scalars, and
 * flow mappings for `metadata`. Lists, nested maps and aliases (`*name`) are not strings and
 * are left out. Frontmatter YAML would reject as a whole reads as empty, as before.
 * tests/unit/infrastructure/frontmatter.test.ts checks it against the `yaml` package.
 */

export interface SkillFile {
  readonly name: string | null;
  /** The `metadata` map; only string values are kept (as the Agent Skills spec defines it). */
  readonly metadata: Readonly<Record<string, string>>;
}

const EMPTY: SkillFile = { name: null, metadata: {} };

/** Frontmatter YAML would reject as a whole; parseSkillFile then returns EMPTY. */
class InvalidFrontmatter extends Error {}
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

interface Line {
  readonly indent: number;
  readonly text: string;
}

/** A mapping entry: `key: inline` plus the more-indented lines that belong to it. */
interface Entry {
  /** Indentation of the `key:` line. */
  readonly indent: number;
  readonly key: string;
  readonly inline: string;
  readonly children: readonly Line[];
}

function toLines(block: string): Line[] {
  return block.split(/\r?\n/).map((raw) => {
    const text = raw.trimStart();
    return { indent: raw.length - text.length, text };
  });
}

const isBlank = (line: Line) => line.text === '' || line.text.startsWith('#');

/** "key: value" -> ["key", "value"]; "key:" -> ["key", ""]; anything else -> null. */
function splitEntry(text: string): [string, string] | null {
  if (text.startsWith('- ') || text === '-' || text.startsWith('[') || text.startsWith('{')) return null;
  let colon = text.indexOf(': ');
  if (colon === -1 && text.endsWith(':')) colon = text.length - 1;
  if (colon === -1) return null;
  const key = unquoteKey(text.slice(0, colon).trimEnd());
  const inline = text.slice(colon + 1).trim();
  return [key, inline.startsWith('#') ? '' : inline];
}

function unquoteKey(key: string): string {
  const quoted = key.length >= 2 && (key[0] === '"' || key[0] === "'") && key.endsWith(key[0]);
  return quoted ? key.slice(1, -1) : key;
}

/** Splits lines at one indentation level into entries. Returns null if a line there is not `key: ...`. */
function entries(lines: readonly Line[]): Entry[] | null {
  const content = lines.filter((line) => !isBlank(line));
  const level = content[0]?.indent ?? 0;
  const result: { indent: number; key: string; inline: string; children: Line[] }[] = [];
  for (const line of lines) {
    const current = result.at(-1);
    if (line.indent > level || (isBlank(line) && current)) {
      current?.children.push(line);
      continue;
    }
    if (isBlank(line)) continue;
    // A line indented less than the first entry, yet inside this block, is malformed YAML.
    if (line.indent < level) throw new InvalidFrontmatter('uneven indentation');
    const split = splitEntry(line.text);
    if (split === null) return null;
    result.push({ indent: level, key: split[0], inline: split[1], children: [] });
  }
  return result;
}

// Scalars. Each returns the string value, or null when the value is not a string.

function stripComment(text: string): string {
  if (text.startsWith('#')) return '';
  const hash = text.search(/\s#/);
  return (hash === -1 ? text : text.slice(0, hash)).trimEnd();
}

/** YAML line folding: lines join with a space; an empty line becomes a newline. */
function fold(parts: readonly string[]): string {
  let out = '';
  let pendingBreaks = 0;
  for (const part of parts) {
    if (part === '') {
      pendingBreaks++;
      continue;
    }
    if (out !== '') out += pendingBreaks > 0 ? '\n'.repeat(pendingBreaks) : ' ';
    out += part;
    pendingBreaks = 0;
  }
  return out;
}

function plainScalar(inline: string, children: readonly Line[]): string | null {
  const first = stripComment(inline);
  if (first.startsWith('[') || first.startsWith('{') || first.startsWith('*')) return null;
  const rest = children.map((line) => stripComment(line.text));
  return fold([first, ...rest].map((part) => part.trim()));
}

const DOUBLE_QUOTE_ESCAPES: Readonly<Record<string, string>> = {
  '0': '\0', a: '\x07', b: '\b', t: '\t', '\t': '\t', n: '\n', v: '\v', f: '\f', r: '\r', e: '\x1b',
  ' ': ' ', '"': '"', '/': '/', '\\': '\\', N: '\x85', _: '\xa0', L: ' ', P: ' ',
};

/** Unescapes a double-quoted body. YAML rejects an unknown escape. */
function unescapeDouble(body: string): string {
  let out = '';
  for (let i = 0; i < body.length; i++) {
    const char = body.charAt(i);
    if (char !== '\\') {
      out += char;
      continue;
    }
    const next = body.charAt(i + 1);
    const hexLength = ({ x: 2, u: 4, U: 8 } as Record<string, number | undefined>)[next];
    if (hexLength !== undefined) {
      const hex = body.slice(i + 2, i + 2 + hexLength);
      if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length !== hexLength) throw new InvalidFrontmatter('bad hex escape');
      out += String.fromCodePoint(Number.parseInt(hex, 16));
      i += 1 + hexLength;
      continue;
    }
    const escaped = DOUBLE_QUOTE_ESCAPES[next];
    if (escaped === undefined) throw new InvalidFrontmatter(`unknown escape \${next}`);
    out += escaped;
    i++;
  }
  return out;
}

/** Index of the closing quote in `text` (after the opening one), or -1. */
function closingQuote(text: string, quote: string): number {
  for (let i = 1; i < text.length; i++) {
    const char = text.charAt(i);
    if (quote === '"' && char === '\\') i++;
    else if (char === quote) {
      if (quote === "'" && text.charAt(i + 1) === "'") i++;
      else return i;
    }
  }
  return -1;
}

function quotedScalar(inline: string, children: readonly Line[]): string {
  const quote = inline.charAt(0);
  const whole = [inline, ...children.map((line) => line.text)].join('\n');
  const end = closingQuote(whole, quote);
  if (end === -1 || stripComment(whole.slice(end + 1)) !== '') throw new InvalidFrontmatter('bad quoted scalar');
  // Multi-line quoted scalars fold like plain ones, line by line.
  const folded = fold(whole.slice(1, end).split('\n').map((part, i, all) => {
    const start = i === 0 ? part : part.trimStart();
    return i === all.length - 1 ? start : start.trimEnd();
  }));
  return quote === '"' ? unescapeDouble(folded) : folded.replaceAll("''", "'");
}

/** `|`, `>`, with optional chomping (+/-) and indentation indicators. */
function blockScalar(header: string, entry: Entry): string | null {
  const children = entry.children;
  const indicator = /^([|>])([1-9]?)([+-]?)([1-9]?)$/.exec(stripComment(header));
  if (!indicator) throw new InvalidFrontmatter('bad block scalar header');
  const [, style, indentA, chomp, indentB] = indicator;
  const explicit = Number(indentA || indentB || 0);
  const content = children.filter((line) => line.text !== '');
  const base = explicit > 0 ? entry.indent + explicit : (content[0]?.indent ?? 0);
  // Literal lines keep their extra indentation; trailing empty lines are handled by chomping.
  const raw = children.map((line) => (line.text === '' ? '' : ' '.repeat(Math.max(0, line.indent - base)) + line.text));
  let last = raw.length;
  while (last > 0 && raw[last - 1] === '') last--;
  const body = raw.slice(0, last);
  const trailing = raw.length - last;
  let text = style === '|' ? body.join('\n') : foldBlock(body);
  if (text === '') return '';
  if (chomp === '+') text += '\n'.repeat(trailing + 1);
  else if (chomp !== '-') text += '\n';
  return text;
}

/** Folded block scalars join lines with spaces, except around blank or more-indented lines. */
function foldBlock(lines: readonly string[]): string {
  let out = '';
  let previous: string | null = null;
  for (const line of lines) {
    if (previous === null) out = line;
    else {
      const keepBreak = line === '' || previous === '' || line.startsWith(' ') || previous.startsWith(' ');
      out += (keepBreak ? '\n' : ' ') + line;
    }
    previous = line;
  }
  // A blank line between two folded lines stands for one line break, not two.
  return out.replace(/\n(\n+)/g, '$1');
}

/** "&anchor !tag value" -> "value": anchors and tags don't change a failsafe string. */
function withoutProperties(inline: string): string {
  let rest = inline;
  while (rest.startsWith('&') || rest.startsWith('!')) {
    const space = rest.search(/\s/);
    rest = space === -1 ? '' : rest.slice(space).trimStart();
  }
  return rest;
}

function scalar(original: Entry): string | null {
  const entry = { ...original, inline: withoutProperties(original.inline) };
  const first = entry.inline.charAt(0);
  if (first === '|' || first === '>') return blockScalar(entry.inline, entry);
  if (first === '"' || first === "'") return quotedScalar(entry.inline, entry.children);
  if (entry.inline === '') {
    // A key with nothing after it holds a nested block (a mapping or list), or is empty.
    return entry.children.some((line) => !isBlank(line)) ? null : '';
  }
  return plainScalar(entry.inline, entry.children);
}

// The metadata map.

/** Splits the inside of a flow collection at its top-level commas, respecting quotes and nesting. */
function splitFlow(body: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quote = '';
  let depth = 0;
  for (const char of body) {
    if (quote !== '') {
      if (char === quote) quote = '';
    } else if (char === '"' || char === "'") quote = char;
    else if (char === '[' || char === '{') depth++;
    else if (char === ']' || char === '}') depth--;
    else if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter((part) => part !== '');
}

/** "{a: 1, b: "x, y"}" -> entries. Nested values stay unparsed and so are not strings. */
function flowMapping(entry: Entry): Entry[] | null {
  const text = stripComment(entry.inline);
  if (!text.endsWith('}')) throw new InvalidFrontmatter('unclosed flow mapping');
  const result: Entry[] = [];
  for (const part of splitFlow(text.slice(1, -1))) {
    if (part.startsWith('-')) throw new InvalidFrontmatter('block list inside a flow mapping');
    // A bare key ("{a, b: c}") has no value, so it is not a string either.
    const colon = part.endsWith(':') ? part.length - 1 : part.indexOf(': ');
    if (colon === -1) continue;
    const key = unquoteKey(part.slice(0, colon).trimEnd());
    result.push({ indent: entry.indent, key, inline: part.slice(colon + 1).trim(), children: [] });
  }
  return result;
}

function mapItems(entry: Entry): Entry[] | null {
  if (entry.inline.startsWith('{')) return flowMapping(entry);
  return entry.inline === '' ? entries(entry.children) : null;
}

function stringMap(entry: Entry): Record<string, string> | null {
  const items = mapItems(entry);
  if (items === null) return null;
  const map: Record<string, string> = {};
  for (const item of items) {
    const value = scalar(item);
    if (value !== null) map[item.key] = value;
  }
  return map;
}

export function parseSkillFile(text: string): SkillFile {
  try {
    return read(text);
  } catch {
    // InvalidFrontmatter: YAML would reject this frontmatter, so it has no usable data.
    return EMPTY;
  }
}

function read(text: string): SkillFile {
  const match = FRONTMATTER.exec(text);
  if (!match) return EMPTY;
  // Group 1 always takes part in a FRONTMATTER match, so it is a string here.
  const top = entries(toLines(match[1] as string));
  if (top === null) return EMPTY;
  // YAML rejects a mapping with a repeated key; so does this.
  if (new Set(top.map((e) => e.key)).size !== top.length) return EMPTY;

  const nameEntry = top.find((e) => e.key === 'name');
  const metadataEntry = top.find((e) => e.key === 'metadata');
  return {
    name: nameEntry ? scalar(nameEntry) : null,
    metadata: (metadataEntry ? stringMap(metadataEntry) : null) ?? {},
  };
}
