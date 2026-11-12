export type HookEvent = 'PreToolUse' | 'UserPromptSubmit' | 'SessionStart';

export interface HookInput {
  readonly event: HookEvent;
  readonly sessionId: string;
  readonly cwd: string;
  /** The skill being used, if this event is a skill use. */
  readonly skillName: string | null;
}

const EVENTS: ReadonlySet<string> = new Set(['PreToolUse', 'UserPromptSubmit', 'SessionStart']);
/** A prompt that starts with "/name" followed by whitespace or the end. */
const SLASH_COMMAND = /^\s*\/[\w:.-]+(?:\s|$)/;
const SKILL_TOOL = 'Skill';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/** "/deploy prod" -> "deploy" */
function commandName(value: string): string | null {
  const text = value.trim();
  const body = text.startsWith('/') ? text.slice(1) : text;
  const end = body.search(/\s/);
  const name = end === -1 ? body : body.slice(0, end);
  return name === '' ? null : name;
}

function skillFromToolCall(data: Record<string, unknown>): string | null {
  if (data.tool_name !== SKILL_TOOL || !isRecord(data.tool_input)) return null;
  const input = data.tool_input;
  // `skill` is the documented field; the others guard against future renames.
  const raw = str(input.skill) ?? str(input.name) ?? str(input.command);
  return raw === null ? null : commandName(raw);
}

function skillFromPrompt(data: Record<string, unknown>): string | null {
  const prompt = str(data.prompt);
  return prompt !== null && SLASH_COMMAND.test(prompt) ? commandName(prompt) : null;
}

export function readHookInput(stdin: string): HookInput | null {
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

  let skillName: string | null = null;
  if (event === 'PreToolUse') skillName = skillFromToolCall(data);
  else if (event === 'UserPromptSubmit') skillName = skillFromPrompt(data);
  return { event: event as HookEvent, sessionId, cwd, skillName };
}
