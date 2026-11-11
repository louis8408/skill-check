import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { SkillVersionSource } from '../domain/ports.js';
import type { InstalledSkill } from '../domain/skill.js';
import type { VersionInfo } from '../domain/status.js';
import type { HttpClient } from './http-client.js';
import { trimTrailingSlashes } from './text.js';

const SPEC_KIT_SKILL = /^speckit[-.]/;
const LATEST_RELEASE_PATH = '/repos/github/spec-kit/releases/latest';

interface RecordedVersion {
  readonly version: string;
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
 * Spec Kit (github/spec-kit) installs project skills named speckit-* and records the
 * version that generated them in .specify/integration.json (older: init-options.json).
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
    // <project>/.claude/skills/<name> -> <project>
    const projectRoot = resolve(skill.directory, '..', '..', '..');
    const recorded = await this.recordedVersion(join(projectRoot, '.specify'));
    const latest = await this.latestRelease(timeoutMs);
    return {
      installed: recorded.version,
      latest,
      updateHint: `Run \`specify self upgrade\`, then \`specify integration upgrade ${recorded.integration}\` in this project.`,
    };
  }

  private async recordedVersion(specifyDir: string): Promise<RecordedVersion> {
    const integration = await readJson(join(specifyDir, 'integration.json'));
    const options = await readJson(join(specifyDir, 'init-options.json'));
    const version = text(integration?.version) ?? text(options?.speckit_version);
    if (!version) throw new Error('no Spec Kit version recorded in .specify/');
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
