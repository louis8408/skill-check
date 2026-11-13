import type { Agent } from './config.js';
import type { App } from './container.js';
import { readHookInput } from './hook-input.js';

/**
 * Handles one hook call from Claude Code or Codex. Returns what to print on stdout ('' for nothing).
 * A warning goes both into the agent's context (additionalContext) and to the user (systemMessage).
 */
export async function runHook(stdin: string, app: App, agent: Agent): Promise<string> {
  const input = readHookInput(stdin, agent);
  if (!input) return '';

  if (input.event === 'SessionStart') {
    await app.refresh.execute({ cwd: input.cwd });
    return '';
  }

  const warnings: string[] = [];
  for (const skillName of input.skillNames) {
    // One at a time: each check may update the shared status file.
    // eslint-disable-next-line no-await-in-loop
    const warning = await app.checkOnUse.execute({ skillName, cwd: input.cwd, sessionId: input.sessionId });
    if (warning !== null) warnings.push(warning);
  }
  if (warnings.length === 0) return '';

  const message = warnings.join('\n');
  return JSON.stringify({
    systemMessage: message,
    hookSpecificOutput: { hookEventName: input.event, additionalContext: message },
  });
}
