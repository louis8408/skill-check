import type { SkillVersionSource } from '../domain/ports.js';
import { METADATA_SOURCE_KEY, METADATA_VERSION_KEY, type InstalledSkill } from '../domain/skill.js';
import type { VersionInfo } from '../domain/status.js';
import { parseSkillFile } from './frontmatter.js';
import type { HttpClient } from './http-client.js';
import { rawSkillUrl } from './source-url.js';

/** Skills following the convention: compares metadata.version with the version in the SKILL.md at metadata.source. */
export class MetadataVersionSource implements SkillVersionSource {
  readonly id = 'metadata';

  constructor(
    private readonly http: HttpClient,
    private readonly rawBase: string,
  ) {}

  appliesTo(skill: InstalledSkill): boolean {
    return Boolean(skill.metadata[METADATA_VERSION_KEY] && skill.metadata[METADATA_SOURCE_KEY]);
  }

  async resolve(skill: InstalledSkill, timeoutMs: number): Promise<VersionInfo> {
    const installed = skill.metadata[METADATA_VERSION_KEY] ?? '';
    const source = skill.metadata[METADATA_SOURCE_KEY] ?? '';
    const upstream = parseSkillFile(await this.http.getText(rawSkillUrl(source, this.rawBase), timeoutMs));
    const latest = upstream.metadata[METADATA_VERSION_KEY];
    if (!latest) throw new Error('upstream SKILL.md has no metadata.version');
    return { installed, latest, updateHint: `Update it from ${source}.` };
  }
}
