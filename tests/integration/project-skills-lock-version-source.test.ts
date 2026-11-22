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

    it('trusts a copy whose line endings Git turned into CRLF on checkout (core.autocrlf on Windows)', async () => {
      const v1 = await installCopy({ 'SKILL.md': SKILL, 'logo.bin': 'a\0\r\nb' });
      await writeFile(join(project, '.agents', 'skills', 'pdf', 'SKILL.md'), SKILL.replaceAll('\n', '\r\n'));
      await writeLock({ pdf: entry({ computedHash: v1 }) }, 1);
      web.route(TREE, { body: tree([blob('skills/pdf/SKILL.md'), blob('skills/pdf/logo.bin')]) });
      web.route('/acme/skills/main/skills/pdf/SKILL.md', { body: `${SKILL}More.\n` });
      web.route('/acme/skills/main/skills/pdf/logo.bin', { body: 'a\0\r\nb' });
      expect(await source().resolve(skill(), 2_000)).toMatchObject({ order: 'older' });
    });

    describe('when the installed copy no longer matches the v1 hash', () => {
      const COMMITS = '/repos/acme/skills/commits?path=skills%2Fpdf&per_page=30&sha=main';
      const commit = (sha: string, date: string) => ({ sha, commit: { committer: { date } } });
      const OLD = `${SKILL}Old wording.\n`;
      const NEW = `${SKILL}New wording.\n`;

      async function lockOtherVersion(copy: Record<string, string>): Promise<void> {
        await installCopy(copy);
        await writeLock({ pdf: entry({ computedHash: legacySkillsFolderHash([{ path: 'SKILL.md', content: Buffer.from('something else') }]) }) }, 1);
      }

      it('is current when the copy is already the same as upstream (the lock entry is what is stale)', async () => {
        await lockOtherVersion({ 'SKILL.md': NEW });
        web.route(TREE, { body: tree([blob('skills/pdf/SKILL.md')]) });
        web.route('/acme/skills/main/skills/pdf/SKILL.md', { body: NEW });
        const hash = hashOf({ 'SKILL.md': NEW }).slice(0, 7);
        expect(await source().resolve(skill(), 2_000)).toMatchObject({ installed: hash, latest: hash, order: 'same' });
        expect(web.requests.map((r) => r.url)).not.toContain(COMMITS);
      });

      it('is outdated, naming the upstream commit, when the copy is an older upstream version than the lock says', async () => {
        await lockOtherVersion({ 'SKILL.md': OLD, 'agents/openai.yaml': 'y' });
        web.route(TREE, { body: tree([blob('skills/pdf/SKILL.md'), blob('skills/pdf/agents/openai.yaml')]) });
        web.route('/acme/skills/main/skills/pdf/SKILL.md', { body: NEW });
        web.route('/acme/skills/main/skills/pdf/agents/openai.yaml', { body: 'y' });
        web.route(COMMITS, {
          body: JSON.stringify([commit('95249b0aaaa', '2026-10-07T10:21:22Z'), commit('7739eaebbbb', '2026-09-01T00:00:00Z'), commit('85f83d3cccc', '2026-08-20T10:34:29Z')]),
        });
        web.route('/acme/skills/7739eaebbbb/skills/pdf/SKILL.md', { body: `${SKILL}Middle wording.\n` });
        web.route('/acme/skills/7739eaebbbb/skills/pdf/agents/openai.yaml', { body: 'y' });
        web.route('/acme/skills/85f83d3cccc/skills/pdf/SKILL.md', { body: OLD.replaceAll('\n', '\r\n') });
        web.route('/acme/skills/85f83d3cccc/skills/pdf/agents/openai.yaml', { body: 'y' });
        expect(await source().resolve(skill(), 2_000)).toEqual({
          installed: '85f83d3 (2026-08-20)',
          latest: '95249b0 (2026-10-07)',
          updateHint: 'Run `npx skills update pdf` in this project.',
          order: 'older',
        });
        expect(web.requests.map((r) => r.url)).not.toContain('/acme/skills/95249b0aaaa/skills/pdf/SKILL.md');
      });

      it('skips upstream versions that lack one of the copy\'s files', async () => {
        await lockOtherVersion({ 'SKILL.md': OLD, 'notes.md': 'n' });
        web.route(TREE, { body: tree([blob('skills/pdf/SKILL.md'), blob('skills/pdf/notes.md')]) });
        web.route('/acme/skills/main/skills/pdf/SKILL.md', { body: NEW });
        web.route('/acme/skills/main/skills/pdf/notes.md', { body: 'n' });
        web.route(COMMITS, { body: JSON.stringify([commit('head000', '2026-10-07T00:00:00Z'), commit('old0000', '2026-08-20T00:00:00Z')]) });
        web.route('/acme/skills/old0000/skills/pdf/SKILL.md', { body: OLD });
        await expect(source().resolve(skill(), 2_000)).rejects.toThrow(
          'changed since npx skills installed it, and matches no recent upstream version (edited locally?)',
        );
      });

      it('fails, rather than warning, when the copy matches no recent upstream version (edited locally)', async () => {
        await lockOtherVersion({ 'SKILL.md': `${SKILL}my edit\n` });
        web.route(TREE, { body: tree([blob('skills/pdf/SKILL.md')]) });
        web.route('/acme/skills/main/skills/pdf/SKILL.md', { body: NEW });
        web.route(COMMITS, { body: JSON.stringify([commit('head000', '2026-10-07T00:00:00Z'), commit('old0000', '2026-08-20T00:00:00Z'), { sha: 'no-date' }]) });
        web.route('/acme/skills/old0000/skills/pdf/SKILL.md', { body: OLD });
        await expect(source().resolve(skill(), 2_000)).rejects.toThrow(
          'changed since npx skills installed it, and matches no recent upstream version (edited locally?)',
        );
      });

      it('reports other errors while walking history instead of treating them as no match', async () => {
        await lockOtherVersion({ 'SKILL.md': OLD });
        web.route(TREE, { body: tree([blob('skills/pdf/SKILL.md')]) });
        web.route('/acme/skills/main/skills/pdf/SKILL.md', { body: NEW });
        web.route(COMMITS, { body: JSON.stringify([commit('head000', '2026-10-07T00:00:00Z'), commit('old0000', '2026-08-20T00:00:00Z')]) });
        web.route('/acme/skills/old0000/skills/pdf/SKILL.md', { status: 500, body: 'boom' });
        await expect(source().resolve(skill(), 2_000)).rejects.toThrow('HTTP 500');
      });

      it('reports "timed out", not "no match", when the time budget runs out while walking history', async () => {
        await lockOtherVersion({ 'SKILL.md': OLD });
        const history = JSON.stringify([commit('head000', '2026-10-07T00:00:00Z'), commit('old0000', '2026-08-20T00:00:00Z')]);
        const slow = {
          getText: (url: string) => Promise.resolve(url.includes('/commits?') ? history : tree([blob('skills/pdf/SKILL.md')])),
          getBytes: async (url: string) => {
            if (url.includes('old0000')) {
              await new Promise((resolve) => setTimeout(resolve, 60));
              throw new Error(`HTTP 404 for ${url}`);
            }
            return Buffer.from(NEW);
          },
        };
        await expect(new ProjectSkillsLockVersionSource(slow, 'http://raw', 'http://api').resolve(skill(), 30)).rejects.toThrow('timed out');
      });

      it('fails the same way when upstream history is not a list, and leaves out the ref when none is locked', async () => {
        await installCopy({ 'SKILL.md': `${SKILL}my edit\n` });
        await writeLock({ pdf: entry({ ref: undefined, computedHash: 'stale' }) }, 1);
        web.route('/repos/acme/skills/git/trees/HEAD?recursive=1', { body: tree([blob('skills/pdf/SKILL.md')]) });
        web.route('/acme/skills/HEAD/skills/pdf/SKILL.md', { body: NEW });
        web.route('/repos/acme/skills/commits?path=skills%2Fpdf&per_page=30', { body: JSON.stringify({ message: 'Not Found' }) });
        await expect(source().resolve(skill(), 2_000)).rejects.toThrow('matches no recent upstream version (edited locally?)');
      });
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
