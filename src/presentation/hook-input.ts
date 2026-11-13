import type { Agent } from './config.js';

export type HookEvent = 'PreToolUse' | 'UserPromptSubmit' | 'SessionStart';

export interface HookInput {
  readonly event: HookEvent;
  readonly sessionId: string;
  readonly cwd: string;
  /** The skills being used, if this event is a skill use (several for a Codex prompt naming more than one). */
  readonly skillNames: readonly string[];
}

type HookData = Record<string, unknown>;
/** Finds the skills an event uses. Each agent signals skill use differently. */
type SkillReader = (event: HookEvent, data: HookData) => string[];

const EVENTS: ReadonlySet<string> = new Set(['PreToolUse', 'UserPromptSubmit', 'SessionStart']);

function isRecord(value: unknown): value is HookData {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function unique(values: Iterable<string>): string[] {
  return [...new Set(values)];
}

// Claude Code: skills run through the Skill tool, or are typed as "/name".

/** A prompt that starts with "/name" followed by whitespace or the end. */
const SLASH_COMMAND = /^\s*\/[\w:.-]+(?:\s|$)/;

/** "/deploy prod" -> "deploy" */
function commandName(value: string): string | null {
  const text = value.trim();
  const body = text.startsWith('/') ? text.slice(1) : text;
  const end = body.search(/\s/);
  const name = end === -1 ? body : body.slice(0, end);
  return name === '' ? null : name;
}

function claudeSkillFromToolCall(data: HookData): string | null {
  if (data.tool_name !== 'Skill' || !isRecord(data.tool_input)) return null;
  const input = data.tool_input;
  // `skill` is the documented field; the others guard against future renames.
  const raw = str(input.skill) ?? str(input.name) ?? str(input.command);
  return raw === null ? null : commandName(raw);
}

function claudeSkillFromPrompt(data: HookData): string | null {
  const prompt = str(data.prompt);
  return prompt !== null && SLASH_COMMAND.test(prompt) ? commandName(prompt) : null;
}

const readClaudeSkills: SkillReader = (event, data) => {
  let name: string | null = null;
  if (event === 'PreToolUse') name = claudeSkillFromToolCall(data);
  else if (event === 'UserPromptSubmit') name = claudeSkillFromPrompt(data);
  return name === null ? [] : [name];
};

// Codex: the model opens a skill's SKILL.md with a shell command, or the user mentions it
// as "$name" (Codex then injects the skill itself, without a tool call).

const SKILL_NAME = /^[A-Za-z0-9][\w.-]*$/;
/** Characters that end a path in a shell command: whitespace, quotes and shell operators. */
const SHELL_BREAK = /[\s"'`;|&()<>]+/;
/** "$name", not preceded by a word character or another "$". */
const SKILL_MENTION = /(?<![\w$])\$([A-Za-z0-9][\w.-]*)/g;

/** ".agents/skills/deploy/SKILL.md" (or with backslashes) -> "deploy". */
function skillOfPath(token: string): string | null {
  const parts = token.split(/[\\/]/);
  if (parts.length < 2 || parts.at(-1)?.toLowerCase() !== 'skill.md') return null;
  const folder = String(parts.at(-2));
  return SKILL_NAME.test(folder) ? folder : null;
}

/** Sentence punctuation is not part of a name: "use $deploy." -> "deploy". */
function trimTrailingPunctuation(name: string): string {
  let end = name.length;
  while (end > 0 && (name[end - 1] === '.' || name[end - 1] === '-')) end--;
  return name.slice(0, end);
}

function codexSkillsFromShell(data: HookData): string[] {
  if (data.tool_name !== 'Bash' || !isRecord(data.tool_input)) return [];
  const command = str(data.tool_input.command);
  if (command === null) return [];
  return unique(command.split(SHELL_BREAK).flatMap((token) => skillOfPath(token) ?? []));
}

function codexSkillsFromPrompt(data: HookData): string[] {
  const prompt = str(data.prompt);
  if (prompt === null) return [];
  return unique([...prompt.matchAll(SKILL_MENTION)].map((m) => trimTrailingPunctuation(String(m[1]))));
}

const readCodexSkills: SkillReader = (event, data) => {
  if (event === 'PreToolUse') return codexSkillsFromShell(data);
  if (event === 'UserPromptSubmit') return codexSkillsFromPrompt(data);
  return [];
};

const READERS: Readonly<Record<Agent, SkillReader>> = { claude: readClaudeSkills, codex: readCodexSkills };

export function readHookInput(stdin: string, agent: Agent): HookInput | null {
  let data: unknown;
  try {
    data = JSON.parse(stdin);
  } catch {
    return null;
  }
  if (!isRecord(data)) return null;

  const event = str(data.hook_event_name);
  const sessionId = str(data.session_id);
  const cwd = str(data.cwd);
  if (event === null || !EVENTS.has(event) || sessionId === null || cwd === null) return null;

  const hookEvent = event as HookEvent;
  return { event: hookEvent, sessionId, cwd, skillNames: READERS[agent](hookEvent, data) };
}
