import { CheckSkillOnUse } from '../application/check-skill-on-use.js';
import { RefreshSkillStatuses } from '../application/refresh-skill-statuses.js';
import { SkillStatusChecker } from '../application/skill-status-checker.js';
import { FileSystemSkillCatalog } from '../infrastructure/fs-skill-catalog.js';
import { FetchHttpClient, GITHUB_HOSTS } from '../infrastructure/http-client.js';
import { JsonFileStatusStore } from '../infrastructure/json-status-store.js';
import { MetadataVersionSource } from '../infrastructure/metadata-version-source.js';
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
  // Order matters: the first source that applies to a skill is used.
  const checker = new SkillStatusChecker([
    new MetadataVersionSource(http, config.githubRaw),
    new SpecKitVersionSource(http, config.githubApi),
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
