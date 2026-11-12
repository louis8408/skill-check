import { compareVersions, parseVersion } from './version.js';

export type SkillStatus =
  | { readonly kind: 'current'; readonly installed: string; readonly latest: string }
  | { readonly kind: 'outdated'; readonly installed: string; readonly latest: string; readonly updateHint: string }
  | { readonly kind: 'unknown'; readonly reason: string };

/** What a version source reports for one skill. */
export interface VersionInfo {
  readonly installed: string;
  readonly latest: string;
  /** How the user brings the skill up to date, e.g. a command to run. */
  readonly updateHint: string;
  /**
   * Set when the source compared the copies itself (by content or revision) instead of
   * relying on version numbers, which authors often forget to bump.
   */
  readonly order?: 'older' | 'same';
}

export interface StoredStatus {
  readonly status: SkillStatus;
  /** Epoch milliseconds. */
  readonly checkedAt: number;
  /** Sessions already warned about this skill, so each session is warned once. */
  readonly warnedSessions: readonly string[];
}

export function evaluateStatus(info: VersionInfo): SkillStatus {
  if (info.order === 'older') {
    return { kind: 'outdated', installed: info.installed, latest: info.latest, updateHint: info.updateHint };
  }
  if (info.order === 'same') return { kind: 'current', installed: info.installed, latest: info.latest };

  const installed = parseVersion(info.installed);
  const latest = parseVersion(info.latest);
  if (!installed || !latest) {
    return { kind: 'unknown', reason: `cannot compare versions "${info.installed}" and "${info.latest}"` };
  }
  return compareVersions(installed, latest) < 0
    ? { kind: 'outdated', installed: info.installed, latest: info.latest, updateHint: info.updateHint }
    : { kind: 'current', installed: info.installed, latest: info.latest };
}

export function isFresh(entry: StoredStatus, now: number, ttlMs: number): boolean {
  return now - entry.checkedAt <= ttlMs;
}
