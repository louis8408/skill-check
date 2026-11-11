import type { App } from './container.js';
import { readHookInput } from './hook-input.js';

/**
 * Handles one Claude Code hook call. Returns what to print on stdout ('' for nothing).
 * A warning goes both into Claude's context (additionalContext) and to the user (systemMessage).
 */
export async function runHook(stdin: string, app: App): Promise<string> {
  const input = readHookInput(stdin);
  if (!input) return '';

  if (input.event === 'SessionStart') {
    await app.refresh.execute({ cwd: input.cwd });
    return '';
  }
  if (input.skillName === null) return '';

  const warning = await app.checkOnUse.execute({ skillName: input.skillName, cwd: input.cwd, sessionId: input.sessionId });
  if (warning === null) return '';
  return JSON.stringify({
    systemMessage: warning,
    hookSpecificOutput: { hookEventName: input.event, additionalContext: warning },
  });
}
