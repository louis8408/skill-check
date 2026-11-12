import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { InstalledSkill } from '../../src/domain/skill.js';
import { FetchHttpClient } from '../../src/infrastructure/http-client.js';
import { SkillsLockVersionSource } from '../../src/infrastructure/skills-lock-version-source.js';
import { FakeWeb, tempDir } from './helpers.js';

const personal = (name: string): InstalledSkill => ({ name, directory: `/home/.claude/skills/${name}`, scope: 'personal', metadata: {} });

function lockEntry(overrides: Record<string, unknown> = {}) {
  return {
    source: 'vercel-labs/agent-skills',
    sourceType: 'github',
    sourceUrl: 'https://github.com/vercel-labs/agent-skills.git',
    skillPath: 'skills/react-best-practices/SKILL.md',
    skillFolderHash: 'aaaaaaaa11112222',
    installedAt: '2026-01-20T10:00:00.000Z',
    updatedAt: '2026-01-23T10:00:00.000Z',
    ...overrides,
  };
}

const TREE = '/repos/vercel-labs/agent-skills/git/trees/HEAD?recursive=1';
function tree(folderSha: string) {
  return JSON.stringify({ sha: 'root', tree: [{ path: 'skills', type: 'tree', sha: 's' }, { path: 'skills/react-best-practices', type: 'tree', sha: folderSha }] });
}

describe('SkillsLockVersionSource (npx skills lock file) against a local fake GitHub', () => {
  const web = new FakeWeb();
  let root: string;
  let cleanup: () => Promise<void>;
  let lockPath: string;

  async function writeLock(skills: Record<string, unknown>): Promise<void> {
    await mkdir(join(root, '.agents'), { recursive: true });
    await writeFile(lockPath, JSON.stringify({ version: 3, skills }));
  }
  const source = () => new SkillsLockVersionSource(new FetchHttpClient('t'), web.baseUrl, lockPath);

  beforeEach(async () => {
    await web.start();
    ({ path: root, cleanup } = await tempDir());
    lockPath = join(root, '.agents', '.skill-lock.json');
  });
  afterEach(async () => {
    await web.stop();
    await cleanup();
  });

  it('applies to personal skills only', () => {
    expect(source().appliesTo(personal('x'))).toBe(true);
    expect(source().appliesTo({ ...personal('x'), scope: 'project' })).toBe(false);
  });

  it('is outdated when the GitHub folder hash moved on since install', async () => {
    await writeLock({ 'react-best-practices': lockEntry() });
    web.route(TREE, { body: tree('bbbbbbbb33334444') });
    expect(await source().resolve(personal('react-best-practices'), 2_000)).toEqual({
      installed: 'aaaaaaa (installed 2026-01-23)',
      latest: 'bbbbbbb',
      updateHint: 'Run `npx skills update react-best-practices`.',
      order: 'older',
    });
  });

  it('is the same when the folder hash is unchanged, and uses the recorded ref', async () => {
    await writeLock({ 'react-best-practices': lockEntry({ ref: 'v2' }) });
    web.route('/repos/vercel-labs/agent-skills/git/trees/v2?recursive=1', { body: tree('aaaaaaaa11112222') });
    expect(await source().resolve(personal('react-best-practices'), 2_000)).toMatchObject({ order: 'same' });
  });

  it('handles a skill at the repository root, an entry without a date, and a path without SKILL.md', async () => {
    web.route('/repos/acme/one-skill/git/trees/HEAD?recursive=1', { body: JSON.stringify({ sha: 'rootsha1234', tree: [] }) });
    web.route('/repos/acme/many/git/trees/HEAD?recursive=1', { body: tree('aaaaaaaa11112222').replace('skills/react-best-practices', 'skills/x') });
    await writeLock({
      root: lockEntry({ source: 'acme/one-skill', skillPath: undefined, updatedAt: undefined, skillFolderHash: 'oldroot1234' }),
      folder: lockEntry({ source: 'acme/many', skillPath: 'skills/x', updatedAt: undefined }),
    });
    expect(await source().resolve(personal('root'), 2_000)).toMatchObject({ installed: 'oldroot', latest: 'rootsha', order: 'older' });
    expect(await source().resolve(personal('folder'), 2_000)).toMatchObject({ installed: 'aaaaaaa', order: 'same' });
  });

  it('fails clearly when the lock file has no skills map', async () => {
    await mkdir(join(root, '.agents'), { recursive: true });
    await writeFile(lockPath, JSON.stringify({ version: 3 }));
    await expect(source().resolve(personal('mine'), 2_000)).rejects.toThrow('no version information');
  });

  it('fails clearly when the skill was not installed by npx skills', async () => {
    await writeLock({});
    await expect(source().resolve(personal('mine'), 2_000)).rejects.toThrow('no version information (add metadata.source, or install with npx skills)');
  });

  it('fails clearly when there is no lock file or the entry is not from GitHub', async () => {
    await expect(source().resolve(personal('mine'), 2_000)).rejects.toThrow('no version information');
    await writeLock({ mine: lockEntry({ sourceType: 'local', skillFolderHash: '' }) });
    await expect(source().resolve(personal('mine'), 2_000)).rejects.toThrow('installed by npx skills from a local source, which it cannot check');
  });

  it('fails when the folder is no longer in the repository', async () => {
    await writeLock({ 'react-best-practices': lockEntry() });
    web.route(TREE, { body: JSON.stringify({ sha: 'root', tree: [] }) });
    await expect(source().resolve(personal('react-best-practices'), 2_000)).rejects.toThrow('skills/react-best-practices is no longer in vercel-labs/agent-skills');
    web.route(TREE, { body: JSON.stringify({ sha: 'root' }) });
    await expect(source().resolve(personal('react-best-practices'), 2_000)).rejects.toThrow('is no longer in');
  });
});
