import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { SkillVersionSource } from '../domain/ports.js';
import { METADATA_SOURCE_KEY, METADATA_VERSION_KEY, type InstalledSkill } from '../domain/skill.js';
import type { VersionInfo } from '../domain/status.js';
import type { HttpClient } from './http-client.js';
import { trimTrailingSlashes } from './text.js';

const SPEC_KIT_SKILL = /^speckit[-.]/;
const LATEST_RELEASE_PATH = '/repos/github/spec-kit/releases/latest';
/** Core skills come from Spec Kit's own templates; extensions write `<id>:<file>`, presets `preset:<id>`. */
const CORE_SOURCE = 'templates/';

interface Recorded {
  readonly version: string | null;
  readonly integration: string;
}

async function readJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    const data: unknown = JSON.parse(await readFile(path, 'utf8'));
    return typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/**
 * Spec Kit (github/spec-kit) installs project skills named speckit-*. Since 1.4.2 each skill
 * records the version that generated it in metadata.version; older projects only record it in
 * .specify/integration.json (older still: init-options.json). Only core skills follow Spec Kit
 * releases: extension and preset skills record their own component's version.
 */
export class SpecKitVersionSource implements SkillVersionSource {
  readonly id = 'spec-kit';

  constructor(
    private readonly http: HttpClient,
    private readonly apiBase: string,
  ) {}

  appliesTo(skill: InstalledSkill): boolean {
    return skill.scope === 'project' && SPEC_KIT_SKILL.test(skill.name);
  }

  async resolve(skill: InstalledSkill, timeoutMs: number): Promise<VersionInfo> {
    // <project>/.claude/skills/<name> (Claude Code) or <project>/.agents/skills/<name> (Codex) -> <project>
    const source = skill.metadata[METADATA_SOURCE_KEY];
    if (source !== undefined && !source.startsWith(CORE_SOURCE)) {
      throw new Error('Spec Kit extension or preset skill; only core skills are compared');
    }
    const projectRoot = resolve(skill.directory, '..', '..', '..');
    const recorded = await this.recorded(join(projectRoot, '.specify'));
    // The skill's own record wins: upgrading Spec Kit does not rewrite skills already on disk.
    const installed = text(skill.metadata[METADATA_VERSION_KEY]) ?? recorded.version;
    if (!installed) throw new Error('no Spec Kit version recorded in .specify/');
    const latest = await this.latestRelease(timeoutMs);
    return {
      installed,
      latest,
      updateHint: `Run \`specify self upgrade\`, then \`specify integration upgrade ${recorded.integration}\` in this project.`,
    };
  }

  private async recorded(specifyDir: string): Promise<Recorded> {
    const integration = await readJson(join(specifyDir, 'integration.json'));
    const options = await readJson(join(specifyDir, 'init-options.json'));
    const version = text(integration?.version) ?? text(options?.speckit_version);
    const key = text(integration?.integration) ?? text(options?.integration) ?? text(options?.ai) ?? 'claude';
    return { version, integration: key };
  }

  private async latestRelease(timeoutMs: number): Promise<string> {
    const body = await this.http.getText(`${trimTrailingSlashes(this.apiBase)}${LATEST_RELEASE_PATH}`, timeoutMs, {
      accept: 'application/vnd.github+json',
    });
    const tag = text((JSON.parse(body) as { tag_name?: unknown }).tag_name);
    if (!tag) throw new Error('latest Spec Kit release has no tag');
    return tag;
  }
}
