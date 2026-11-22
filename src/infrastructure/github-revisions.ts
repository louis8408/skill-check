/** A commit from GitHub's list-commits API, newest first. */
export interface Revision {
  readonly sha: string;
  readonly date: string;
}

/** The commits in a list-commits response; anything that isn't one is left out. */
export function parseRevisions(body: string): Revision[] {
  const data: unknown = JSON.parse(body);
  if (!Array.isArray(data)) return [];
  return data.flatMap((item: unknown) => {
    const commit = item as { sha?: unknown; commit?: { committer?: { date?: unknown } } };
    const date = commit.commit?.committer?.date;
    return typeof commit.sha === 'string' && typeof date === 'string' ? [{ sha: commit.sha, date }] : [];
  });
}

/** A short commit id with its date, e.g. `85f83d3 (2026-08-20)`. */
export function revisionLabel(revision: Revision): string {
  return `${revision.sha.slice(0, 7)} (${revision.date.slice(0, 10)})`;
}
