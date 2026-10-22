// Word list per language: stored on the phone, editable as text, importable and exportable as JSON.
import { WordFixer, fromText, parseWordList, toText, type Rule, type WordList } from '../wordlist';
import { safeGet, safeSet } from '../i18n';
import type { Lang } from '../protocol';
import en from '../../wordlists/bash.en.json';
import fr from '../../wordlists/bash.fr.json';

const DEFAULTS: Record<Lang, WordList> = { en: parseWordList(JSON.stringify(en)), fr: parseWordList(JSON.stringify(fr)) };

export function loadRules(lang: Lang): Rule[] {
  const raw = safeGet('lcc.words.' + lang);
  if (raw) {
    try {
      return parseWordList(raw).rules;
    } catch {
      /* fall back to the default pack */
    }
  }
  return DEFAULTS[lang].rules;
}

export function saveRules(lang: Lang, rules: Rule[]): void {
  safeSet('lcc.words.' + lang, JSON.stringify({ name: 'My word list', lang, rules }));
}

export function resetRules(lang: Lang): Rule[] {
  safeSet('lcc.words.' + lang, '');
  return DEFAULTS[lang].rules;
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
