import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JsonFileStatusStore } from '../../src/infrastructure/json-status-store.js';
import { tempDir } from './helpers.js';

describe('JsonFileStatusStore (real file system)', () => {
  let root: string;
  let cleanup: () => Promise<void>;
  beforeEach(async () => ({ path: root, cleanup } = await tempDir()));
  afterEach(() => cleanup());

  const entry = { status: { kind: 'current', installed: '1', latest: '1' } as const, checkedAt: 5, warnedSessions: ['s'] };

  it('returns null before anything is stored, creating no file', async () => {
    const store = new JsonFileStatusStore(join(root, 'nested', 'status.json'));
    expect(await store.get('k')).toBeNull();
  });

  it('round-trips entries across instances (i.e. across hook runs)', async () => {
    const path = join(root, 'nested', 'status.json');
    await new JsonFileStatusStore(path).put('k', entry);
    await new JsonFileStatusStore(path).put('other', entry);
    expect(await new JsonFileStatusStore(path).get('k')).toEqual(entry);
    expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({ schema: 1 });
  });

  it('stores many entries in one write and keeps the ones it was not given', async () => {
    const path = join(root, 'status.json');
    await new JsonFileStatusStore(path).put('kept', entry);
    const other = { ...entry, checkedAt: 9 };
    await new JsonFileStatusStore(path).putAll(new Map([['a', entry], ['b', other]]));
    const store = new JsonFileStatusStore(path);
    expect([await store.get('kept'), await store.get('a'), await store.get('b')]).toEqual([entry, entry, other]);
  });

  it('treats a file with another shape (old schema, no entries) as empty', async () => {
    const contents = ['{"schema":1,"entries":null}', '{"schema":0,"entries":{}}', '[]', 'null'];
    const results = await Promise.all(
      contents.map(async (content, i) => {
        const path = join(root, `status-${i}.json`);
        await writeFile(path, content);
        return new JsonFileStatusStore(path).get('k');
      }),
    );
    expect(results).toEqual([null, null, null, null]);
  });

  it('survives concurrent writers from separate hook runs (Windows refuses to replace a file in use)', async () => {
    const path = join(root, 'status.json');
    const writers = Array.from({ length: 8 }, (_, i) => new JsonFileStatusStore(path).put(`k${i}`, entry));
    await Promise.all(writers);
    // Last write wins (each writer read the file before the others wrote), but the file stays valid.
    const stored = JSON.parse(await readFile(path, 'utf8')) as { entries: object };
    expect(Object.keys(stored.entries).length).toBeGreaterThan(0);
    expect((await readdir(root)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('removes its temporary file when the write cannot be completed', async () => {
    const path = join(root, 'status.json');
    await mkdir(path); // a directory where the file should be: every rename fails
    await expect(new JsonFileStatusStore(path).put('k', entry)).rejects.toThrow();
    expect((await readdir(root)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('treats a corrupt file as empty instead of failing the hook', async () => {
    const path = join(root, 'status.json');
    await writeFile(path, '{not json');
    const store = new JsonFileStatusStore(path);
    expect(await store.get('k')).toBeNull();
    await store.put('k', entry);
    expect(await store.get('k')).toEqual(entry);
  });
});
