import { describe, expect, it } from 'vitest';
import { describeError } from '../../../src/domain/errors.js';

describe('describeError', () => {
  it('uses the message of an Error', () => {
    expect(describeError(new Error('offline'))).toBe('offline');
  });

  it('stringifies anything else that was thrown', () => {
    expect(describeError('boom')).toBe('boom');
    expect(describeError(42)).toBe('42');
  });
});
