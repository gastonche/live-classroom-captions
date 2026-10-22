// Tap a wrong word in the phone's preview to fix it: the tapped word and its neighbours become
// big buttons (tap one beside it to take in "bully and"), the teacher types the right spelling,
// and Save adds "heard => write" to the word list. Captions keep flowing the whole time.
import type { Lang } from '../protocol';
import { addRule } from './words';

export type Word = { w: string; start: number; end: number };

// Punctuation trimmed from the ends of a word. A leading dot stays (".env").
const LEAD = /^[,;:!?()[\]{}"'«»“”‘’…]+/;
const TRAIL = /[.,;:!?()[\]{}"'«»“”‘’…]+$/;

/** The words of a caption, with their character positions. */
export function words(text: string): Word[] {
  const out: Word[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const lead = (m[0].match(LEAD) || [''])[0].length;
    const w = m[0].slice(lead).replace(TRAIL, '');
    if (w) out.push({ w, start: m.index + lead, end: m.index + lead + w.length });
  }
  return out;
}

/** Index of the word at a character offset; between words, the one before. */
export function phraseAt(ws: Word[], offset: number): number {
  let i = 0;
  while (i < ws.length - 1 && ws[i].end < offset && ws[i + 1].start <= offset) i++;
  return i;
}

type Els = {
  preview: HTMLElement;
  panel: HTMLFormElement;
  chips: HTMLElement;
  label: HTMLElement;
  input: HTMLInputElement;
  cancel: HTMLElement;
  hint: HTMLElement;
};
type Text = { fixShow: string; fixSaved: string; tapToFix: string };

export function bindTapFix(
  els: Els,
  getLang: () => Lang,
  getText: () => Text,
  onSaved: () => void,
  ignoreTap: () => boolean,
): { close: () => void } {
  let ws: Word[] = [];
  let a = 0;
  let b = 0;
  let hintTimer = 0;
  const phrase = () =>
    ws
      .slice(a, b + 1)
      .map((x) => x.w)
      .join(' ')
      .replace(/,/g, ' ')
      .toLowerCase();

  function render(): void {
    els.chips.textContent = '';
    ws.forEach((x, i) => {
      const c = document.createElement('button');
      c.type = 'button';
      c.className = 'wchip';
      c.textContent = x.w;
      c.setAttribute('aria-pressed', String(i >= a && i <= b));
      // Keep the keyboard up: the chip must not take focus from the text box.
      c.addEventListener('mousedown', (e) => e.preventDefault());
      c.addEventListener('click', () => {
        // Outside the selection: stretch to it. Inside: start again from that word.
        if (i < a) a = i;
        else if (i > b) b = i;
        else a = b = i;
        render();
        els.input.focus();
      });
      els.chips.appendChild(c);
    });
    els.label.textContent = getText().fixShow.replace('{heard}', phrase());
  }

  function open(text: string, offset: number): void {
    const all = words(text);
    if (!all.length) return;
    const i = phraseAt(all, offset);
    const lo = Math.max(0, i - 3);
    ws = all.slice(lo, Math.min(all.length, i + 5));
    a = b = i - lo;
    els.input.value = '';
    render();
    els.panel.hidden = false;
    els.input.focus();
  }

  function close(): void {
    els.panel.hidden = true;
    els.input.blur();
  }

  els.preview.addEventListener('click', (e) => {
    if (ignoreTap()) return;
    const hit = hitTest(e.clientX, e.clientY, els.preview);
    if (hit) open(hit.text, hit.offset);
  });
  els.panel.addEventListener('submit', (e) => {
    e.preventDefault();
    const heard = phrase();
    const write = els.input.value.replace(/=>|[\r\n]/g, ' ').trim();
    if (!heard || !write || write === heard) return els.input.focus();
    addRule(getLang(), heard, write);
    close();
    onSaved();
    // The confirmation takes the hint's line for a moment, so the preview stays fully visible.
    els.hint.textContent = getText().fixSaved.replace('{heard}', heard).replace('{write}', write);
    els.hint.classList.add('ok');
    clearTimeout(hintTimer);
    hintTimer = window.setTimeout(() => {
      els.hint.textContent = getText().tapToFix;
      els.hint.classList.remove('ok');
    }, 3000);
  });
  els.cancel.addEventListener('click', close);
  els.panel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
  return { close };
}

/** The caption paragraph under a tap, and the character offset in it. */
function hitTest(x: number, y: number, root: HTMLElement): { text: string; offset: number } | null {
  const d = document as any;
  let node: Node | null = null;
  let off = 0;
  if (d.caretPositionFromPoint) {
    const p = d.caretPositionFromPoint(x, y);
    if (p) (node = p.offsetNode), (off = p.offset);
  } else if (d.caretRangeFromPoint) {
    const r: Range | null = d.caretRangeFromPoint(x, y);
    if (r) (node = r.startContainer), (off = r.startOffset);
  }
  const el = node && (node.nodeType === 1 ? (node as Element) : node.parentElement);
  const para = el && el.closest('.cap');
  if (node && para && root.contains(para)) {
    const r = document.createRange();
    r.setStart(para, 0);
    r.setEnd(node, off);
    return { text: para.textContent || '', offset: r.toString().length };
  }
  // A tap beside the text: offer the last words shown.
  const text = (root.lastElementChild && root.lastElementChild.textContent) || '';
  return text.trim() ? { text, offset: text.length } : null;
}
