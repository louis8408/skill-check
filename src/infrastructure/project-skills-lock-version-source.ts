import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { SkillVersionSource } from '../domain/ports.js';
import type { InstalledSkill } from '../domain/skill.js';
import type { VersionInfo } from '../domain/status.js';
import { parseRevisions, revisionLabel, type Revision } from './github-revisions.js';
import type { BinaryHttpClient, HttpClient } from './http-client.js';
import { installedBySkills, legacySkillsFolderHash, readSkillFolder, skillsFolderHash, withLfLineEndings, type SkillFile } from './skills-folder-hash.js';
import { folderOf, NOT_TRACKED } from './skills-lock-version-source.js';
import { remaining, trimTrailingSlashes } from './text.js';

const LOCK_FILE = 'skills-lock.json';
const MAX_FILES = 50;
/** How many recent upstream versions an untrusted version 1 copy is compared with. */
const MAX_REVISIONS = 30;
const PARALLEL_FETCHES = 5;
const SYMLINK_MODE = '120000';
const NO_MATCHING_VERSION = 'changed since npx skills installed it, and matches no recent upstream version (edited locally?)';

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

/** A version 1 project's installed copy; trusted while it still matches the lock's hash. */
interface InstalledCopy {
  readonly trusted: boolean;
  /** Version 2 hash of the files `npx skills` would have installed. */
  readonly hash: string;
  readonly paths: readonly string[];
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
    const copy = version === 1 ? await this.installedCopy(skill.directory, entry.computedHash) : null;
    const installed = copy?.hash ?? entry.computedHash;

    const ref = entry.ref ?? 'HEAD';
    const folder = folderOf(entry.skillPath);
    const paths = await this.filesIn(entry.source, ref, folder, deadline);
    const latest = skillsFolderHash(await this.fetchAll(entry.source, ref, folder, paths, deadline));
    const updateHint = `Run \`npx skills update ${skill.name}\` in this project.`;
    if (copy && !copy.trusted && latest !== installed) {
      return { ...(await this.byHistory(entry.source, entry.ref, folder, copy, deadline)), updateHint, order: 'older' };
    }
    return { installed: installed.slice(0, 7), latest: latest.slice(0, 7), updateHint, order: latest === installed ? 'same' : 'older' };
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
   * with upstream. As `npx skills` does when it migrates a lock, the copy on disk is trusted while
   * it still matches that hash, and its version 2 hash is used instead. A copy whose text files
   * Git checked out with CRLF line endings still matches (the version 2 hash ignores CRLF anyway).
   * A copy that no longer matches may be an edit, or a different upstream version than the lock
   * records (the lock and the copy drifted apart); upstream history tells which.
   */
  private async installedCopy(directory: string, v1Hash: string): Promise<InstalledCopy> {
    let files: SkillFile[];
    try {
      files = await readSkillFolder(directory);
    } catch {
      throw new Error(NOT_TRACKED);
    }
    const trusted = [files, withLfLineEndings(files)].some((copy) => legacySkillsFolderHash(copy) === v1Hash);
    const installed = files.filter((file) => installedBySkills(file.path));
    return { trusted, hash: skillsFolderHash(installed), paths: installed.map((file) => file.path) };
  }

  /**
   * The older upstream version (from the folder's recent commits) that an untrusted copy is
   * identical to. Each version is fetched with the copy's own file list, so a version that lacks
   * one of those files doesn't match. Newest first, stopping at the first match.
   */
  private async byHistory(repo: string, ref: string | undefined, folder: string, copy: InstalledCopy, deadline: number): Promise<{ installed: string; latest: string }> {
    const branch = ref === undefined ? '' : `&sha=${encodeURIComponent(ref)}`;
    const url = `${trimTrailingSlashes(this.apiBase)}/repos/${repo}/commits?path=${encodeURIComponent(folder)}&per_page=${MAX_REVISIONS}${branch}`;
    const [head, ...older] = parseRevisions(await this.http.getText(url, remaining(deadline), { accept: 'application/vnd.github+json' }));
    if (head === undefined) throw new Error(NO_MATCHING_VERSION);
    const match = await this.firstMatch(repo, folder, copy, older, deadline);
    if (match === null) throw new Error(NO_MATCHING_VERSION);
    return { installed: revisionLabel(match), latest: revisionLabel(head) };
  }

  /** One version at a time (each may fetch several files), stopping at the first match. */
  private async firstMatch(repo: string, folder: string, copy: InstalledCopy, revisions: readonly Revision[], deadline: number): Promise<Revision | null> {
    const [revision, ...rest] = revisions;
    if (revision === undefined) return null;
    if ((await this.hashAt(repo, revision.sha, folder, copy.paths, deadline)) === copy.hash) return revision;
    return this.firstMatch(repo, folder, copy, rest, deadline);
  }

  /** The folder's hash at a commit, or null when one of the files wasn't there yet. */
  private async hashAt(repo: string, sha: string, folder: string, paths: readonly string[], deadline: number): Promise<string | null> {
    try {
      return skillsFolderHash(await this.fetchAll(repo, sha, folder, paths, deadline));
    } catch (error) {
      remaining(deadline); // out of time: report that, not "no match"
      if (error instanceof Error && error.message.startsWith('HTTP 404')) return null;
      throw error;
    }
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
