import { trimSlashes, trimTrailingSlashes } from './text.js';

const SKILL_FILE = 'SKILL.md';

function githubRawUrl(path: string, rawBase: string): string {
  const [owner = '', repoWithSuffix = '', kind, ref, ...rest] = trimSlashes(path).split('/');
  const repo = repoWithSuffix.replace(/\.git$/, '');
  if (!owner || !repo) throw new Error(`unsupported source: https://github.com/${path}`);

  if ((kind === 'tree' || kind === 'blob') && ref) {
    const inner = rest.join('/');
    const file = kind === 'blob' ? inner : [inner, SKILL_FILE].filter(Boolean).join('/');
    return `${rawBase}/${owner}/${repo}/${ref}/${file}`;
  }
  return `${rawBase}/${owner}/${repo}/HEAD/${SKILL_FILE}`;
}

/**
 * Turns a `metadata.source` value into the URL of the upstream SKILL.md.
 * GitHub repository, tree and blob URLs map to raw.githubusercontent.com;
 * any other http(s) URL is used directly (appending SKILL.md for folders).
 */
export function rawSkillUrl(source: string, rawBase: string): string {
  let url: URL;
  try {
    url = new URL(source.trim());
  } catch {
    throw new Error(`unsupported source: ${source}`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error(`unsupported source: ${source}`);

  if (url.hostname === 'github.com') return githubRawUrl(url.pathname, trimTrailingSlashes(rawBase));
  if (url.pathname.toLowerCase().endsWith('.md')) return url.toString();
  url.pathname = `${trimTrailingSlashes(url.pathname)}/${SKILL_FILE}`;
  return url.toString();
}
