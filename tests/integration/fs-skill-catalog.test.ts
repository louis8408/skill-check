import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileSystemSkillCatalog, type SkillLocations } from '../../src/infrastructure/fs-skill-catalog.js';
import { tempDir, writeSkill } from './helpers.js';

const claudeLocations = (configDir: string): SkillLocations => ({
  personalDirs: [join(configDir, 'skills')],
  projectDir: join('.claude', 'skills'),
});

describe('FileSystemSkillCatalog (real file system)', () => {
  let root: string;
  let cleanup: () => Promise<void>;
  let configDir: string;
  let project: string;

  beforeEach(async () => {
    ({ path: root, cleanup } = await tempDir());
    configDir = join(root, 'home', '.claude');
    project = join(root, 'work', 'app');
    await mkdir(join(project, 'src'), { recursive: true });
  });
  afterEach(() => cleanup());

  it('finds personal skills and reads their metadata', async () => {
    await writeSkill(join(configDir, 'skills'), 'deploy', { version: '1.0.0', source: 'https://github.com/o/r' });
    const skill = await new FileSystemSkillCatalog(claudeLocations(configDir)).find('deploy', project);
    expect(skill).toEqual({
      name: 'deploy',
      directory: join(configDir, 'skills', 'deploy'),
      scope: 'personal',
      metadata: { version: '1.0.0', source: 'https://github.com/o/r' },
    });
  });

  it('finds project skills in the working directory or any parent', async () => {
    await writeSkill(join(project, '.claude', 'skills'), 'speckit-plan');
    const skill = await new FileSystemSkillCatalog(claudeLocations(configDir)).find('speckit-plan', join(project, 'src'));
    expect(skill?.scope).toBe('project');
    expect(skill?.directory).toBe(join(project, '.claude', 'skills', 'speckit-plan'));
  });

  it('prefers a personal skill over a project skill with the same name', async () => {
    await writeSkill(join(configDir, 'skills'), 'deploy');
    await writeSkill(join(project, '.claude', 'skills'), 'deploy');
    expect((await new FileSystemSkillCatalog(claudeLocations(configDir)).find('deploy', project))?.scope).toBe('personal');
  });

  it('returns null for missing skills, plugin-namespaced names and path tricks', async () => {
    const catalog = new FileSystemSkillCatalog(claudeLocations(configDir));
    expect(await catalog.find('missing', project)).toBeNull();
    expect(await catalog.find('plugin:skill', project)).toBeNull();
    expect(await catalog.find('../secrets', project)).toBeNull();
  });

  it('lists personal and project skills once each, ignoring folders without SKILL.md', async () => {
    await writeSkill(join(configDir, 'skills'), 'a');
    await writeSkill(join(project, '.claude', 'skills'), 'b');
    await mkdir(join(project, '.claude', 'skills', 'not-a-skill'), { recursive: true });
    const names = (await new FileSystemSkillCatalog(claudeLocations(configDir)).list(join(project, 'src'))).map((s) => `${s.scope}:${s.name}`);
    expect(names.toSorted((a, b) => a.localeCompare(b))).toEqual(['personal:a', 'project:b']);
  });

  it('does not list the personal folder twice when the project lives under the home folder', async () => {
    await writeSkill(join(configDir, 'skills'), 'a');
    const homeProject = join(root, 'home', 'code');
    await mkdir(homeProject, { recursive: true });
    const skills = await new FileSystemSkillCatalog(claudeLocations(configDir)).list(homeProject);
    expect(skills.map((s) => s.name)).toEqual(['a']);
  });

  describe('with Codex locations', () => {
    let codex: SkillLocations;
    beforeEach(() => {
      codex = {
        personalDirs: [join(root, 'home', '.agents', 'skills'), join(root, 'home', '.codex', 'skills')],
        projectDir: join('.agents', 'skills'),
      };
    });

    it('finds skills in every personal folder and in .agents/skills of the project', async () => {
      await writeSkill(join(root, 'home', '.agents', 'skills'), 'from-npx');
      await writeSkill(join(root, 'home', '.codex', 'skills'), 'legacy');
      await writeSkill(join(project, '.agents', 'skills'), 'speckit-plan');
      const catalog = new FileSystemSkillCatalog(codex);
      expect((await catalog.find('from-npx', project))?.scope).toBe('personal');
      expect((await catalog.find('legacy', project))?.scope).toBe('personal');
      expect((await catalog.find('speckit-plan', join(project, 'src')))?.directory).toBe(join(project, '.agents', 'skills', 'speckit-plan'));
    });

    it("skips Codex's bundled .system skills", async () => {
      await writeSkill(join(root, 'home', '.codex', 'skills', '.system'), 'imagegen');
      const names = (await new FileSystemSkillCatalog(codex).list(project)).map((s) => s.name);
      expect(names).toEqual([]);
    });

    it('does not list the personal ~/.agents/skills folder again as a project folder', async () => {
      await writeSkill(join(root, 'home', '.agents', 'skills'), 'a');
      const homeProject = join(root, 'home', 'code');
      await mkdir(homeProject, { recursive: true });
      const skills = await new FileSystemSkillCatalog(codex).list(homeProject);
      expect(skills.map((s) => `${s.scope}:${s.name}`)).toEqual(['personal:a']);
    });
  });
});
