import type { Clock, SkillCatalog, SkillVersionSource, StatusStore } from '../../../src/domain/ports.js';
import type { InstalledSkill } from '../../../src/domain/skill.js';
import type { StoredStatus, VersionInfo } from '../../../src/domain/status.js';

export function skill(name: string, overrides: Partial<InstalledSkill> = {}): InstalledSkill {
  return { name, directory: `/skills/${name}`, scope: 'personal', metadata: {}, ...overrides };
}

export class FakeCatalog implements SkillCatalog {
  constructor(private readonly skills: InstalledSkill[]) {}
  find(name: string): Promise<InstalledSkill | null> {
    return Promise.resolve(this.skills.find((s) => s.name === name) ?? null);
  }
  list(): Promise<InstalledSkill[]> {
    return Promise.resolve([...this.skills]);
  }
}

export class FakeSource implements SkillVersionSource {
  calls = 0;
  constructor(
    readonly id: string,
    private readonly result: VersionInfo | Error,
    private readonly applies: (s: InstalledSkill) => boolean = () => true,
  ) {}
  appliesTo(s: InstalledSkill): boolean {
    return this.applies(s);
  }
  resolve(): Promise<VersionInfo> {
    this.calls++;
    return this.result instanceof Error ? Promise.reject(this.result) : Promise.resolve(this.result);
  }
}

export class MemoryStore implements StatusStore {
  readonly entries = new Map<string, StoredStatus>();
  get(key: string): Promise<StoredStatus | null> {
    return Promise.resolve(this.entries.get(key) ?? null);
  }
  put(key: string, value: StoredStatus): Promise<void> {
    this.entries.set(key, value);
    return Promise.resolve();
  }
  writes = 0;
  putAll(values: ReadonlyMap<string, StoredStatus>): Promise<void> {
    this.writes++;
    for (const [key, value] of values) this.entries.set(key, value);
    return Promise.resolve();
  }
}

export class FixedClock implements Clock {
  constructor(public time: number) {}
  now(): number {
    return this.time;
  }
}
