import { appendFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname } from 'node:path';
import { loadConfig, type Config } from './config.js';
import { createApp } from './container.js';
import { runHook } from './hooks.js';
import { formatReport } from './report.js';

const VERSION = '0.2.1';
const USER_AGENT = `skill-check/${VERSION} (+https://github.com/louis8408/skill-check)`;

const HELP = `skill-check ${VERSION}: warns when an agent skill is used while out of date.

Usage:
  skill-check hook               Run as a Claude Code hook (reads hook JSON on stdin).
  skill-check check [--cwd DIR]  Check every skill visible from DIR and print the results.
  skill-check --version
`;

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

async function debugLog(config: Config, line: string): Promise<void> {
  if (!config.debugLog) return;
  await mkdir(dirname(config.debugLog), { recursive: true });
  await appendFile(config.debugLog, `${new Date().toISOString()} ${line}\n`);
}

async function hook(config: Config): Promise<void> {
  // A hook must never break the user's session: every failure ends in silence and exit code 0.
  try {
    const stdin = await readStdin();
    await debugLog(config, stdin.trim());
    const output = await runHook(stdin, createApp(config, USER_AGENT));
    if (output) process.stdout.write(output);
  } catch (error) {
    await debugLog(config, `error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`).catch(() => undefined);
  }
}

async function check(config: Config, args: string[]): Promise<void> {
  const cwdIndex = args.indexOf('--cwd');
  const cwd = cwdIndex >= 0 ? (args[cwdIndex + 1] ?? process.cwd()) : process.cwd();
  const reports = await createApp(config, USER_AGENT).refresh.execute({ cwd });
  process.stdout.write(formatReport(reports));
}

async function main(args: string[]): Promise<void> {
  const config = loadConfig(process.env, homedir());
  const [command, ...rest] = args;
  switch (command) {
    case 'hook':
      return hook(config);
    case 'check':
      return check(config, rest);
    case '--version':
    case '-v':
      process.stdout.write(`${VERSION}\n`);
      return;
    default:
      process.stdout.write(HELP);
  }
}

await main(process.argv.slice(2));
