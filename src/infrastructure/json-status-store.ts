import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { StatusStore } from '../domain/ports.js';
import type { StoredStatus } from '../domain/status.js';

const SCHEMA = 1;
/** Windows refuses to replace a file another process has open; such locks last milliseconds. */
const RENAME_ATTEMPTS = 5;
const RENAME_RETRY_MS = 20;

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function replaceFile(from: string, to: string, attempt = 1): Promise<void> {
  try {
    await rename(from, to);
  } catch (error) {
    if (attempt >= RENAME_ATTEMPTS) throw error;
    await pause(RENAME_RETRY_MS * attempt);
    await replaceFile(from, to, attempt + 1);
  }
}

interface FileShape {
  schema: number;
  entries: Record<string, StoredStatus>;
}

/** Stores statuses in one JSON file. A missing or corrupt file counts as empty, never as an error. */
export class JsonFileStatusStore implements StatusStore {
  constructor(private readonly path: string) {}

  async get(key: string): Promise<StoredStatus | null> {
    return (await this.load()).entries[key] ?? null;
  }

  put(key: string, value: StoredStatus): Promise<void> {
    return this.putAll(new Map([[key, value]]));
  }

  async putAll(values: ReadonlyMap<string, StoredStatus>): Promise<void> {
    const data = await this.load();
    for (const [key, value] of values) data.entries[key] = value;
    await mkdir(dirname(this.path), { recursive: true });
    // Write then rename so a concurrent reader never sees a half-written file.
    const temp = `${this.path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, JSON.stringify(data, null, 2));
      await replaceFile(temp, this.path);
    } finally {
      await rm(temp, { force: true });
    }
  }

  private async load(): Promise<FileShape> {
    try {
      const data: unknown = JSON.parse(await readFile(this.path, 'utf8'));
      if (typeof data === 'object' && data !== null && 'schema' in data && data.schema === SCHEMA && 'entries' in data) {
        const entries: unknown = data.entries;
        if (typeof entries === 'object' && entries !== null) {
          return { schema: SCHEMA, entries: entries as Record<string, StoredStatus> };
        }
      }
    } catch {
      // missing or corrupt: start fresh
    }
    return { schema: SCHEMA, entries: {} };
  }
}
