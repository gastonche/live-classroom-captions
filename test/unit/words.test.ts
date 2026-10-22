// @vitest-environment happy-dom
// Phone word-list storage: merged default packs, one-time merge into older saved lists, tap-to-fix rules.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addRule, defaultRules, loadRules, resetRules, saveRules } from '../../src/speak/words';
import { WordFixer } from '../../src/wordlist';
import { phraseAt, words } from '../../src/speak/tapfix';

// A fresh in-memory store per test (newer Node ships its own, inert, localStorage global).
beforeEach(() => {
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => m.set(k, v) });
});

describe('default word list', () => {
  it('holds both the bash and the programming pack', () => {
    const f = new WordFixer(loadRules('en'));
    expect(f.apply('grip the bully')).toBe('grep the boolean');
    expect(new WordFixer(loadRules('fr')).apply('soudeau un fichier Jason')).toBe('sudo un fichier JSON');
  });

  it('Reset restores both packs', () => {
    saveRules('en', [{ heard: ['x'], write: 'y' }]);
    expect(resetRules('en')).toEqual(defaultRules('en'));
    expect(loadRules('en')).toEqual(defaultRules('en'));
  });

  it('a list saved before the programming pack gets it once, keeping the teacher’s edits', () => {
    localStorage.setItem('lcc.words.en', JSON.stringify({ name: 'My word list', lang: 'en', rules: [{ heard: ['bully'], write: 'Bully' }] }));
    const rules = loadRules('en');
    expect(rules[0]).toEqual({ heard: ['bully'], write: 'Bully' });
    expect(new WordFixer(rules).apply('bully in Jason')).toBe('Bully in JSON');
    // Deleting a pack rule afterwards sticks: the merge does not run again.
    saveRules('en', rules.filter((r) => r.write !== 'JSON'));
    expect(loadRules('en').some((r) => r.write === 'JSON')).toBe(false);
  });
});

describe('addRule (tap to fix)', () => {
  it('adds a rule that the next fixer applies, and keeps it in storage', () => {
    addRule('en', 'jeep', 'JIT');
    expect(new WordFixer(loadRules('en')).apply('a jeep compiler')).toBe('a JIT compiler');
  });

  it('joins a rule that already writes the same thing', () => {
    saveRules('en', [{ heard: ['boo lean'], write: 'boolean' }]);
    expect(addRule('en', 'bully', 'boolean')).toEqual([{ heard: ['boo lean', 'bully'], write: 'boolean' }]);
  });

  it('moves the phrase out of an older rule, so the new spelling wins', () => {
    saveRules('en', [{ heard: ['grip', 'grab'], write: 'grep' }]);
    expect(addRule('en', 'grab', 'grab')).toEqual([
      { heard: ['grip'], write: 'grep' },
      { heard: ['grab'], write: 'grab' },
    ]);
  });
});

describe('tap-to-fix word picking', () => {
  it('splits a caption into words without punctuation', () => {
    expect(words('it returns a bully, then (stop).').map((w) => w.w)).toEqual(['it', 'returns', 'a', 'bully', 'then', 'stop']);
  });

  it('keeps dots and symbols inside a word', () => {
    expect(words('call console.log and C#').map((w) => w.w)).toEqual(['call', 'console.log', 'and', 'C#']);
  });

  it('finds the word at a character offset, or the one before a space', () => {
    const t = 'it returns a bully';
    expect(phraseAt(words(t), t.indexOf('bully') + 2)).toBe(3);
    expect(phraseAt(words(t), t.indexOf(' a')), 'space after "returns"').toBe(1);
    expect(phraseAt(words(t), 0)).toBe(0);
    expect(phraseAt(words(t), t.length)).toBe(3);
  });
});
