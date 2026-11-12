import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function tempDir(): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const path = await mkdtemp(join(tmpdir(), 'skill-check-'));
  return { path, cleanup: () => rm(path, { recursive: true, force: true }) };
}

export async function writeSkill(skillsDir: string, name: string, metadata: Record<string, string> = {}): Promise<string> {
  const dir = join(skillsDir, name);
  await mkdir(dir, { recursive: true });
  const meta = Object.entries(metadata).map(([k, v]) => `  ${k}: ${v}`);
  const front = ['---', `name: ${name}`, `description: test skill ${name}`, ...(meta.length ? ['metadata:', ...meta] : []), '---', `# ${name}`];
  await writeFile(join(dir, 'SKILL.md'), front.join('\n'));
  return dir;
}

export async function writeSkillText(skillsDir: string, name: string, text: string): Promise<string> {
  const dir = join(skillsDir, name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'SKILL.md'), text);
  return dir;
}

export interface FakeResponse {
  status?: number;
  body: string;
}

/** A local HTTP server standing in for GitHub; records the requests it gets. */
export class FakeWeb {
  readonly requests: { url: string; headers: Record<string, string | string[] | undefined> }[] = [];
  private readonly routes = new Map<string, FakeResponse>();
  private server: Server | null = null;
  baseUrl = '';

  route(path: string, response: FakeResponse): this {
    this.routes.set(path, response);
    return this;
  }

  async start(): Promise<void> {
    this.requests.length = 0;
    this.routes.clear();
    this.server = createServer((req, res) => {
      this.requests.push({ url: req.url ?? '', headers: req.headers });
      const found = this.routes.get(req.url ?? '');
      res.statusCode = found?.status ?? (found ? 200 : 404);
      res.end(found?.body ?? 'not found');
    });
    await new Promise<void>((resolve) => this.server?.listen(0, '127.0.0.1', resolve));
    const { port } = this.server.address() as AddressInfo;
    this.baseUrl = `http://127.0.0.1:${port}`;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (!server) return;
    server.closeAllConnections();
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  }
}
