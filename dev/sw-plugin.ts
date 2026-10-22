// Build step: writes dist/sw.js with the list of files to precache and a version hash
// of their contents. Also removes dev-only assets (Vosk test model and bundle) from dist.
import type { Plugin } from 'vite';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

// Big dev-only files that public/ holds locally for /check. Never ship or precache them.
const DEV_ONLY = ['models', 'vendor', 'vosk-check.js'];
// Shipped but not precached: diagnostics pages nobody needs offline.
const SKIP = [/^check\//, /^check\.js$/, /^overlay\//, /^sw\.js$/, /\.map$/];

export function swPlugin(): Plugin {
  let outDir = 'dist';
  return {
    name: 'sw-precache',
    apply: 'build',
    configResolved(c) {
      outDir = resolve(c.root, c.build.outDir);
    },
    closeBundle() {
      for (const d of DEV_ONLY) rmSync(join(outDir, d), { recursive: true, force: true });
      const files = walk(outDir)
        .map((f) => relative(outDir, f).split(sep).join('/'))
        .filter((f) => !SKIP.some((re) => re.test(f)))
        .sort();
      const hash = createHash('sha256');
      for (const f of files) hash.update(f).update(readFileSync(join(outDir, f)));
      const version = hash.digest('hex').slice(0, 12);
      // Pages are cached under their directory URL too, which is how they're opened.
      const urls = files.flatMap((f) => (f.endsWith('index.html') ? [f, './' + f.slice(0, -'index.html'.length)] : [f]));
      const tpl = readFileSync(resolve(__dirname, '../src/sw/sw-template.js'), 'utf8');
      writeFileSync(
        join(outDir, 'sw.js'),
        tpl.replace('__VERSION__', version).replace('__PRECACHE__', JSON.stringify(urls.map((u) => (u.startsWith('./') ? u : './' + u)))),
      );
      this.info?.(`sw.js: ${urls.length} entries, version ${version}`);
    },
  };
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
