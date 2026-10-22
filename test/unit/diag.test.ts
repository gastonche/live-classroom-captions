// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { clear, count, log, report } from '../../src/diag';

describe('diagnostics log', () => {
  beforeEach(() => clear());

  it('records events in order with relative times', () => {
    log('mic', 'start en-US');
    log('session', 'listening');
    const r = report({ room: 'K7PX' });
    expect(r).toContain('room: K7PX');
    expect(r).toContain('ua: ');
    expect(r.indexOf('mic  start en-US')).toBeLessThan(r.indexOf('session  listening'));
    expect(r).toMatch(/-0:00  mic  start en-US/);
  });

  it('keeps only the most recent 400 events', () => {
    for (let i = 0; i < 450; i++) log('n', String(i));
    expect(count()).toBe(400);
    expect(report()).not.toMatch(/n  49$/m);
    expect(report()).toMatch(/n  449$/m);
  });
});
