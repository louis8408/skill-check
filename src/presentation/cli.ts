// Process entry point: wires the real process to run() in main.ts and nothing else.
// Covered by tests/integration/hook-end-to-end.test.ts, which runs the bundle as a child process.
import { homedir } from 'node:os';
import { run } from './main.js';

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

await run(process.argv.slice(2), {
  env: process.env,
  home: homedir(),
  cwd: process.cwd(),
  readStdin,
  write: (text) => process.stdout.write(text),
});
