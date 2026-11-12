import { trimSlashes, trimTrailingSlashes } from './text.js';

const SKILL_FILE = 'SKILL.md';

/** A metadata.source that points into a GitHub repository. */
export interface GitHubSource {
  readonly owner: string;
  readonly repo: string;
  /** Branch, tag or commit; null means the default branch. */
  readonly ref: string | null;
  /** Path of the SKILL.md file inside the repository. */
  readonly path: string;
}

function parseUrl(source: string): URL | null {
  try {
    return new URL(source.trim());
  } catch {
    return null;
  }
}

export function parseGitHubSource(source: string): GitHubSource | null {
  const url = parseUrl(source);
  if (url?.hostname !== 'github.com') return null;

  const [owner = '', repoWithSuffix = '', kind, ref, ...rest] = trimSlashes(url.pathname).split('/');
  const repo = repoWithSuffix.endsWith('.git') ? repoWithSuffix.slice(0, -4) : repoWithSuffix;
  if (!owner || !repo) return null;

  if ((kind === 'tree' || kind === 'blob') && ref) {
    const inner = rest.join('/');
    const path = kind === 'blob' ? inner : [inner, SKILL_FILE].filter(Boolean).join('/');
    return { owner, repo, ref, path };
  }
  return { owner, repo, ref: null, path: SKILL_FILE };
}

/**
 * Turns a `metadata.source` value into the URL of the upstream SKILL.md.
 * GitHub repository, tree and blob URLs map to raw.githubusercontent.com (at `revision`
 * when given, else at the source's ref); any other http(s) URL is used directly
 * (appending SKILL.md for folders).
 */
export function rawSkillUrl(source: string, rawBase: string, revision?: string): string {
  const url = parseUrl(source);
  if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:')) throw new Error(`unsupported source: ${source}`);

  const github = parseGitHubSource(source);
  if (url.hostname === 'github.com') {
    if (!github) throw new Error(`unsupported source: ${source}`);
    const ref = revision ?? github.ref ?? 'HEAD';
    return `${trimTrailingSlashes(rawBase)}/${github.owner}/${github.repo}/${ref}/${github.path}`;
  }
  if (url.pathname.toLowerCase().endsWith('.md')) return url.toString();
  url.pathname = `${trimTrailingSlashes(url.pathname)}/${SKILL_FILE}`;
  return url.toString();
}
