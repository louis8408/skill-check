import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { describeError } from '../domain/errors.js';
import { loadConfig, parseAgent, type Config } from './config.js';
import { createApp } from './container.js';
import { runHook } from './hooks.js';
import { formatReport } from './report.js';

export const VERSION = '0.4.1';
const USER_AGENT = `skill-check/${VERSION} (+https://github.com/louis8408/skill-check)`;

const HELP = `skill-check ${VERSION}: warns when an agent skill is used while out of date.

Usage:
  skill-check hook [--agent claude|codex]               Run as a hook (reads hook JSON on stdin).
  skill-check check [--agent claude|codex] [--cwd DIR]  Check every skill visible from DIR and print the results.
  skill-check --version

--agent picks where skills live and how hook input looks: claude (Claude Code, the default) or codex (Codex CLI).
`;

/** Everything the CLI needs from its process, so it can run in tests without one. */
export interface Io {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly home: string;
  readonly cwd: string;
  readStdin(): Promise<string>;
  write(text: string): void;
}

async function debugLog(config: Config, line: string): Promise<void> {
  if (!config.debugLog) return;
  await mkdir(dirname(config.debugLog), { recursive: true });
  await appendFile(config.debugLog, `${new Date().toISOString()} ${line}\n`);
}

async function hook(config: Config, io: Io): Promise<void> {
  // A hook must never break the user's session: every failure ends in silence.
  try {
    const stdin = await io.readStdin();
    await debugLog(config, stdin.trim());
    const output = await runHook(stdin, createApp(config, USER_AGENT), config.agent);
    if (output) io.write(output);
  } catch (error) {
    await debugLog(config, `error: ${describeError(error)}`).catch(() => undefined);
  }
}

async function check(config: Config, args: readonly string[], io: Io): Promise<void> {
  const cwdIndex = args.indexOf('--cwd');
  const cwd = (cwdIndex >= 0 ? args[cwdIndex + 1] : undefined) ?? io.cwd;
  const reports = await createApp(config, USER_AGENT).refresh.execute({ cwd });
  io.write(formatReport(reports));
}

export async function run(args: readonly string[], io: Io): Promise<void> {
  const [command, ...rest] = args;
  const agent = parseAgent(rest);
  if (agent === null) {
    io.write(HELP);
    return;
  }
  const config = loadConfig(io.env, io.home, agent);
  switch (command) {
    case 'hook':
      return hook(config, io);
    case 'check':
      return check(config, rest, io);
    case '--version':
    case '-v':
      io.write(`${VERSION}\n`);
      return;
    default:
      io.write(HELP);
  }
}
