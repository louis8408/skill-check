import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { StatusStore } from '../domain/ports.js';
import type { StoredStatus } from '../domain/status.js';

const SCHEMA = 1;

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

  async put(key: string, value: StoredStatus): Promise<void> {
    const data = await this.load();
    data.entries[key] = value;
    await mkdir(dirname(this.path), { recursive: true });
    // Write then rename so a concurrent reader never sees a half-written file.
    const temp = `${this.path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temp, JSON.stringify(data, null, 2));
    await rename(temp, this.path);
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
