import { describe, expect, it } from 'vitest';
import { WordFixer, fromText, parseWordList, toText } from '../../src/wordlist';
import en from '../../wordlists/bash.en.json';
import fr from '../../wordlists/bash.fr.json';

describe('WordFixer', () => {
  const fix = new WordFixer([
    { heard: ['grip', 'grab'], write: 'grep' },
    { heard: ['see h mod'], write: 'chmod' },
    { heard: ['mod'], write: 'MOD' },
    { heard: ['CD'], write: 'cd', exactCase: true },
  ]);

  it('replaces whole words, any case', () => {
    expect(fix.apply('use grip to search')).toBe('use grep to search');
    expect(fix.apply('Grip the file')).toBe('grep the file');
    expect(fix.apply('Grab it, grab it.')).toBe('grep it, grep it.');
  });

  it('leaves partial words alone', () => {
    expect(fix.apply('gripping grabber')).toBe('gripping grabber');
  });

  it('matches multi-word phrases across spaces or hyphens, longest first', () => {
    expect(fix.apply('then see h mod the script')).toBe('then chmod the script');
    expect(fix.apply('then see-h-mod it')).toBe('then chmod it');
    expect(fix.apply('then see  h mod it')).toBe('then chmod it');
    expect(fix.apply('a mod here')).toBe('a MOD here');
  });

  it('respects exact-case rules', () => {
    expect(fix.apply('type CD then')).toBe('type cd then');
    expect(fix.apply('a cd player')).toBe('a cd player');
    expect(fix.apply('a Cd thing')).toBe('a Cd thing');
  });

  it('handles accented French words as word characters', () => {
    const f = new WordFixer([{ heard: ['grèpe'], write: 'grep' }]);
    expect(f.apply('utilisez grèpe pour chercher')).toBe('utilisez grep pour chercher');
    expect(f.apply('grèpes')).toBe('grèpes');
  });

  it('does nothing with no rules', () => {
    expect(new WordFixer([]).apply('as is')).toBe('as is');
  });
});

describe('default packs', () => {
  it('fix the exact mishearings Vosk produced in Phase 0 (English)', () => {
    const f = new WordFixer(parseWordList(JSON.stringify(en)).rules);
    expect(
      f.apply(
        'the day we will learn the grab command use grab to search of file then pike the output into sword if you get permission denied use tomato or pseudo',
      ),
    ).toBe(
      'the day we will learn the grep command use grep to search of file then pipe the output into sort if you get permission denied use chmod or sudo',
    );
  });

  it('fix common French mishearings', () => {
    const f = new WordFixer(parseWordList(JSON.stringify(fr)).rules);
    expect(f.apply('tapez soudeau puis ché mode et elle esse')).toBe('tapez sudo puis chmod et ls');
  });

  it('are valid word lists', () => {
    expect(parseWordList(JSON.stringify(en)).rules.length).toBeGreaterThan(10);
    expect(parseWordList(JSON.stringify(fr)).lang).toBe('fr');
  });
});

describe('editor text format', () => {
  it('round-trips rules through text', () => {
    const rules = [
      { heard: ['grip', 'grab'], write: 'grep' },
      { heard: ['CD'], write: 'cd', exactCase: true },
    ];
    expect(fromText(toText(rules))).toEqual(rules);
  });

  it('skips blank lines, comments and lines without =>', () => {
    expect(fromText('# bash\n\ngrip => grep\nnonsense\n , => x\n')).toEqual([{ heard: ['grip'], write: 'grep' }]);
  });
});

describe('JSON import', () => {
  it('rejects non-JSON and missing rules with a short message', () => {
    expect(() => parseWordList('nope')).toThrow('Not a JSON file.');
    expect(() => parseWordList('{}')).toThrow('Missing "rules" list.');
  });

  it('drops malformed rules but keeps good ones', () => {
    const wl = parseWordList('{"rules":[{"heard":["a"],"write":"b"},{"heard":"x","write":"y"},{"heard":[""],"write":"z"}]}');
    expect(wl.rules).toEqual([{ heard: ['a'], write: 'b' }]);
  });
});
