import { readFile } from 'node:fs/promises';
import type { SkillVersionSource } from '../domain/ports.js';
import type { InstalledSkill } from '../domain/skill.js';
import type { VersionInfo } from '../domain/status.js';
import type { HttpClient } from './http-client.js';
import { trimTrailingSlashes } from './text.js';

/** The fields skill-check reads from an entry in the `npx skills` (vercel-labs/skills) global lock file. */
interface LockEntry {
  readonly source: string;
  readonly sourceType: string;
  readonly ref?: string;
  readonly skillPath?: string;
  readonly skillFolderHash: string;
  readonly updatedAt?: string;
}

const NOT_TRACKED = 'no version information (add metadata.source, or install with npx skills; see https://github.com/louis8408/skill-check#a-skill-shows-as-unknown)';

function isLockEntry(value: unknown): value is LockEntry {
  const entry = value as Partial<LockEntry> | null;
  return typeof entry?.source === 'string' && typeof entry.sourceType === 'string' && typeof entry.skillFolderHash === 'string';
}

/** "skills/x/SKILL.md" -> "skills/x" (as `npx skills` itself does). */
function folderOf(skillPath: string): string {
  const path = skillPath.replaceAll('\\', '/');
  const folder = path.toLowerCase().endsWith('skill.md') ? path.slice(0, -'skill.md'.length) : path;
  return folder.endsWith('/') ? folder.slice(0, -1) : folder;
}

/**
 * Personal skills installed with `npx skills add`: the lock file records the GitHub tree SHA of
 * the skill folder at install time, so a different SHA upstream means the skill changed.
 */
export class SkillsLockVersionSource implements SkillVersionSource {
  readonly id = 'npx-skills';

  constructor(
    private readonly http: HttpClient,
    private readonly apiBase: string,
    private readonly lockPath: string,
  ) {}

  appliesTo(skill: InstalledSkill): boolean {
    return skill.scope === 'personal';
  }

  async resolve(skill: InstalledSkill, timeoutMs: number): Promise<VersionInfo> {
    const entry = await this.entry(skill.name);
    if (entry.sourceType !== 'github' || !entry.skillFolderHash) {
      throw new Error(`installed by npx skills from a ${entry.sourceType} source, which it cannot check`);
    }
    const folder = folderOf(entry.skillPath ?? '');
    const latest = await this.folderHash(entry, folder, timeoutMs);
    const installedOn = entry.updatedAt ? ` (installed ${entry.updatedAt.slice(0, 10)})` : '';
    return {
      installed: `${entry.skillFolderHash.slice(0, 7)}${installedOn}`,
      latest: latest.slice(0, 7),
      updateHint: `Run \`npx skills update ${skill.name}\`.`,
      order: latest === entry.skillFolderHash ? 'same' : 'older',
    };
  }

  private async entry(name: string): Promise<LockEntry> {
    let skills: Record<string, unknown> = {};
    try {
      const data = JSON.parse(await readFile(this.lockPath, 'utf8')) as { skills?: Record<string, unknown> };
      skills = data.skills ?? {};
    } catch {
      // no lock file: not installed by npx skills
    }
    const entry = skills[name];
    if (!isLockEntry(entry)) throw new Error(NOT_TRACKED);
    return entry;
  }

  private async folderHash(entry: LockEntry, folder: string, timeoutMs: number): Promise<string> {
    const ref = encodeURIComponent(entry.ref ?? 'HEAD');
    const url = `${trimTrailingSlashes(this.apiBase)}/repos/${entry.source}/git/trees/${ref}?recursive=1`;
    const tree = JSON.parse(await this.http.getText(url, timeoutMs, { accept: 'application/vnd.github+json' })) as {
      sha?: string;
      tree?: { path?: string; type?: string; sha?: string }[];
    };
    const sha = folder === '' ? tree.sha : tree.tree?.find((item) => item.type === 'tree' && item.path === folder)?.sha;
    if (!sha) throw new Error(`${folder} is no longer in ${entry.source}`);
    return sha;
  }
}
