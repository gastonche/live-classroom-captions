// Word-list post-processor: fixes what the recogniser heard into the term the teacher meant
// ("grip" -> grep, "see h mod" -> chmod). Whole words only, longest phrase first,
// case-insensitive unless a rule asks for exact case.

export type Rule = { heard: string[]; write: string; exactCase?: boolean };
export type WordList = { name: string; lang: 'en' | 'fr'; rules: Rule[] };

// Letters (including accented Latin), digits, underscore and apostrophe count as word characters.
const W = "A-Za-z0-9_'À-ɏ";

export class WordFixer {
  private re: RegExp | null = null;
  private reExact: RegExp | null = null;
  private map = new Map<string, string>();
  private mapExact = new Map<string, string>();

  constructor(rules: Rule[]) {
    const loose: string[] = [];
    const exact: string[] = [];
    for (const r of rules) {
      for (const h of r.heard) {
        const key = norm(h);
        if (!key) continue;
        if (r.exactCase) {
          this.mapExact.set(key, r.write);
          exact.push(key);
        } else {
          this.map.set(key.toLowerCase(), r.write);
          loose.push(key);
        }
      }
    }
    this.re = build(loose, 'gi');
    this.reExact = build(exact, 'g');
  }

  apply(text: string): string {
    if (this.reExact) text = text.replace(this.reExact, (_, pre, m) => pre + (this.mapExact.get(norm(m)) ?? m));
    if (this.re) text = text.replace(this.re, (_, pre, m) => pre + (this.map.get(norm(m).toLowerCase()) ?? m));
    return text;
  }
}

function norm(s: string): string {
  return s.trim().replace(/[\s-]+/g, ' ');
}

function build(phrases: string[], flags: string): RegExp | null {
  if (!phrases.length) return null;
  // Longest first, so "see h mod" wins over "mod".
  const alts = [...new Set(phrases)]
    .sort((a, b) => b.length - a.length)
    .map((p) => p.split(' ').map(escape).join('[\\s-]+'));
  // A capture group stands in for lookbehind, which older Safari lacks.
  return new RegExp(`(^|[^${W}])(${alts.join('|')})(?![${W}])`, flags);
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---- Editing format: one rule per line, "heard, heard => write" ----

export function toText(rules: Rule[]): string {
  return rules.map((r) => `${r.heard.join(', ')} => ${r.write}${r.exactCase ? ' (exact case)' : ''}`).join('\n');
}

export function fromText(text: string): Rule[] {
  const rules: Rule[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=>');
    if (i < 0) continue;
    let write = line.slice(i + 2).trim();
    const exactCase = /\(exact case\)$/i.test(write);
    if (exactCase) write = write.replace(/\s*\(exact case\)$/i, '');
    const heard = line
      .slice(0, i)
      .split(',')
      .map((h) => h.trim())
      .filter(Boolean);
    if (heard.length && write) rules.push(exactCase ? { heard, write, exactCase } : { heard, write });
  }
  return rules;
}

/** Validates an imported JSON word list. Throws a short, readable message when it's wrong. */
export function parseWordList(json: string): WordList {
  let d: any;
  try {
    d = JSON.parse(json);
  } catch {
    throw new Error('Not a JSON file.');
  }
  if (!d || !Array.isArray(d.rules)) throw new Error('Missing "rules" list.');
  const rules: Rule[] = d.rules
    .filter((r: any) => r && typeof r.write === 'string' && Array.isArray(r.heard))
    .map((r: any) => ({
      heard: r.heard.filter((h: any) => typeof h === 'string' && h.trim()),
      write: r.write,
      ...(r.exactCase ? { exactCase: true } : {}),
    }))
    .filter((r: Rule) => r.heard.length);
  return { name: typeof d.name === 'string' ? d.name : 'Imported', lang: d.lang === 'fr' ? 'fr' : 'en', rules };
}
