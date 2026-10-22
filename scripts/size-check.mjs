// Fails the build when a page's JS or the app's CSS goes over budget (gzipped).
// PeerJS is budgeted on its own, as the brief allows ("plus PeerJS").
import { readFileSync, readdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const DIST = 'dist';
const KB = 1024;
const BUDGET = { show: 15 * KB, speak: 40 * KB, view: 40 * KB, css: 5 * KB, peerjs: 30 * KB };

const gz = (f) => gzipSync(readFileSync(join(DIST, f)), { level: 9 }).length;

/** JS files a page loads: its entry script plus modulepreloads, resolved relative to the page. */
function pageJs(page) {
  const html = readFileSync(join(DIST, page, 'index.html'), 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="([^"]+\.js)"/g)].map((m) => m[1]);
  return [...new Set(refs.map((r) => join(page, r).replace(/^.*?assets\//, 'assets/')))];
}

let failed = false;
const rows = [];
let peer = 0;
for (const page of ['show', 'speak', 'view']) {
  let app = 0;
  for (const f of pageJs(page)) {
    const n = gz(f);
    if (/peerjs/.test(f)) peer = n;
    else app += n;
  }
  rows.push([`/${page} JS (excl. PeerJS)`, app, BUDGET[page]]);
}
rows.push(['PeerJS chunk', peer, BUDGET.peerjs]);
const css = readdirSync(join(DIST, 'assets')).filter((f) => f.endsWith('.css'));
rows.push(['CSS, whole app', css.reduce((a, f) => a + gz(join('assets', f)), 0), BUDGET.css]);

for (const [name, size, budget] of rows) {
  const ok = size <= budget;
  failed ||= !ok;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(26)} ${(size / KB).toFixed(1).padStart(6)} KB / ${budget / KB} KB`);
}
if (failed) {
  console.error('Size budget exceeded.');
  process.exit(1);
}
