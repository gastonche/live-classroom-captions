// Browser screen (/show): full-screen captions for TVs and projectors. The room logic
// lives in RoomHost; this file only renders its state.
import { generate } from 'lean-qr/nano';
import type { Cfg } from '../protocol';
import { CaptionView } from '../captions';
import { RoomHost, type HostState } from '../host';
import { applyStrings, detectLang, fill, safeGet, safeSet, strings } from '../i18n';
import { keepAwake } from '../wake';
import { registerSW } from '../sw/register';

const $ = (id: string) => document.getElementById(id)!;
let s = strings(detectLang());
let cfg = loadCfg();

const view = new CaptionView($('stage'), 6);
const host = new RoomHost(view, render, (c) => applyCfg(c));
let shownCode = '';

applyStrings(document, s);
applyCfg({});
host.start();
keepAwake();

function render(st: HostState): void {
  $('pair').hidden = st.live;
  $('live').hidden = !st.live;
  const notice = $('notice');
  const msg = !st.teacher ? s.waiting : st.paused ? s.paused : !st.micOk ? s.interrupted : '';
  notice.textContent = msg;
  notice.hidden = !msg;
  $('stage').hidden = !!msg;
  if (st.ready && st.code !== shownCode) showCode(st.code);
  if (!st.live && st.teacher) $('view-hint').textContent = s.ready;
  else setViewHint();
  $('net').setAttribute('data-state', st.net === 'offline' && !st.teacher ? 'offline' : st.teacher ? 'teacher' : st.ready ? 'online' : 'connecting');
}

function showCode(code: string): void {
  shownCode = code;
  $('code').textContent = code;
  $('net-code').textContent = code;
  const url = new URL('../speak/?room=' + code, location.href).href;
  generate(url).toCanvas($('qr') as HTMLCanvasElement);
}

function setViewHint(): void {
  const viewUrl = new URL('../view/', location.href);
  $('view-hint').textContent = fill(s.viewHint, { url: viewUrl.host + viewUrl.pathname });
}

type Settings = { size: number; lines: number; margin: number; lang: 'en' | 'fr' };

function loadCfg(): Settings {
  const d: Settings = { size: 6, lines: 3, margin: 5, lang: detectLang() };
  try {
    return { ...d, ...JSON.parse(safeGet('lcc.cfg') || '{}') };
  } catch {
    return d;
  }
}

function applyCfg(c: Partial<Cfg>): void {
  if (c.size) cfg.size = clamp(c.size, 3, 14);
  if (c.lines) cfg.lines = clamp(Math.round(c.lines), 1, 6);
  if (typeof c.margin === 'number') cfg.margin = clamp(c.margin, 0, 15);
  if (c.lang === 'en' || c.lang === 'fr') cfg.lang = c.lang;
  const root = document.documentElement;
  root.style.setProperty('--size', String(cfg.size));
  root.style.setProperty('--lines', String(cfg.lines));
  root.style.setProperty('--margin', String(cfg.margin));
  if (root.lang !== cfg.lang) {
    root.lang = cfg.lang;
    s = strings(cfg.lang);
    applyStrings(document, s);
    shownCode = '';
    render(host.state);
  }
  safeSet('lcc.cfg', JSON.stringify(cfg));
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// Remote-friendly bonus: up/down change text size on the display itself.
document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowUp') applyCfg({ size: cfg.size + 0.5 });
  else if (e.key === 'ArrowDown') applyCfg({ size: cfg.size - 0.5 });
});

// Test hook: lets the latency harness read render timestamps. Harmless in production.
(window as any).__lcc = { get code() { return host.state.code; }, view };

registerSW('../', () => host.state.live);
