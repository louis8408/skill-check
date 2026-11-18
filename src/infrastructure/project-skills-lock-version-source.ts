import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { SkillVersionSource } from '../domain/ports.js';
import type { InstalledSkill } from '../domain/skill.js';
import type { VersionInfo } from '../domain/status.js';
import type { BinaryHttpClient, HttpClient } from './http-client.js';
import { installedBySkills, legacySkillsFolderHash, readSkillFolder, skillsFolderHash, withLfLineEndings, type SkillFile } from './skills-folder-hash.js';
import { folderOf, NOT_TRACKED } from './skills-lock-version-source.js';
import { remaining, trimTrailingSlashes } from './text.js';

const LOCK_FILE = 'skills-lock.json';
const MAX_FILES = 50;
const PARALLEL_FETCHES = 5;
const SYMLINK_MODE = '120000';

/** The fields skill-check reads from an entry in a project's `npx skills` lock file (version 2). */
interface ProjectLockEntry {
  readonly source: string;
  readonly sourceType: string;
  readonly ref?: string;
  readonly skillPath?: string;
  readonly skillName?: string;
  readonly computedHash: string;
}

interface TreeItem {
  readonly path: string;
  readonly type?: string;
  readonly mode?: string;
}

interface Locked {
  readonly version: number;
  readonly entry: ProjectLockEntry;
}

function isEntry(value: unknown): value is ProjectLockEntry {
  const entry = value as Partial<ProjectLockEntry> | null;
  return typeof entry?.source === 'string' && typeof entry.sourceType === 'string' && typeof entry.computedHash === 'string';
}

/** Path segments URL-encoded one by one, so `/` keeps separating them. */
function encodedPath(...parts: string[]): string {
  return parts.flatMap((part) => part.split('/')).filter(Boolean).map(encodeURIComponent).join('/');
}

/**
 * Project skills installed with `npx skills add` (its default since lock version 2). The project's
 * skills-lock.json records a content hash of what was installed; hashing the upstream folder the
 * same way tells whether upstream changed since. Raw file fetches don't count against GitHub's
 * API limit, so each check costs one API call (the repository tree).
 */
export class ProjectSkillsLockVersionSource implements SkillVersionSource {
  readonly id = 'npx-skills';

  constructor(
    private readonly http: HttpClient & BinaryHttpClient,
    private readonly rawBase: string,
    private readonly apiBase: string,
  ) {}

  appliesTo(skill: InstalledSkill): boolean {
    return skill.scope === 'project';
  }

  async resolve(skill: InstalledSkill, timeoutMs: number): Promise<VersionInfo> {
    const deadline = Date.now() + timeoutMs;
    // <project>/.agents/skills/<name> (or .claude/skills/<name>) -> <project>
    const { version, entry } = await this.locked(join(resolve(skill.directory, '..', '..', '..'), LOCK_FILE), skill.name);
    if (version !== 1 && version !== 2) throw new Error(`skills-lock.json version ${version} is not supported`);
    if (entry.skillName) throw new Error('installed under another name (npx skills --rename), so it cannot be compared');
    // Older npx skills versions left skillPath out; the skill could be anywhere in the repository.
    if (entry.skillPath === undefined) throw new Error(`the skills-lock.json entry has no skillPath (run \`npx skills update ${skill.name}\`)`);
    if (entry.sourceType !== 'github') throw new Error(`installed by npx skills from a ${entry.sourceType} source, which it cannot check`);
    if (!entry.computedHash) throw new Error('no content hash in skills-lock.json (run `npx skills install`)');
    const installed = version === 1 ? await this.trustedCopyHash(skill.directory, entry.computedHash) : entry.computedHash;

    const ref = entry.ref ?? 'HEAD';
    const folder = folderOf(entry.skillPath);
    const paths = await this.filesIn(entry.source, ref, folder, deadline);
    const latest = skillsFolderHash(await this.fetchAll(entry.source, ref, folder, paths, deadline));
    return {
      installed: installed.slice(0, 7),
      latest: latest.slice(0, 7),
      updateHint: `Run \`npx skills update ${skill.name}\` in this project.`,
      order: latest === installed ? 'same' : 'older',
    };
  }

  private async locked(lockPath: string, name: string): Promise<Locked> {
    let data: { version?: unknown; skills?: Record<string, unknown> } = {};
    try {
      data = JSON.parse(await readFile(lockPath, 'utf8')) as typeof data;
    } catch {
      // no project lock file: not installed by npx skills
    }
    const entry = data.skills?.[name];
    if (!isEntry(entry)) throw new Error(NOT_TRACKED);
    return { version: Number(data.version), entry };
  }

  /**
   * A version 1 hash covers the installed copy with an older algorithm, so it can't be compared
   * with upstream. As `npx skills` does when it migrates a lock, trust the copy on disk only while
   * it still matches that hash, and use the copy's version 2 hash instead. A copy whose text files
   * Git checked out with CRLF line endings still matches (the version 2 hash ignores CRLF anyway).
   */
  private async trustedCopyHash(directory: string, v1Hash: string): Promise<string> {
    let files: SkillFile[];
    try {
      files = await readSkillFolder(directory);
    } catch {
      throw new Error(NOT_TRACKED);
    }
    const matches = [files, withLfLineEndings(files)].some((copy) => legacySkillsFolderHash(copy) === v1Hash);
    if (!matches) throw new Error('changed since npx skills installed it (edited locally?)');
    return skillsFolderHash(files.filter((file) => installedBySkills(file.path)));
  }

  /** The folder-relative paths of the files the installer would copy from upstream. */
  private async filesIn(repo: string, ref: string, folder: string, deadline: number): Promise<string[]> {
    const url = `${trimTrailingSlashes(this.apiBase)}/repos/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`;
    const body = JSON.parse(await this.http.getText(url, remaining(deadline), { accept: 'application/vnd.github+json' })) as {
      truncated?: boolean;
      tree?: TreeItem[];
    };
    if (body.truncated) throw new Error(`${repo} is too large to list`);
    const items = body.tree ?? [];
    if (folder !== '' && !items.some((item) => item.type === 'tree' && item.path === folder)) {
      throw new Error(`${folder} is no longer in ${repo}`);
    }

    const prefix = folder === '' ? '' : `${folder}/`;
    const where = folder === '' ? repo : folder;
    const inFolder = items.filter((item) => item.path.startsWith(prefix));
    if (inFolder.some((item) => item.mode === SYMLINK_MODE || item.type === 'commit')) {
      throw new Error(`${where} contains a symlink or submodule, which it cannot hash`);
    }
    const paths = inFolder
      .filter((item) => item.type === 'blob')
      .map((item) => item.path.slice(prefix.length))
      .filter(installedBySkills);
    if (paths.length > MAX_FILES) throw new Error(`${where} has more than ${MAX_FILES} files to compare`);
    return paths;
  }

  /** A few files at a time, so a skill with many files doesn't open dozens of connections. */
  private async fetchAll(repo: string, ref: string, folder: string, paths: readonly string[], deadline: number): Promise<SkillFile[]> {
    const batch = paths.slice(0, PARALLEL_FETCHES);
    if (batch.length === 0) return [];
    const fetched = await Promise.all(
      batch.map(async (path) => ({
        path,
        content: await this.http.getBytes(`${trimTrailingSlashes(this.rawBase)}/${repo}/${ref}/${encodedPath(folder, path)}`, remaining(deadline)),
      })),
    );
    return [...fetched, ...(await this.fetchAll(repo, ref, folder, paths.slice(PARALLEL_FETCHES), deadline))];
  }
}
