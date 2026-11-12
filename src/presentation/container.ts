import { CheckSkillOnUse } from '../application/check-skill-on-use.js';
import { RefreshSkillStatuses } from '../application/refresh-skill-statuses.js';
import { SkillStatusChecker } from '../application/skill-status-checker.js';
import { FileSystemSkillCatalog } from '../infrastructure/fs-skill-catalog.js';
import { FetchHttpClient, GITHUB_HOSTS } from '../infrastructure/http-client.js';
import { JsonFileStatusStore } from '../infrastructure/json-status-store.js';
import { SkillsLockVersionSource } from '../infrastructure/skills-lock-version-source.js';
import { SourceVersionSource } from '../infrastructure/source-version-source.js';
import { SpecKitVersionSource } from '../infrastructure/spec-kit-version-source.js';
import { SystemClock } from '../infrastructure/system-clock.js';
import type { Config } from './config.js';

export interface App {
  readonly checkOnUse: CheckSkillOnUse;
  readonly refresh: RefreshSkillStatuses;
}

/** Composition root: the only place concrete infrastructure is wired to the application. */
export function createApp(config: Config, userAgent: string): App {
  const http = new FetchHttpClient(userAgent, config.githubToken ? { token: config.githubToken, hosts: GITHUB_HOSTS } : null);
  // Order matters: the first source that applies to a skill is used. A skill that declares
  // metadata.source wins; Spec Kit project skills come next; any other personal skill is
  // looked up in the npx skills lock file.
  const checker = new SkillStatusChecker([
    new SourceVersionSource(http, config.githubRaw, config.githubApi),
    new SpecKitVersionSource(http, config.githubApi),
    new SkillsLockVersionSource(http, config.githubApi, config.skillsLockFile),
  ]);
  const catalog = new FileSystemSkillCatalog(config.configDir);
  const store = new JsonFileStatusStore(config.statusFile);
  const clock = new SystemClock();
  return {
    checkOnUse: new CheckSkillOnUse(catalog, checker, store, clock, {
      ttlMs: config.ttlMs,
      inlineTimeoutMs: config.inlineTimeoutMs,
    }),
    refresh: new RefreshSkillStatuses(catalog, checker, store, clock, { timeoutMs: config.refreshTimeoutMs }),
  };
}
