/**
 * A loosely-parsed version: numeric release parts plus an optional pre-release tag.
 * Accepts semver ("1.4.0", "2.0.0-rc.1+build"), a leading "v", and PEP 440 dev
 * versions ("0.13.1.dev0") because skills come from both ecosystems.
 */
export interface Version {
  readonly raw: string;
  readonly release: readonly number[];
  readonly prerelease: string | null;
}

function isDigit(char: string | undefined): boolean {
  return char !== undefined && char >= '0' && char <= '9';
}

/** Length of the leading "1.2.3" part: digits, and dots that are followed by a digit. */
function releaseLength(text: string): number {
  let end = 0;
  while (end < text.length) {
    const char = text[end];
    const dotBeforeDigit = char === '.' && end > 0 && isDigit(text[end + 1]);
    if (!isDigit(char) && !dotBeforeDigit) break;
    end++;
  }
  return end;
}

export function parseVersion(raw: string): Version | null {
  const trimmed = raw.trim();
  const body = trimmed.startsWith('v') || trimmed.startsWith('V') ? trimmed.slice(1) : trimmed;
  const end = releaseLength(body);
  if (end === 0) return null;

  let rest = body.slice(end);
  const build = rest.indexOf('+');
  if (build >= 0) rest = rest.slice(0, build);
  if (rest.startsWith('-') || rest.startsWith('.')) rest = rest.slice(1);
  return {
    raw: trimmed,
    release: body.slice(0, end).split('.').map(Number),
    prerelease: rest === '' ? null : rest,
  };
}

export type Ordering = -1 | 0 | 1;

function sign(n: number): Ordering {
  if (n > 0) return 1;
  if (n < 0) return -1;
  return 0;
}

function compareRelease(a: readonly number[], b: readonly number[]): Ordering {
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return sign(diff);
  }
  return 0;
}

const NUMERIC = /^\d+$/;

function compareIdentifier(a: string, b: string): Ordering {
  const aNumeric = NUMERIC.test(a);
  const bNumeric = NUMERIC.test(b);
  if (aNumeric && bNumeric) return sign(Number(a) - Number(b));
  if (aNumeric) return -1;
  if (bNumeric) return 1;
  return sign(a.localeCompare(b, 'en'));
}

function comparePrerelease(a: string | null, b: string | null): Ordering {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const aParts = a.split('.');
  const bParts = b.split('.');
  const length = Math.min(aParts.length, bParts.length);
  for (let i = 0; i < length; i++) {
    const result = compareIdentifier(aParts[i] ?? '', bParts[i] ?? '');
    if (result !== 0) return result;
  }
  return sign(aParts.length - bParts.length);
}

export function compareVersions(a: Version, b: Version): Ordering {
  const release = compareRelease(a.release, b.release);
  return release === 0 ? comparePrerelease(a.prerelease, b.prerelease) : release;
}
