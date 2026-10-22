import { describe, expect, it, vi } from 'vitest';
import { ALPHABET, newCode, normalizeCode, peerId } from '../../src/room';
import { decode, encode, SeqFilter, type Caption } from '../../src/protocol';
import { Backoff, Retrier } from '../../src/backoff';

describe('room codes', () => {
  it('generates 4 characters from the unambiguous alphabet', () => {
    for (let i = 0; i < 200; i++) {
      const c = newCode();
      expect(c).toHaveLength(4);
      for (const ch of c) expect(ALPHABET).toContain(ch);
    }
  });

  it('never uses look-alike characters', () => {
    for (const ch of '0O1IL5S') expect(ALPHABET).not.toContain(ch);
  });

  it('normalises case, spaces and dashes', () => {
    expect(normalizeCode(' k7px ')).toBe('K7PX');
    expect(normalizeCode('k7-px')).toBe('K7PX');
  });

  it('rejects wrong length and characters outside the alphabet', () => {
    expect(normalizeCode('K7P')).toBeNull();
    expect(normalizeCode('K7PXA')).toBeNull();
    expect(normalizeCode('K0PX')).toBeNull();
    expect(normalizeCode('')).toBeNull();
  });

  it('namespaces peer IDs', () => {
    expect(peerId('K7PX')).toBe('lcc1-K7PX');
  });
});

describe('protocol', () => {
  const cap = (over: Partial<Caption>): Caption => ({ t: 'f', id: 0, text: 'hi', seq: 1, sid: 'a', ...over });

  it('round-trips messages', () => {
    const m = cap({ text: 'grep -r "x" .' });
    expect(decode(encode(m))).toEqual(m);
    expect(decode(encode({ t: 'pause', on: true }))).toEqual({ t: 'pause', on: true });
  });

  it('rejects junk and malformed captions', () => {
    expect(decode('not json')).toBeNull();
    expect(decode('{"t":"nope"}')).toBeNull();
    expect(decode('{"t":"f","text":1,"id":0,"seq":1,"sid":"a"}')).toBeNull();
    expect(decode('{"t":"i","text":"x","id":0,"sid":"a"}')).toBeNull();
    expect(decode('{"t":"pause","on":"yes"}')).toBeNull();
    expect(decode('{"t":"hello","role":"admin"}')).toBeNull();
    expect(decode(JSON.stringify(cap({ text: 'x'.repeat(5001) })))).toBeNull();
  });

  it('accepts already-parsed objects', () => {
    expect(decode({ t: 'ping', at: 1 })).toEqual({ t: 'ping', at: 1 });
  });
});

describe('SeqFilter', () => {
  const c = (t: 'i' | 'f', id: number, seq: number, sid = 'a'): Caption => ({ t, id, seq, sid, text: 'x' });

  it('drops duplicates and out-of-order messages', () => {
    const f = new SeqFilter();
    expect(f.accept(c('i', 0, 1))).toBe(true);
    expect(f.accept(c('i', 0, 1))).toBe(false);
    expect(f.accept(c('i', 0, 3))).toBe(true);
    expect(f.accept(c('i', 0, 2))).toBe(false);
  });

  it('drops a late interim for an utterance that is already final', () => {
    const f = new SeqFilter();
    expect(f.accept(c('f', 4, 10))).toBe(true);
    expect(f.accept(c('i', 4, 11))).toBe(false);
    expect(f.accept(c('i', 5, 12))).toBe(true);
  });

  it('starts fresh when the sender reloads (new sid)', () => {
    const f = new SeqFilter();
    expect(f.accept(c('f', 9, 50, 'a'))).toBe(true);
    expect(f.accept(c('i', 0, 1, 'b'))).toBe(true);
  });
});

describe('Backoff', () => {
  it('doubles up to the cap and resets', () => {
    const b = new Backoff(300, 3000);
    expect([b.next(), b.next(), b.next(), b.next(), b.next(), b.next()]).toEqual([300, 600, 1200, 2400, 3000, 3000]);
    b.reset();
    expect(b.next()).toBe(300);
  });

  it('keeps one retry pending at a time and resets on success', () => {
    vi.useFakeTimers();
    const r = new Retrier(new Backoff(100, 1000));
    const fn = vi.fn();
    r.schedule(fn);
    r.schedule(fn);
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
    r.schedule(fn);
    vi.advanceTimersByTime(150);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(50);
    expect(fn).toHaveBeenCalledTimes(2);
    r.succeeded();
    r.schedule(fn);
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });
});
