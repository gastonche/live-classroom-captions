// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSpeechEngine } from '../../src/speech/webspeech';
import type { EngineEvents } from '../../src/speech/engine';

// A minimal fake of webkitSpeechRecognition that tests drive by hand.
class MockRec {
  static all: MockRec[] = [];
  lang = '';
  continuous = false;
  interimResults = false;
  maxAlternatives = 1;
  onstart: (() => void) | null = null;
  onresult: ((e: any) => void) | null = null;
  onerror: ((e: any) => void) | null = null;
  onend: (() => void) | null = null;
  results: { t: string; final: boolean }[] = [];
  constructor() {
    MockRec.all.push(this);
  }
  start() {
    queueMicrotask(() => this.onstart?.());
  }
  stop() {
    queueMicrotask(() => this.onend?.());
  }
  abort() {
    queueMicrotask(() => {
      this.onerror?.({ error: 'aborted' });
      this.onend?.();
    });
  }
  // Test helpers
  say(results: [string, boolean][]) {
    const list = results.map(([t, f]) => Object.assign([{ transcript: t }], { isFinal: f }));
    this.onresult?.({ results: list, resultIndex: 0 });
  }
  end(error?: string) {
    if (error) this.onerror?.({ error });
    this.onend?.();
  }
}

function setup() {
  const events: string[] = [];
  const ev: EngineEvents = {
    interim: (t) => events.push('i:' + t),
    final: (t) => events.push('f:' + t),
    state: (s, p) => events.push('s:' + s + (p ? ':' + p : '')),
  };
  const eng = new WebSpeechEngine(ev);
  return { eng, events, rec: () => MockRec.all[MockRec.all.length - 1] };
}

beforeEach(() => {
  MockRec.all = [];
  (window as any).webkitSpeechRecognition = MockRec;
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  delete (window as any).webkitSpeechRecognition;
});

describe('WebSpeechEngine', () => {
  it('configures continuous interim recognition in the chosen language', async () => {
    const { eng, events, rec } = setup();
    eng.start('fr-FR');
    await vi.advanceTimersByTimeAsync(0);
    expect(rec().lang).toBe('fr-FR');
    expect(rec().continuous).toBe(true);
    expect(rec().interimResults).toBe(true);
    expect(events).toContain('s:listening');
  });

  it('emits interims, then only the new final text', async () => {
    const { eng, events, rec } = setup();
    eng.start('en-US');
    await vi.advanceTimersByTimeAsync(0);
    rec().say([['use grep', false]]);
    rec().say([['use grep to', false]]);
    rec().say([['use grep to search', true]]);
    rec().say([['use grep to search', true], [' a file', false]]);
    rec().say([['use grep to search', true], [' a file', true]]);
    expect(events.filter((e) => !e.startsWith('s:'))).toEqual([
      'i:use grep',
      'i:use grep to',
      'f:use grep to search',
      'i:',
      'i:a file',
      'f:a file',
      'i:',
    ]);
  });

  it('firms up interim text that stops changing (iOS rarely marks results final)', async () => {
    const { eng, events, rec } = setup();
    eng.start('en-US');
    await vi.advanceTimersByTimeAsync(0);
    rec().say([['today we learn pipes', false]]);
    await vi.advanceTimersByTimeAsync(1500);
    expect(events).toContain('f:today we learn pipes');
    // The same session keeps growing: only the new part is emitted afterwards.
    rec().say([['today we learn pipes and redirects', false]]);
    await vi.advanceTimersByTimeAsync(1500);
    expect(events.filter((e) => e.startsWith('f:'))).toEqual(['f:today we learn pipes', 'f:and redirects']);
    // And a late isFinal for text already firmed up adds nothing.
    rec().say([['today we learn pipes and redirects', true]]);
    expect(events.filter((e) => e.startsWith('f:'))).toHaveLength(2);
  });

  it('restarts by itself when a session ends, without losing interim text', async () => {
    const { eng, events, rec } = setup();
    eng.start('en-US');
    await vi.advanceTimersByTimeAsync(0);
    rec().say([['half a sentence', false]]);
    const first = rec();
    first.end('no-speech');
    expect(events).toContain('f:half a sentence');
    expect(events).toContain('s:restarting');
    await vi.advanceTimersByTimeAsync(3000);
    expect(rec()).not.toBe(first);
    expect(events[events.length - 1]).toBe('s:listening');
  });

  it('backs off when sessions keep ending instantly', async () => {
    const { eng, rec } = setup();
    eng.start('en-US');
    await vi.advanceTimersByTimeAsync(0);
    // End each new session the moment it appears, and record how long each restart took.
    const waits: number[] = [];
    for (let i = 0; i < 5; i++) {
      const n = MockRec.all.length;
      rec().end();
      let waited = 0;
      while (MockRec.all.length === n && waited < 10_000) {
        await vi.advanceTimersByTimeAsync(10);
        waited += 10;
      }
      waits.push(waited);
    }
    // Each instant failure waits longer, up to the 3 s cap.
    for (let i = 1; i < waits.length; i++) expect(waits[i]).toBeGreaterThanOrEqual(waits[i - 1]);
    expect(waits[0]).toBeLessThanOrEqual(400);
    expect(waits[waits.length - 1]).toBe(3000);
  });

  it('reports a blocked microphone and stops trying', async () => {
    const { eng, events, rec } = setup();
    (MockRec.prototype as any).start = function (this: MockRec) {
      /* never starts */
    };
    eng.start('en-US');
    rec().end('not-allowed');
    await vi.advanceTimersByTimeAsync(5000);
    expect(events).toContain('s:error:blocked');
    expect(MockRec.all).toHaveLength(1);
    (MockRec.prototype as any).start = function (this: MockRec) {
      queueMicrotask(() => this.onstart?.());
    };
  });

  it('asks for a tap when iOS refuses a restart after a working start', async () => {
    const { eng, events, rec } = setup();
    eng.start('en-US');
    await vi.advanceTimersByTimeAsync(0);
    rec().end('not-allowed');
    expect(events).toContain('s:error:needs-tap');
    eng.start('en-US');
    await vi.advanceTimersByTimeAsync(0);
    expect(MockRec.all).toHaveLength(2);
  });

  it('stop() flushes pending text, ends the session and does not restart', async () => {
    const { eng, events, rec } = setup();
    eng.start('en-US');
    await vi.advanceTimersByTimeAsync(0);
    rec().say([['last words', false]]);
    eng.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(events).toContain('f:last words');
    expect(events[events.length - 1]).toBe('s:idle');
    expect(MockRec.all).toHaveLength(1);
  });

  it('reports unsupported browsers', () => {
    delete (window as any).webkitSpeechRecognition;
    const { eng, events } = setup();
    eng.start('en-US');
    expect(events).toEqual(['s:error:unsupported']);
  });

  it('watchdog: restarts a session that says "listening" but goes silent (seen on iPhone in class)', async () => {
    const { eng, events, rec } = setup();
    eng.start('en-US');
    await vi.advanceTimersByTimeAsync(0);
    rec().say([['hello class', true]]);
    const first = rec();
    await vi.advanceTimersByTimeAsync(19_000);
    expect(rec()).toBe(first); // still within the window
    await vi.advanceTimersByTimeAsync(3_000);
    expect(rec()).not.toBe(first);
    expect(events[events.length - 1]).toBe('s:listening');
    const { report } = await import('../../src/diag');
    expect(report()).toMatch(/watchdog\s+no results for 2\ds, restarting/);
  });

  it('watchdog: replaces a hung session whose abort() never ends', async () => {
    const { eng, rec } = setup();
    eng.start('en-US');
    await vi.advanceTimersByTimeAsync(0);
    const first = rec();
    first.abort = () => {}; // iOS: abort does nothing, onend never comes
    await vi.advanceTimersByTimeAsync(21_000);
    expect(rec()).toBe(first);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(rec()).not.toBe(first);
    // The dead session can't feed text in later.
    expect(first.onresult).toBeNull();
  });

  it('watchdog: stays quiet while results keep coming', async () => {
    const { eng, rec } = setup();
    eng.start('en-US');
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < 12; i++) {
      rec().say([['word ' + i, false]]);
      await vi.advanceTimersByTimeAsync(5_000);
    }
    expect(MockRec.all).toHaveLength(1);
  });

  it('recycles a very long session at a pause, not mid-phrase', async () => {
    const { eng, events, rec } = setup();
    eng.start('en-US');
    await vi.advanceTimersByTimeAsync(0);
    const first = rec();
    const said: [string, boolean][] = [];
    for (let i = 0; i < 26; i++) {
      said.push([' sentence ' + i, true]);
      first.say(said);
      await vi.advanceTimersByTimeAsync(10_000);
    }
    // Over 4 minutes, with a pause after the last final: recycled.
    expect(rec()).not.toBe(first);
    expect(events.filter((e) => e.startsWith('f:'))).toHaveLength(26);
  });

  it('starts a fresh session the moment the network comes back (no waiting out the backoff)', async () => {
    const { eng, events, rec } = setup();
    eng.start('en-US');
    await vi.advanceTimersByTimeAsync(0);
    // Offline: sessions fail instantly with "network", backing off.
    for (let i = 0; i < 3; i++) {
      const n = MockRec.all.length;
      rec().end('network');
      while (MockRec.all.length === n) await vi.advanceTimersByTimeAsync(10);
    }
    rec().end('network'); // now waiting out a 2 s+ delay
    const before = MockRec.all.length;
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);
    expect(MockRec.all.length).toBe(before + 1);
    await vi.advanceTimersByTimeAsync(0);
    expect(events[events.length - 1]).toBe('s:listening');
  });

  it('on network return, replaces a session that is still hanging around', async () => {
    const { eng, rec } = setup();
    eng.start('en-US');
    await vi.advanceTimersByTimeAsync(0);
    const first = rec();
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(100);
    expect(rec()).not.toBe(first);
  });
});

