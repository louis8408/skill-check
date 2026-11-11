export type SkillScope = 'personal' | 'project';

/** A skill found on disk. `metadata` is the SKILL.md frontmatter `metadata` map (string values only). */
export interface InstalledSkill {
  readonly name: string;
  readonly directory: string;
  readonly scope: SkillScope;
  readonly metadata: Readonly<Record<string, string>>;
}

/** The metadata keys of the convention this tool promotes (see CONVENTION.md). */
export const METADATA_VERSION_KEY = 'version';
export const METADATA_SOURCE_KEY = 'source';
