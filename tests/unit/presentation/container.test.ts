import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../../src/presentation/config.js';
import { createApp } from '../../../src/presentation/container.js';

describe('createApp', () => {
  it('wires the use cases with or without a GitHub token', () => {
    for (const env of [{}, { GH_TOKEN: 'token' }]) {
      const app = createApp(loadConfig(env, '/home/me'), 'skill-check-test');
      expect(app.checkOnUse).toBeDefined();
      expect(app.refresh).toBeDefined();
    }
  });
});
