import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { InstalledSkill } from '../../src/domain/skill.js';
import { FetchHttpClient } from '../../src/infrastructure/http-client.js';
import { SourceVersionSource } from '../../src/infrastructure/source-version-source.js';
import { FakeWeb, tempDir, writeSkillText } from './helpers.js';

const SOURCE = 'https://github.com/org/repo/tree/main/skills/deploy';
const RAW_HEAD = '/org/repo/main/skills/deploy/SKILL.md';
const COMMITS = '/repos/org/repo/commits?path=skills%2Fdeploy%2FSKILL.md&per_page=30&sha=main';

function skillText(version: string, body: string, source: string | null = SOURCE): string {
  return ['---', 'name: deploy', 'description: d', 'metadata:', `  version: "${version}"`, ...(source ? [`  source: ${source}`] : []), '---', body, ''].join('\n');
}

function commit(sha: string, date: string) {
  return { sha, commit: { committer: { date } } };
}

describe('SourceVersionSource (metadata.source) against a local fake GitHub', () => {
  const web = new FakeWeb();
  let root: string;
  let cleanup: () => Promise<void>;
  let source: SourceVersionSource;

  async function installed(text: string, metadata: Record<string, string> = { version: '1.0.0', source: SOURCE }): Promise<InstalledSkill> {
    const directory = await writeSkillText(join(root, 'skills'), 'deploy', text);
    return { name: 'deploy', directory, scope: 'personal', metadata };
  }

  beforeEach(async () => {
    await web.start();
    ({ path: root, cleanup } = await tempDir());
    source = new SourceVersionSource(new FetchHttpClient('t'), web.baseUrl, web.baseUrl);
  });
  afterEach(async () => {
    await web.stop();
    await cleanup();
  });

  it('applies to any skill with metadata.source, with or without a version', () => {
    const skill = (metadata: Record<string, string>): InstalledSkill => ({ name: 'x', directory: '/x', scope: 'personal', metadata });
    expect(source.appliesTo(skill({ source: SOURCE }))).toBe(true);
    expect(source.appliesTo(skill({ version: '1.0.0' }))).toBe(false);
  });

  it('ignores a source that is not an http(s) URL (Spec Kit writes a relative template path there)', () => {
    const skill = (src: string): InstalledSkill => ({ name: 'x', directory: '/x', scope: 'project', metadata: { source: src } });
    expect(source.appliesTo(skill('templates/commands/plan.md'))).toBe(false);
    expect(source.appliesTo(skill('git@github.com:o/r.git'))).toBe(false);
  });

  it('uses version numbers when the upstream version is higher', async () => {
    web.route(RAW_HEAD, { body: skillText('1.2.0', 'new body') });
    const info = await source.resolve(await installed(skillText('1.0.0', 'old body')), 2_000);
    expect(info).toEqual({ installed: '1.0.0', latest: '1.2.0', updateHint: `Update it from ${SOURCE}.` });
  });

  it('is the same when the content matches upstream, ignoring line endings and the source line', async () => {
    web.route(RAW_HEAD, { body: skillText('1.0.0', 'body', null) });
    const local = skillText('1.0.0', 'body').replaceAll('\n', '\r\n');
    expect(await source.resolve(await installed(local), 2_000)).toMatchObject({ order: 'same' });
  });

  it('finds an older upstream revision when the version was never bumped (e.g. vercel-labs/agent-skills)', async () => {
    web.route(RAW_HEAD, { body: skillText('1.0.0', 'body v3') });
    web.route(COMMITS, {
      body: JSON.stringify([commit('ccccccc3333', '2026-04-14T10:00:00Z'), commit('bbbbbbb2222', '2026-03-02T10:00:00Z'), commit('aaaaaaa1111', '2026-01-23T10:00:00Z')]),
    });
    web.route('/org/repo/ccccccc3333/skills/deploy/SKILL.md', { body: skillText('1.0.0', 'body v3') });
    web.route('/org/repo/bbbbbbb2222/skills/deploy/SKILL.md', { body: skillText('1.0.0', 'body v2') });
    web.route('/org/repo/aaaaaaa1111/skills/deploy/SKILL.md', { body: skillText('1.0.0', 'body v1') });

    const info = await source.resolve(await installed(skillText('1.0.0', 'body v2')), 2_000);
    expect(info).toEqual({
      installed: '1.0.0 (bbbbbbb, 2026-03-02)',
      latest: '1.0.0 (ccccccc, 2026-04-14)',
      updateHint: `Update it from ${SOURCE}.`,
      order: 'older',
    });
  });

  it('labels revisions by commit alone when the skill has no version', async () => {
    web.route(RAW_HEAD, { body: '---\nname: deploy\n---\nv2\n' });
    web.route(COMMITS, { body: JSON.stringify([commit('ccccccc3333', '2026-04-14T10:00:00Z'), commit('aaaaaaa1111', '2026-01-23T10:00:00Z')]) });
    web.route('/org/repo/aaaaaaa1111/skills/deploy/SKILL.md', { body: '---\nname: deploy\n---\nv1\n' });
    web.route('/org/repo/ccccccc3333/skills/deploy/SKILL.md', { body: '---\nname: deploy\n---\nv2\n' });
    const info = await source.resolve(await installed('---\nname: deploy\n---\nv1\n', { source: SOURCE }), 2_000);
    expect(info).toMatchObject({ installed: 'aaaaaaa (2026-01-23)', latest: 'ccccccc (2026-04-14)', order: 'older' });
  });

  it('fails when the local copy matches no upstream revision (edited locally)', async () => {
    web.route(RAW_HEAD, { body: skillText('1.0.0', 'upstream') });
    web.route(COMMITS, { body: JSON.stringify([commit('ccccccc3333', '2026-04-14T10:00:00Z')]) });
    web.route('/org/repo/ccccccc3333/skills/deploy/SKILL.md', { body: skillText('1.0.0', 'upstream') });
    await expect(source.resolve(await installed(skillText('1.0.0', 'my edits')), 2_000)).rejects.toThrow(
      'local copy matches no recent upstream revision (edited locally?)',
    );
  });

  it('fails when a non-GitHub source differs, because there is no history to compare', async () => {
    const other = `${web.baseUrl}/elsewhere/deploy/`;
    web.route('/elsewhere/deploy/SKILL.md', { body: skillText('1.0.0', 'changed', other) });
    await expect(source.resolve(await installed(skillText('1.0.0', 'mine', other), { version: '1.0.0', source: other }), 2_000)).rejects.toThrow(
      'local copy differs from upstream and the source has no history to compare',
    );
  });

  it('fails with the HTTP status when the upstream SKILL.md is missing', async () => {
    await expect(source.resolve(await installed(skillText('1.0.0', 'x')), 2_000)).rejects.toThrow('HTTP 404');
  });
});
