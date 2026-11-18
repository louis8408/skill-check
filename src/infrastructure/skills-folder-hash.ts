import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** A file of a skill folder, with its path relative to the folder (`/`-separated). */
export interface SkillFile {
  readonly path: string;
  readonly content: Uint8Array;
}

const EXCLUDED_FILES = new Set(['metadata.json']);
const EXCLUDED_FOLDERS = new Set(['.git', '__pycache__', '__pypackages__']);
const NUL = 0x00;
const CR = 0x0d;
const LF = 0x0a;

/** Whether `npx skills` copies the file at this folder-relative path when it installs a skill. */
export function installedBySkills(path: string): boolean {
  const parts = path.split('/').filter(Boolean);
  return parts.every((part, index) => (index < parts.length - 1 ? !EXCLUDED_FOLDERS.has(part) : !EXCLUDED_FILES.has(part)));
}

/** Text files (no NUL byte) get CRLF replaced by LF; binary files stay as they are. */
function normalized(content: Uint8Array): Uint8Array {
  if (content.includes(NUL)) return content;
  const out: number[] = [];
  content.forEach((byte, i) => {
    if (!(byte === CR && content[i + 1] === LF)) out.push(byte);
  });
  return Uint8Array.from(out);
}

/**
 * The files with CRLF turned back into LF in text files, undoing what Git's `core.autocrlf` does on
 * Windows when a project that commits its skills is checked out.
 */
export function withLfLineEndings(files: readonly SkillFile[]): SkillFile[] {
  return files.map((file) => ({ path: file.path, content: normalized(file.content) }));
}

/**
 * The `computedHash` that `npx skills` (vercel-labs/skills) records per skill in a project's
 * skills-lock.json (lock version 2), as documented in its README ("Lock File Content Hash"):
 * files sorted by the UTF-8 bytes of their paths, each fed to SHA-256 as path NUL length NUL content.
 */
export function skillsFolderHash(files: readonly SkillFile[]): string {
  const entries = files
    .map((file) => ({ path: Buffer.from(file.path, 'utf8'), content: normalized(file.content) }))
    .sort((a, b) => Buffer.compare(a.path, b.path));
  const hash = createHash('sha256');
  for (const { path, content } of entries) {
    hash.update(path);
    hash.update('\0');
    hash.update(String(content.length));
    hash.update('\0');
    hash.update(content);
  }
  return hash.digest('hex');
}

const LEGACY_EXCLUDED_FOLDERS = new Set(['.git', 'node_modules']);

/**
 * The `computedHash` of lock version 1 (vercel-labs/skills `computeLegacySkillFolderHash`): every
 * file except under .git/ and node_modules/, sorted with localeCompare, each fed to SHA-256 as
 * path then content, with no framing and no line-ending changes. It hashes the installed copy.
 */
export function legacySkillsFolderHash(files: readonly SkillFile[]): string {
  const hash = createHash('sha256');
  files
    .filter((file) => file.path.split('/').slice(0, -1).every((folder) => !LEGACY_EXCLUDED_FOLDERS.has(folder)))
    .toSorted((a, b) => a.path.localeCompare(b.path))
    .forEach((file) => {
      hash.update(file.path);
      hash.update(file.content);
    });
  return hash.digest('hex');
}

/**
 * The regular files under `dir`, with `/`-separated relative paths. Like the v1 hash, it skips
 * symlinks; a v2 hash would follow them, so a skill with symlinks may compare as changed.
 */
export async function readSkillFolder(dir: string, prefix = ''): Promise<SkillFile[]> {
  const entries = await readdir(join(dir, prefix), { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry): Promise<SkillFile[]> => {
      const path = `${prefix}${entry.name}`;
      if (entry.isDirectory()) return readSkillFolder(dir, `${path}/`);
      if (!entry.isFile()) return [];
      return [{ path, content: new Uint8Array(await readFile(join(dir, path))) }];
    }),
  );
  return nested.flat();
}
