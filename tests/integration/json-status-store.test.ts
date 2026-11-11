import { readFile, writeFile } from 'node:fs/promises';
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

  it('treats a corrupt file as empty instead of failing the hook', async () => {
    const path = join(root, 'status.json');
    await writeFile(path, '{not json');
    const store = new JsonFileStatusStore(path);
    expect(await store.get('k')).toBeNull();
    await store.put('k', entry);
    expect(await store.get('k')).toEqual(entry);
  });
});
