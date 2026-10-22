// Word list per language: stored on the phone, editable as text, importable and exportable as JSON.
import { WordFixer, fromText, parseWordList, toText, type Rule, type WordList } from '../wordlist';
import { safeGet, safeSet } from '../i18n';
import type { Lang } from '../protocol';
import bashEn from '../../wordlists/bash.en.json';
import bashFr from '../../wordlists/bash.fr.json';
import progEn from '../../wordlists/programming.en.json';
import progFr from '../../wordlists/programming.fr.json';

const pack = (j: unknown): Rule[] => parseWordList(JSON.stringify(j)).rules;
// Built-in packs, all active by default. A saved list records which packs it already holds, so a
// pack added in a later version is merged into it once, without undoing the teacher's own edits.
const PACKS: Record<Lang, Record<string, Rule[]>> = {
  en: { bash: pack(bashEn), programming: pack(progEn) },
  fr: { bash: pack(bashFr), programming: pack(progFr) },
};

export function defaultRules(lang: Lang): Rule[] {
  return mergeRules([], ...Object.values(PACKS[lang]));
}

const key = (h: string) => h.trim().replace(/[\s-]+/g, ' ').toLowerCase();

/** Appends rules from `more`, skipping heard phrases `base` already has: the first one wins. */
export function mergeRules(base: Rule[], ...more: Rule[][]): Rule[] {
  const out = base.slice();
  const seen = new Set(base.flatMap((r) => r.heard.map(key)));
  for (const rules of more)
    for (const r of rules) {
      const heard = r.heard.filter((h) => !seen.has(key(h)));
      heard.forEach((h) => seen.add(key(h)));
      if (heard.length) out.push({ ...r, heard });
    }
  return out;
}

export function loadRules(lang: Lang): Rule[] {
  const raw = safeGet('lcc.words.' + lang);
  if (raw) {
    try {
      const rules = parseWordList(raw).rules;
      const d = JSON.parse(raw);
      // Lists saved before packs were tracked only had the bash pack.
      const has: string[] = Array.isArray(d.packs) ? d.packs : ['bash'];
      const missing = Object.keys(PACKS[lang]).filter((p) => has.indexOf(p) < 0);
      if (!missing.length) return rules;
      const merged = mergeRules(rules, ...missing.map((p) => PACKS[lang][p]));
      saveRules(lang, merged);
      return merged;
    } catch {
      /* fall back to the default packs */
    }
  }
  return defaultRules(lang);
}

export function saveRules(lang: Lang, rules: Rule[]): void {
  safeSet('lcc.words.' + lang, JSON.stringify({ name: 'My word list', lang, packs: Object.keys(PACKS[lang]), rules }));
}

export function resetRules(lang: Lang): Rule[] {
  safeSet('lcc.words.' + lang, '');
  return defaultRules(lang);
}

/**
 * Tap-to-fix: from now on `heard` shows as `write`. The phrase moves out of any older rule, and
 * joins a rule that already writes the same thing, so the editor stays one line per term.
 */
export function addRule(lang: Lang, heard: string, write: string): Rule[] {
  const k = key(heard);
  const rules = loadRules(lang)
    .map((r) => ({ ...r, heard: r.heard.filter((h) => key(h) !== k) }))
    .filter((r) => r.heard.length);
  const same = rules.find((r) => r.write === write && !r.exactCase);
  if (same) same.heard.push(heard);
  else rules.push({ heard: [heard], write });
  saveRules(lang, rules);
  return rules;
}

export function fixer(lang: Lang): WordFixer {
  return new WordFixer(loadRules(lang));
}

type Els = {
  text: HTMLTextAreaElement;
  save: HTMLElement;
  reset: HTMLElement;
  importInput: HTMLInputElement;
  exportBtn: HTMLElement;
  msg: HTMLElement;
};

/** Binds the editor. `getLang` and `onChange` keep the live fixer in step with edits. */
export function bindEditor(els: Els, getLang: () => Lang, onChange: () => void, savedMsg: () => string): () => void {
  const show = () => {
    els.text.value = toText(loadRules(getLang()));
  };
  els.save.addEventListener('click', () => {
    saveRules(getLang(), fromText(els.text.value));
    show();
    els.msg.textContent = savedMsg();
    onChange();
  });
  els.reset.addEventListener('click', () => {
    els.text.value = toText(resetRules(getLang()));
    els.msg.textContent = savedMsg();
    onChange();
  });
  els.importInput.addEventListener('change', async () => {
    const f = els.importInput.files && els.importInput.files[0];
    if (!f) return;
    try {
      const wl = parseWordList(await f.text());
      saveRules(getLang(), wl.rules);
      show();
      els.msg.textContent = `${savedMsg()} (${wl.rules.length})`;
      onChange();
    } catch (e) {
      els.msg.textContent = (e as Error).message;
    }
    els.importInput.value = '';
  });
  els.exportBtn.addEventListener('click', () => {
    const lang = getLang();
    const body = JSON.stringify({ name: 'My word list', lang, rules: fromText(els.text.value) }, null, 2);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([body], { type: 'application/json' }));
    a.download = `wordlist.${lang}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  show();
  return show;
}
