import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { InstalledSkill } from '../../src/domain/skill.js';
import { FetchHttpClient } from '../../src/infrastructure/http-client.js';
import { ProjectSkillsLockVersionSource } from '../../src/infrastructure/project-skills-lock-version-source.js';
import { legacySkillsFolderHash, readSkillFolder } from '../../src/infrastructure/skills-folder-hash.js';
import { FakeWeb } from './helpers.js';

// Real files, see fixtures/npx-skills-v1-drift/README.md.
const FIXTURE = join(import.meta.dirname, 'fixtures', 'npx-skills-v1-drift');
const SKILL_DIR = join(FIXTURE, 'project', '.agents', 'skills', 'grilling');
const FOLDER = 'skills/productivity/grilling';
const FILES = ['SKILL.md', 'agents/openai.yaml'];
const COMMITS = `/repos/mattpocock/skills/commits?path=${encodeURIComponent(FOLDER)}&per_page=30`;

const upstream = (sha7: string, path: string) => readFile(join(FIXTURE, 'upstream', sha7, path), 'utf8');

describe('npx skills version 1 lock whose copy drifted from the lock (real files from a public project)', () => {
  const web = new FakeWeb();
  const skill: InstalledSkill = { name: 'grilling', directory: SKILL_DIR, scope: 'project', metadata: {} };

  beforeEach(async () => {
    await web.start();
    const commits = JSON.parse(await readFile(join(FIXTURE, 'upstream', 'commits.json'), 'utf8')) as { sha: string }[];
    web.route(COMMITS, { body: JSON.stringify(commits) });
    web.route('/repos/mattpocock/skills/git/trees/HEAD?recursive=1', {
      body: JSON.stringify({
        sha: 'root',
        tree: [{ path: FOLDER, type: 'tree' }, { path: `${FOLDER}/agents`, type: 'tree' }, ...FILES.map((f) => ({ path: `${FOLDER}/${f}`, type: 'blob', mode: '100644' }))],
      }),
    });
    const refs = ['HEAD', ...commits.slice(0, 3).map((c) => c.sha)];
    const routes = await Promise.all(
      refs.flatMap((ref) => FILES.map(async (file) => ({ path: `/mattpocock/skills/${ref}/${FOLDER}/${file}`, body: await upstream(ref === 'HEAD' ? '7739eae' : ref.slice(0, 7), file) }))),
    );
    routes.forEach(({ path, body }) => web.route(path, { body }));
  });
  afterEach(async () => {
    await web.stop();
  });

  it('is a copy that no longer matches its lock hash, which matches a newer upstream version', async () => {
    const lock = JSON.parse(await readFile(join(FIXTURE, 'project', 'skills-lock.json'), 'utf8')) as { skills: { grilling: { computedHash: string } } };
    const hashOf = async (dir: string) => legacySkillsFolderHash(await readSkillFolder(dir));
    expect(await hashOf(SKILL_DIR)).not.toBe(lock.skills.grilling.computedHash);
    expect(await hashOf(join(FIXTURE, 'upstream', '95249b0'))).toBe(lock.skills.grilling.computedHash);
  });

  it('reports it as outdated, naming the upstream version the copy is, instead of "edited locally?"', async () => {
    const source = new ProjectSkillsLockVersionSource(new FetchHttpClient('t'), web.baseUrl, web.baseUrl);
    expect(await source.resolve(skill, 5_000)).toEqual({
      installed: '85f83d3 (2026-08-20)',
      latest: '7739eae (2026-10-29)',
      updateHint: 'Run `npx skills update grilling` in this project.',
      order: 'older',
    });
  });
});
