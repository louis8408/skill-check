import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { SkillCatalog } from '../domain/ports.js';
import type { InstalledSkill, SkillScope } from '../domain/skill.js';
import { parseSkillFile } from './frontmatter.js';

const SKILL_FILE = 'SKILL.md';
const VALID_NAME = /^[A-Za-z0-9][\w.-]*$/;

interface SkillsRoot {
  readonly path: string;
  readonly scope: SkillScope;
}

/**
 * Claude Code skill locations: personal (<config>/skills) and project
 * (.claude/skills in the working directory or any parent). Personal wins on name clashes.
 * Plugin skills ("plugin:skill") are not covered: Claude Code updates plugins itself.
 */
export class FileSystemSkillCatalog implements SkillCatalog {
  constructor(private readonly configDir: string) {}

  async find(name: string, cwd: string): Promise<InstalledSkill | null> {
    if (!VALID_NAME.test(name)) return null;
    // Read every candidate at once; roots() is in precedence order, so the first hit wins.
    const candidates = await Promise.all(this.roots(cwd).map((root) => this.read(root, name)));
    return candidates.find((skill) => skill !== null) ?? null;
  }

  async list(cwd: string): Promise<InstalledSkill[]> {
    const perRoot = await Promise.all(
      this.roots(cwd).map(async (root) => {
        const names = await this.childFolders(root.path);
        return Promise.all(names.map((name) => this.read(root, name)));
      }),
    );
    return perRoot.flat().filter((skill): skill is InstalledSkill => skill !== null);
  }

  private roots(cwd: string): SkillsRoot[] {
    const personal = resolve(this.configDir, 'skills');
    const roots: SkillsRoot[] = [{ path: personal, scope: 'personal' }];
    let dir = resolve(cwd);
    for (;;) {
      const candidate = join(dir, '.claude', 'skills');
      if (candidate !== personal) roots.push({ path: candidate, scope: 'project' });
      const parent = dirname(dir);
      if (parent === dir) return roots;
      dir = parent;
    }
  }

  private async childFolders(path: string): Promise<string[]> {
    try {
      const entries = await readdir(path, { withFileTypes: true });
      return entries.filter((e) => e.isDirectory() && VALID_NAME.test(e.name)).map((e) => e.name);
    } catch {
      return [];
    }
  }

  private async read(root: SkillsRoot, name: string): Promise<InstalledSkill | null> {
    const directory = join(root.path, name);
    let text: string;
    try {
      text = await readFile(join(directory, SKILL_FILE), 'utf8');
    } catch {
      return null;
    }
    return { name, directory, scope: root.scope, metadata: parseSkillFile(text).metadata };
  }
}
