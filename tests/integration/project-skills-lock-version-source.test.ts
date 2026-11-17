import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { InstalledSkill } from '../../src/domain/skill.js';
import { FetchHttpClient } from '../../src/infrastructure/http-client.js';
import { ProjectSkillsLockVersionSource } from '../../src/infrastructure/project-skills-lock-version-source.js';
import { legacySkillsFolderHash, skillsFolderHash } from '../../src/infrastructure/skills-folder-hash.js';
import { FakeWeb, tempDir } from './helpers.js';

const SKILL = '---\nname: pdf\ndescription: d\n---\nUse pdftotext.\n';
const hashOf = (files: Record<string, string | Buffer>) =>
  skillsFolderHash(Object.entries(files).map(([path, content]) => ({ path, content: typeof content === 'string' ? Buffer.from(content) : content })));

function entry(overrides: Record<string, unknown> = {}) {
  return { source: 'acme/skills', sourceType: 'github', ref: 'main', skillPath: 'skills/pdf/SKILL.md', computedHash: hashOf({ 'SKILL.md': SKILL }), ...overrides };
}

type TreeItem = { path: string; type: string; mode?: string };
const TREE = '/repos/acme/skills/git/trees/main?recursive=1';
const blob = (path: string): TreeItem => ({ path, type: 'blob', mode: '100644' });
const tree = (items: TreeItem[]) => JSON.stringify({ sha: 'root', truncated: false, tree: [{ path: 'skills', type: 'tree' }, { path: 'skills/pdf', type: 'tree' }, ...items] });

describe('ProjectSkillsLockVersionSource (npx skills project lock, skills-lock.json) against a local fake GitHub', () => {
  const web = new FakeWeb();
  let root: string;
  let cleanup: () => Promise<void>;
  let project: string;

  const source = () => new ProjectSkillsLockVersionSource(new FetchHttpClient('t'), web.baseUrl, web.baseUrl);
  const skill = (name = 'pdf'): InstalledSkill => ({ name, directory: join(project, '.agents', 'skills', name), scope: 'project', metadata: {} });
  async function writeLock(skills: Record<string, unknown>, version = 2): Promise<void> {
    await writeFile(join(project, 'skills-lock.json'), JSON.stringify({ version, skills }));
  }
  async function installCopy(files: Record<string, string>): Promise<string> {
    await Promise.all(
      Object.entries(files).map(async ([path, content]) => {
        await mkdir(join(project, '.agents', 'skills', 'pdf', path, '..'), { recursive: true });
        await writeFile(join(project, '.agents', 'skills', 'pdf', path), content);
      }),
    );
    return legacySkillsFolderHash(Object.entries(files).map(([path, content]) => ({ path, content: Buffer.from(content) })));
  }

  beforeEach(async () => {
    await web.start();
    ({ path: root, cleanup } = await tempDir());
    project = join(root, 'proj');
    await mkdir(join(project, '.agents', 'skills', 'pdf'), { recursive: true });
  });
  afterEach(async () => {
    await web.stop();
    await cleanup();
  });

  it('applies to project skills only', () => {
    expect(source().appliesTo(skill())).toBe(true);
    expect(source().appliesTo({ ...skill(), scope: 'personal' })).toBe(false);
  });

  it('is current when the upstream folder hashes to the computedHash in skills-lock.json', async () => {
    await writeLock({ pdf: entry() });
    web.route(TREE, { body: tree([blob('skills/pdf/SKILL.md'), blob('README.md')]) });
    web.route('/acme/skills/main/skills/pdf/SKILL.md', { body: SKILL });
    const hash = hashOf({ 'SKILL.md': SKILL }).slice(0, 7);
    expect(await source().resolve(skill(), 2_000)).toEqual({
      installed: hash,
      latest: hash,
      updateHint: 'Run `npx skills update pdf` in this project.',
      order: 'same',
    });
  });

  it('is outdated when the upstream folder changed since install', async () => {
    await writeLock({ pdf: entry() });
    web.route(TREE, { body: tree([blob('skills/pdf/SKILL.md')]) });
    web.route('/acme/skills/main/skills/pdf/SKILL.md', { body: `${SKILL}Also check the page count.\n` });
    expect(await source().resolve(skill(), 2_000)).toMatchObject({
      installed: hashOf({ 'SKILL.md': SKILL }).slice(0, 7),
      latest: hashOf({ 'SKILL.md': `${SKILL}Also check the page count.\n` }).slice(0, 7),
      order: 'older',
    });
  });

  it('hashes every installed file, as bytes, and skips the files the installer leaves out', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d, 0x0a, 0xff]);
    await writeLock({ pdf: entry({ computedHash: hashOf({ 'SKILL.md': SKILL, 'assets/logo.png': png }) }) });
    web.route(TREE, {
      body: tree([blob('skills/pdf/SKILL.md'), { path: 'skills/pdf/assets', type: 'tree' }, blob('skills/pdf/assets/logo.png'), blob('skills/pdf/metadata.json'), blob('skills/pdfx/SKILL.md')]),
    });
    web.route('/acme/skills/main/skills/pdf/SKILL.md', { body: SKILL });
    web.route('/acme/skills/main/skills/pdf/assets/logo.png', { body: png });
    expect(await source().resolve(skill(), 2_000)).toMatchObject({ order: 'same' });
    expect(web.requests.map((r) => r.url)).not.toContain('/acme/skills/main/skills/pdf/metadata.json');
  });

  it('uses HEAD when no ref is locked, and handles a skill at the repository root', async () => {
    await writeLock({ pdf: entry({ ref: undefined, skillPath: 'SKILL.md' }) });
    web.route('/repos/acme/skills/git/trees/HEAD?recursive=1', { body: JSON.stringify({ sha: 'root', tree: [blob('SKILL.md')] }) });
    web.route('/acme/skills/HEAD/SKILL.md', { body: SKILL });
    expect(await source().resolve(skill(), 2_000)).toMatchObject({ order: 'same' });
  });

  it('names the repository when a skill at its root cannot be hashed', async () => {
    await writeLock({ pdf: entry({ skillPath: 'SKILL.md' }) });
    web.route(TREE, { body: JSON.stringify({ sha: 'root', tree: [blob('SKILL.md'), { path: 'link', type: 'blob', mode: '120000' }] }) });
    await expect(source().resolve(skill(), 2_000)).rejects.toThrow('acme/skills contains a symlink or submodule');
    web.route(TREE, { body: JSON.stringify({ sha: 'root', tree: Array.from({ length: 51 }, (_, i) => blob(`f${i}.md`)) }) });
    await expect(source().resolve(skill(), 2_000)).rejects.toThrow('acme/skills has more than 50 files');
  });

  it('encodes refs and paths in URLs', async () => {
    await writeLock({ 'my pdf': entry({ ref: 'release/1.x', skillPath: 'skills/my pdf/SKILL.md' }) });
    web.route('/repos/acme/skills/git/trees/release%2F1.x?recursive=1', {
      body: JSON.stringify({ sha: 'root', tree: [{ path: 'skills/my pdf', type: 'tree' }, blob('skills/my pdf/SKILL.md')] }),
    });
    web.route('/acme/skills/release/1.x/skills/my%20pdf/SKILL.md', { body: SKILL });
    expect(await source().resolve(skill('my pdf'), 2_000)).toMatchObject({ order: 'same' });
  });

  describe('lock version 1 (older projects; its hash covers the installed copy, not upstream)', () => {
    it('trusts the installed copy when it still matches the v1 hash, and compares that copy with upstream', async () => {
      const v1 = await installCopy({ 'SKILL.md': SKILL, 'metadata.json': '{}' });
      await writeLock({ pdf: entry({ computedHash: v1 }) }, 1);
      web.route(TREE, { body: tree([blob('skills/pdf/SKILL.md'), blob('skills/pdf/metadata.json')]) });
      web.route('/acme/skills/main/skills/pdf/SKILL.md', { body: SKILL });
      const hash = hashOf({ 'SKILL.md': SKILL }).slice(0, 7);
      expect(await source().resolve(skill(), 2_000)).toMatchObject({ installed: hash, latest: hash, order: 'same' });
    });

    it('is outdated when upstream changed since the trusted copy was installed', async () => {
      const v1 = await installCopy({ 'SKILL.md': SKILL, 'ref/notes.md': 'n' });
      await writeLock({ pdf: entry({ computedHash: v1 }) }, 1);
      web.route(TREE, { body: tree([blob('skills/pdf/SKILL.md'), blob('skills/pdf/ref/notes.md')]) });
      web.route('/acme/skills/main/skills/pdf/SKILL.md', { body: `${SKILL}More.\n` });
      web.route('/acme/skills/main/skills/pdf/ref/notes.md', { body: 'n' });
      expect(await source().resolve(skill(), 2_000)).toMatchObject({ order: 'older' });
    });

    it('fails, rather than warning, when the installed copy no longer matches the v1 hash', async () => {
      const v1 = await installCopy({ 'SKILL.md': SKILL });
      await writeFile(join(project, '.agents', 'skills', 'pdf', 'SKILL.md'), `${SKILL}my edit\n`);
      await writeLock({ pdf: entry({ computedHash: v1 }) }, 1);
      await expect(source().resolve(skill(), 2_000)).rejects.toThrow('changed since npx skills installed it (edited locally?)');
      expect(web.requests).toEqual([]);
    });

    it('skips symlinks in the installed copy, as the v1 hash did', async () => {
      const v1 = await installCopy({ 'SKILL.md': SKILL });
      await mkdir(join(root, 'elsewhere'), { recursive: true });
      await writeFile(join(root, 'elsewhere', 'x.md'), 'x');
      await symlink(join(root, 'elsewhere'), join(project, '.agents', 'skills', 'pdf', 'linked'), 'junction');
      await writeLock({ pdf: entry({ computedHash: v1 }) }, 1);
      web.route(TREE, { body: tree([blob('skills/pdf/SKILL.md')]) });
      web.route('/acme/skills/main/skills/pdf/SKILL.md', { body: SKILL });
      expect(await source().resolve(skill(), 2_000)).toMatchObject({ order: 'same' });
    });

    it('fails when the v1 entry has no hash or the installed copy is gone', async () => {
      await writeLock({ pdf: entry({ computedHash: '' }) }, 1);
      await expect(source().resolve(skill(), 2_000)).rejects.toThrow('no content hash in skills-lock.json');
      await writeLock({ gone: entry({ computedHash: 'abc' }) }, 1);
      await expect(source().resolve(skill('gone'), 2_000)).rejects.toThrow('no version information');
    });
  });

  it('fails for a lock version it does not know', async () => {
    await writeLock({ pdf: entry() }, 3);
    await expect(source().resolve(skill(), 2_000)).rejects.toThrow('skills-lock.json version 3 is not supported');
  });

  it('fails, rather than hashing the whole repository, when an older lock entry has no skillPath', async () => {
    await writeLock({ pdf: entry({ skillPath: undefined }) });
    await expect(source().resolve(skill(), 2_000)).rejects.toThrow('the skills-lock.json entry has no skillPath (run `npx skills update pdf`)');
    expect(web.requests).toEqual([]);
  });

  it('fails for a skill installed under another name, whose SKILL.md npx skills rewrote', async () => {
    await writeLock({ pdf: entry({ skillName: 'pdf-tools' }) });
    await expect(source().resolve(skill(), 2_000)).rejects.toThrow('installed under another name (npx skills --rename), so it cannot be compared');
  });

  it('fails for sources other than GitHub', async () => {
    await writeLock({ pdf: entry({ sourceType: 'node_modules' }) });
    await expect(source().resolve(skill(), 2_000)).rejects.toThrow('installed by npx skills from a node_modules source, which it cannot check');
  });

  it('fails when the lock has no content hash (an unverified version 1 migration)', async () => {
    await writeLock({ pdf: entry({ computedHash: '' }) });
    await expect(source().resolve(skill(), 2_000)).rejects.toThrow('no content hash in skills-lock.json (run `npx skills install`)');
  });

  it('fails as untracked when the project has no lock file or the skill is not in it', async () => {
    await expect(source().resolve(skill(), 2_000)).rejects.toThrow('no version information');
    await writeLock({ other: entry() });
    await expect(source().resolve(skill(), 2_000)).rejects.toThrow('no version information');
    await writeFile(join(project, 'skills-lock.json'), JSON.stringify({ version: 2 }));
    await expect(source().resolve(skill(), 2_000)).rejects.toThrow('no version information');
    await writeFile(join(project, 'skills-lock.json'), 'not json');
    await expect(source().resolve(skill(), 2_000)).rejects.toThrow('no version information');
  });

  it('fails when the skill folder is gone upstream', async () => {
    await writeLock({ pdf: entry() });
    web.route(TREE, { body: JSON.stringify({ sha: 'root', tree: [blob('README.md')] }) });
    await expect(source().resolve(skill(), 2_000)).rejects.toThrow('skills/pdf is no longer in acme/skills');
  });

  it('fails when the tree is truncated or not a tree', async () => {
    await writeLock({ pdf: entry() });
    web.route(TREE, { body: JSON.stringify({ sha: 'root', truncated: true, tree: [blob('skills/pdf/SKILL.md')] }) });
    await expect(source().resolve(skill(), 2_000)).rejects.toThrow('acme/skills is too large to list');
    web.route(TREE, { body: JSON.stringify({ message: 'Not Found' }) });
    await expect(source().resolve(skill(), 2_000)).rejects.toThrow('skills/pdf is no longer in acme/skills');
  });

  it('fails for folders it cannot hash like the installer: symlinks and submodules', async () => {
    await writeLock({ pdf: entry() });
    web.route(TREE, { body: tree([blob('skills/pdf/SKILL.md'), { path: 'skills/pdf/link', type: 'blob', mode: '120000' }]) });
    await expect(source().resolve(skill(), 2_000)).rejects.toThrow('skills/pdf contains a symlink or submodule, which it cannot hash');
    web.route(TREE, { body: tree([blob('skills/pdf/SKILL.md'), { path: 'skills/pdf/vendor', type: 'commit', mode: '160000' }]) });
    await expect(source().resolve(skill(), 2_000)).rejects.toThrow('contains a symlink or submodule');
  });

  it('fails for folders with too many files to fetch', async () => {
    await writeLock({ pdf: entry() });
    web.route(TREE, { body: tree(Array.from({ length: 51 }, (_, i) => blob(`skills/pdf/f${i}.md`))) });
    await expect(source().resolve(skill(), 2_000)).rejects.toThrow('skills/pdf has more than 50 files to compare');
  });

  it('gives up with "timed out" when the time budget runs out between requests', async () => {
    await writeLock({ pdf: entry() });
    const slow = {
      getText: async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return tree([blob('skills/pdf/SKILL.md')]);
      },
      getBytes: () => Promise.resolve(new Uint8Array()),
    };
    await expect(new ProjectSkillsLockVersionSource(slow, 'http://raw', 'http://api').resolve(skill(), 10)).rejects.toThrow('timed out');
  });
});
