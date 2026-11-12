import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SkillVersionSource } from '../domain/ports.js';
import { METADATA_SOURCE_KEY, METADATA_VERSION_KEY, type InstalledSkill } from '../domain/skill.js';
import type { VersionInfo } from '../domain/status.js';
import { compareVersions, parseVersion } from '../domain/version.js';
import { parseSkillFile } from './frontmatter.js';
import type { HttpClient } from './http-client.js';
import { parseGitHubSource, rawSkillUrl, type GitHubSource } from './source-url.js';
import { trimTrailingSlashes } from './text.js';

const MAX_REVISIONS = 30;
const PARALLEL_FETCHES = 5;
const SOURCE_LINE = /^[ \t]+source:[^\n]*\n?/gm;

interface Revision {
  readonly sha: string;
  readonly date: string;
}

/**
 * Compares the text of two SKILL.md copies, ignoring line endings, trailing whitespace and
 * the metadata.source line (people add that line to old copies when adopting the convention).
 */
function sameSkill(a: string, b: string): boolean {
  const normalize = (text: string) => text.replaceAll('\r\n', '\n').replace(SOURCE_LINE, '').trimEnd();
  return normalize(a) === normalize(b);
}

function newerVersion(local: string | undefined, upstream: string | undefined): boolean {
  const l = local === undefined ? null : parseVersion(local);
  const u = upstream === undefined ? null : parseVersion(upstream);
  return l !== null && u !== null && compareVersions(u, l) > 0;
}

function label(version: string | undefined, revision: Revision): string {
  const id = `${revision.sha.slice(0, 7)}, ${revision.date.slice(0, 10)}`;
  return version ? `${version} (${id})` : `${revision.sha.slice(0, 7)} (${revision.date.slice(0, 10)})`;
}

function parseRevisions(body: string): Revision[] {
  const data: unknown = JSON.parse(body);
  if (!Array.isArray(data)) return [];
  return data.flatMap((item: unknown) => {
    const commit = item as { sha?: unknown; commit?: { committer?: { date?: unknown } } };
    const date = commit.commit?.committer?.date;
    return typeof commit.sha === 'string' && typeof date === 'string' ? [{ sha: commit.sha, date }] : [];
  });
}

/**
 * Skills with metadata.source. Prefers version numbers when upstream's is higher; otherwise
 * compares content, and for GitHub sources walks the file's commit history to tell an old copy
 * (outdated) from a locally edited one. This works even when authors never bump the version.
 */
export class SourceVersionSource implements SkillVersionSource {
  readonly id = 'source';

  constructor(
    private readonly http: HttpClient,
    private readonly rawBase: string,
    private readonly apiBase: string,
  ) {}

  /** Only absolute http(s) URLs follow the convention; e.g. Spec Kit writes a relative template path. */
  appliesTo(skill: InstalledSkill): boolean {
    const source = skill.metadata[METADATA_SOURCE_KEY] ?? '';
    return source.startsWith('https://') || source.startsWith('http://');
  }

  async resolve(skill: InstalledSkill, timeoutMs: number): Promise<VersionInfo> {
    const deadline = Date.now() + timeoutMs;
    const source = skill.metadata[METADATA_SOURCE_KEY] ?? '';
    const localVersion = skill.metadata[METADATA_VERSION_KEY];
    const updateHint = `Update it from ${source}.`;

    const upstreamText = await this.http.getText(rawSkillUrl(source, this.rawBase), timeoutMs);
    const upstreamVersion = parseSkillFile(upstreamText).metadata[METADATA_VERSION_KEY];
    if (localVersion && upstreamVersion && newerVersion(localVersion, upstreamVersion)) {
      return { installed: localVersion, latest: upstreamVersion, updateHint };
    }

    const localText = await readFile(join(skill.directory, 'SKILL.md'), 'utf8');
    if (sameSkill(localText, upstreamText)) {
      return { installed: localVersion ?? 'latest', latest: upstreamVersion ?? 'latest', updateHint, order: 'same' };
    }

    const github = parseGitHubSource(source);
    if (!github) throw new Error('local copy differs from upstream and the source has no history to compare');

    const revisions = await this.revisions(github, deadline);
    const match = await this.findRevision(source, revisions, localText, deadline);
    const head = revisions[0];
    if (match === null || head === undefined) throw new Error('local copy matches no recent upstream revision (edited locally?)');
    if (match === head) return { installed: localVersion ?? 'latest', latest: upstreamVersion ?? 'latest', updateHint, order: 'same' };
    return { installed: label(localVersion, match), latest: label(upstreamVersion, head), updateHint, order: 'older' };
  }

  private async revisions(github: GitHubSource, deadline: number): Promise<Revision[]> {
    const ref = github.ref ? `&sha=${encodeURIComponent(github.ref)}` : '';
    const url = `${trimTrailingSlashes(this.apiBase)}/repos/${github.owner}/${github.repo}/commits?path=${encodeURIComponent(github.path)}&per_page=${MAX_REVISIONS}${ref}`;
    return parseRevisions(await this.http.getText(url, remaining(deadline), { accept: 'application/vnd.github+json' }));
  }

  /** Newest first, a few at a time, stopping at the first match (so it is sequential on purpose). */
  private async findRevision(source: string, revisions: readonly Revision[], localText: string, deadline: number): Promise<Revision | null> {
    const batch = revisions.slice(0, PARALLEL_FETCHES);
    if (batch.length === 0) return null;
    const texts = await Promise.all(batch.map((r) => this.http.getText(rawSkillUrl(source, this.rawBase, r.sha), remaining(deadline))));
    const index = texts.findIndex((text) => sameSkill(localText, text));
    if (index >= 0) return batch[index] ?? null;
    return this.findRevision(source, revisions.slice(PARALLEL_FETCHES), localText, deadline);
  }
}

function remaining(deadline: number): number {
  const left = deadline - Date.now();
  if (left <= 0) throw new Error('timed out');
  return left;
}
