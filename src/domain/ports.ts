import type { InstalledSkill } from './skill.js';
import type { StoredStatus, VersionInfo } from './status.js';

/** Finds skills the agent can see from a working directory. */
export interface SkillCatalog {
  find(name: string, cwd: string): Promise<InstalledSkill | null>;
  list(cwd: string): Promise<InstalledSkill[]>;
}

/**
 * Knows the installed and latest version for some kind of skill
 * (e.g. skills following the metadata convention, Spec Kit skills).
 * New ecosystems are supported by adding an implementation, not by editing existing ones.
 */
export interface SkillVersionSource {
  readonly id: string;
  appliesTo(skill: InstalledSkill): boolean;
  /** Rejects when the versions cannot be determined (offline, missing data, ...). */
  resolve(skill: InstalledSkill, timeoutMs: number): Promise<VersionInfo>;
}

/** Remembers statuses between hook runs, keyed by skill directory. */
export interface StatusStore {
  get(key: string): Promise<StoredStatus | null>;
  put(key: string, value: StoredStatus): Promise<void>;
  /** Stores several entries at once (one write), leaving other entries as they are. */
  putAll(values: ReadonlyMap<string, StoredStatus>): Promise<void>;
}

export interface Clock {
  now(): number;
}
