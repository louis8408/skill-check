import type { Clock } from '../domain/ports.js';

export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }
}
