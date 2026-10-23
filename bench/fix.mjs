// Applies the app's own word lists (src/wordlist.ts, all built-in packs for the language) to
// benchmark output, so scores reflect what students see. stdin: {"lang":"en","texts":[...]}.
// Build first: npx esbuild src/wordlist.ts --bundle --format=esm --outfile=bench/.build/wordlist.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WordFixer, parseWordList } from './.build/wordlist.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const input = JSON.parse(readFileSync(0, 'utf8'));
const packs = ['bash', 'programming'].map((p) => join(root, 'wordlists', `${p}.${input.lang}.json`));
const rules = packs.flatMap((f) => parseWordList(readFileSync(f, 'utf8')).rules);
const fixer = new WordFixer(rules);
process.stdout.write(JSON.stringify({ texts: input.texts.map((t) => fixer.apply(t)), terms: [...new Set(rules.map((r) => r.write))] }));
