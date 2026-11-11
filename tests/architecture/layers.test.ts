import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { cruise, type ICruiseResult, type IConfiguration } from 'dependency-cruiser';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const config = require('../../.dependency-cruiser.cjs') as IConfiguration;
const ROOT = resolve(import.meta.dirname, '..', '..');

async function violations(baseDir: string): Promise<string[]> {
  const result = await cruise(
    ['src'],
    {
      baseDir,
      validate: true,
      ruleSet: { forbidden: config.forbidden ?? [] },
      doNotFollow: { path: 'node_modules' },
      tsPreCompilationDeps: true,
    },
    { extensions: ['.ts', '.js'] },
  );
  const output = result.output as ICruiseResult;
  return output.summary.violations.map((v) => `${v.rule.name}: ${v.from} -> ${v.to}`);
}

describe('architecture (Clean Architecture layer rules)', () => {
  it('the real source tree has no layer violations', async () => {
    expect(await violations(ROOT)).toEqual([]);
  }, 60_000);

  it('the rules catch each kind of violation (checked against a deliberately broken fixture)', async () => {
    const found = await violations(resolve(ROOT, 'tests', 'architecture', 'fixtures', 'violations'));
    const rules = new Set(found.map((v) => v.split(':')[0]));
    expect(rules).toEqual(
      new Set([
        'domain-is-pure',
        'application-depends-only-on-domain',
        'infrastructure-not-on-application-or-presentation',
        'infrastructure-only-from-composition-root',
      ]),
    );
  }, 60_000);
});
