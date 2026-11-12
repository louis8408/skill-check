import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { InstalledSkill } from '../../src/domain/skill.js';
import { FetchHttpClient } from '../../src/infrastructure/http-client.js';
import { SpecKitVersionSource } from '../../src/infrastructure/spec-kit-version-source.js';
import { FakeWeb, tempDir, writeSkill } from './helpers.js';

describe('version sources against a local HTTP server', () => {
  const web = new FakeWeb();
  let root: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    await web.start();
    ({ path: root, cleanup } = await tempDir());
  });
  afterEach(async () => {
    await web.stop();
    await cleanup();
  });

  describe('SpecKitVersionSource', () => {
    async function specKitProject(files: Record<string, string>): Promise<InstalledSkill> {
      const project = join(root, 'proj');
      await mkdir(join(project, '.specify'), { recursive: true });
      await Promise.all(Object.entries(files).map(([name, content]) => writeFile(join(project, '.specify', name), content)));
      const directory = await writeSkill(join(project, '.claude', 'skills'), 'speckit-plan');
      return { name: 'speckit-plan', directory, scope: 'project', metadata: {} };
    }

    it('applies to project skills named speckit-*', () => {
      const source = new SpecKitVersionSource(new FetchHttpClient('t'), 'http://unused');
      expect(source.appliesTo({ name: 'speckit-plan', directory: '/p', scope: 'project', metadata: {} })).toBe(true);
      expect(source.appliesTo({ name: 'speckit-plan', directory: '/p', scope: 'personal', metadata: {} })).toBe(false);
      expect(source.appliesTo({ name: 'deploy', directory: '/p', scope: 'project', metadata: {} })).toBe(false);
    });

    it('compares the project Spec Kit version with the latest GitHub release', async () => {
      web.route('/repos/github/spec-kit/releases/latest', { body: JSON.stringify({ tag_name: 'v0.14.0' }) });
      const skill = await specKitProject({ 'integration.json': JSON.stringify({ version: '0.13.1', integration: 'claude' }) });
      const info = await new SpecKitVersionSource(new FetchHttpClient('t'), web.baseUrl).resolve(skill, 2_000);
      expect(info).toEqual({
        installed: '0.13.1',
        latest: 'v0.14.0',
        updateHint: 'Run `specify self upgrade`, then `specify integration upgrade claude` in this project.',
      });
    });

    it('falls back to init-options.json for older projects', async () => {
      web.route('/repos/github/spec-kit/releases/latest', { body: JSON.stringify({ tag_name: 'v0.14.0' }) });
      const skill = await specKitProject({ 'init-options.json': JSON.stringify({ speckit_version: '0.10.0', ai: 'claude' }) });
      const info = await new SpecKitVersionSource(new FetchHttpClient('t'), web.baseUrl).resolve(skill, 2_000);
      expect(info.installed).toBe('0.10.0');
    });

    it('fails when the project has no Spec Kit version recorded', async () => {
      const skill = await specKitProject({});
      await expect(new SpecKitVersionSource(new FetchHttpClient('t'), web.baseUrl).resolve(skill, 2_000)).rejects.toThrow(
        'no Spec Kit version recorded in .specify/',
      );
    });

    it('treats .specify files that are not JSON objects as missing', async () => {
      const skill = await specKitProject({ 'integration.json': '42', 'init-options.json': 'null' });
      await expect(new SpecKitVersionSource(new FetchHttpClient('t'), web.baseUrl).resolve(skill, 2_000)).rejects.toThrow(
        'no Spec Kit version recorded in .specify/',
      );
    });

    it('defaults the integration to claude when none is recorded', async () => {
      web.route('/repos/github/spec-kit/releases/latest', { body: JSON.stringify({ tag_name: 'v2.0.0' }) });
      const skill = await specKitProject({ 'init-options.json': JSON.stringify({ speckit_version: '1.0.0' }) });
      const info = await new SpecKitVersionSource(new FetchHttpClient('t'), web.baseUrl).resolve(skill, 2_000);
      expect(info.updateHint).toContain('specify integration upgrade claude');
    });

    it('uses the ai key of older init-options.json files', async () => {
      web.route('/repos/github/spec-kit/releases/latest', { body: JSON.stringify({ tag_name: 'v2.0.0' }) });
      const skill = await specKitProject({ 'init-options.json': JSON.stringify({ speckit_version: '1.0.0', ai: 'copilot' }) });
      const info = await new SpecKitVersionSource(new FetchHttpClient('t'), web.baseUrl).resolve(skill, 2_000);
      expect(info.updateHint).toContain('specify integration upgrade copilot');
    });

    it('fails when the latest release has no tag', async () => {
      web.route('/repos/github/spec-kit/releases/latest', { body: JSON.stringify({ name: 'x' }) });
      const skill = await specKitProject({ 'integration.json': JSON.stringify({ version: '1.0.0' }) });
      await expect(new SpecKitVersionSource(new FetchHttpClient('t'), web.baseUrl).resolve(skill, 2_000)).rejects.toThrow(
        'latest Spec Kit release has no tag',
      );
    });

    it('sends a GitHub token to the API when one is configured', async () => {
      web.route('/repos/github/spec-kit/releases/latest', { body: JSON.stringify({ tag_name: 'v1.0.0' }) });
      const skill = await specKitProject({ 'integration.json': JSON.stringify({ version: '1.0.0' }) });
      await new SpecKitVersionSource(new FetchHttpClient('t', { token: 'secret', hosts: ['127.0.0.1'] }), web.baseUrl).resolve(skill, 2_000);
      expect(web.requests[0]?.headers.authorization).toBe('Bearer secret');
    });
  });

  it('FetchHttpClient reports a failed connection clearly', async () => {
    await web.stop();
    await expect(new FetchHttpClient('t').getText(`${web.baseUrl}/x`, 2_000)).rejects.toThrow('request failed: fetch failed');
    await web.start();
  });

  it('FetchHttpClient times out instead of hanging the hook', async () => {
    const { createServer } = await import('node:http');
    const slow = createServer(() => undefined);
    await new Promise<void>((resolve) => slow.listen(0, '127.0.0.1', resolve));
    const address = slow.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    try {
      await expect(new FetchHttpClient('t').getText(`http://127.0.0.1:${port}/`, 200)).rejects.toThrow('timed out after 200 ms');
    } finally {
      slow.closeAllConnections();
      slow.close();
    }
  });
});
