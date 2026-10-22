// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { CaptionView } from '../../src/captions';

describe('CaptionView', () => {
  it('shows interim text dimmed after final text, and firms it up', () => {
    const root = document.createElement('div');
    const v = new CaptionView(root);
    v.final('Today we learn');
    v.interim('the grep');
    const p = root.querySelector('.cap')!;
    expect(p.textContent).toBe('Today we learn the grep');
    expect(p.querySelector('.interim')!.textContent).toBe(' the grep');
    v.final('the grep command');
    expect(p.textContent).toBe('Today we learn the grep command');
    expect(p.querySelector('.interim')!.textContent).toBe('');
  });

  it('never replaces the text node of earlier text (append only)', () => {
    const root = document.createElement('div');
    const v = new CaptionView(root);
    v.final('one');
    const node = root.querySelector('.cap')!.firstChild;
    v.interim('two');
    v.final('two');
    v.interim('three');
    expect(root.querySelector('.cap')!.firstChild).toBe(node);
    expect(node!.textContent).toBe('one two');
  });

  it('starts new paragraphs and trims old ones when capped', () => {
    const root = document.createElement('div');
    const v = new CaptionView(root, 3);
    for (let i = 0; i < 40; i++) v.final('a sentence of about forty characters long.');
    expect(root.querySelectorAll('.cap').length).toBeLessThanOrEqual(3);
    expect(v.transcript.split('forty').length - 1).toBe(40);
  });

  it('keeps everything when uncapped, and loads a transcript', () => {
    const root = document.createElement('div');
    const v = new CaptionView(root, 0);
    v.load('hello world');
    expect(root.textContent).toBe('hello world');
    expect(v.transcript).toBe('hello world');
  });

  it('ignores empty finals', () => {
    const root = document.createElement('div');
    const v = new CaptionView(root);
    v.final('  ');
    expect(root.textContent).toBe('');
  });
});
