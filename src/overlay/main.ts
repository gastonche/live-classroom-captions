// Desktop overlay: captions on top of whatever the projector shows (docs/overlay.md).
// Hosts the room like /show does, but draws only a caption box, a status chip and,
// when asked, a room-code card. Native window behaviour lives in src-tauri.
import { generate } from 'lean-qr/nano';
import { CaptionView } from '../captions';
import { RoomHost } from '../host';
import { WEB_URL } from '../config';
import type { Cfg, Lang, Position } from '../protocol';
import { applyStrings, detectLang, fill, safeGet, safeSet, strings } from '../i18n';
import { log } from '../diag';
import { decide, Dodger, opposite, type Chip } from './logic';
import * as native from './native';

const $ = (id: string) => document.getElementById(id)!;
native.log('page script running');

type Settings = {
  position: Position;
  dodge: boolean;
  hidden: boolean;
  monitor: string; // '' = automatic (the projector)
  size: number;
  lines: number;
  margin: number;
  lang: Lang;
  autostart: boolean;
};
const DEFAULTS: Settings = {
  position: 'bottom',
  dodge: false,
  hidden: false,
  monitor: '',
  size: 4.5,
  lines: 2,
  margin: 5,
  lang: detectLang(),
  autostart: false,
};
const set: Settings = load();
let s = strings(set.lang);
let placedOn = '';
let knownMonitors: string[] | null = null; // null until the first check, which always places
// The room code shows from launch until the first phone pairs, and later on request.
let showCodeUntil = Infinity;
let shownCode = '';
let lastMenu = '';
let lastLogged = '';

const view = new CaptionView($('stage'), 4);
const host = new RoomHost(view, () => render(), (c) => fromPhone(c));
const dodger = new Dodger(1000);


function render(): void {
  const st = host.state;
  const k = `room=${st.code} ready=${st.ready} net=${st.net} teacher=${st.teacher} live=${st.live} paused=${st.paused} mic=${st.micOk} pos=${set.position} hidden=${set.hidden} screen=${placedOn}`;
  if (k !== lastLogged) native.log((lastLogged = k));
  const v = decide(st, { hidden: set.hidden, showCode: Date.now() < showCodeUntil });
  $('box').hidden = !v.box;
  setChip(v.chip);
  $('card').hidden = !v.card;
  if (v.card && st.code !== shownCode) showCode(st.code);
  if (st.teacher) showCodeUntil = 0; // paired: the card's job is done
  pushMenu();
}

function setChip(c: Chip): void {
  const chip = $('chip');
  chip.hidden = !c;
  if (!c) return;
  chip.dataset.kind = c;
  chip.textContent = c === 'waiting' ? s.waiting : c === 'paused' ? s.paused : s.interrupted;
}

function webUrl(): string {
  if (WEB_URL) return WEB_URL.replace(/\/?$/, '/');
  // In a browser (tests, dev) the overlay is served next to the web app.
  return location.protocol.startsWith('http') ? new URL('../', location.href).href : '';
}

function showCode(code: string): void {
  shownCode = code;
  $('code').textContent = code;
  const base = webUrl();
  if (base) {
    generate(base + 'speak/?room=' + code).toCanvas($('qr') as HTMLCanvasElement);
    const u = new URL(base + 'speak/');
    $('card-hint').textContent = fill(s.cardHint, { url: u.host + u.pathname });
  }
}

/** Settings sent by the teacher's phone. */
function fromPhone(c: Cfg): void {
  if (c.size) set.size = clamp(c.size, 2.5, 10);
  if (c.lines) set.lines = clamp(Math.round(c.lines), 1, 4);
  if (typeof c.margin === 'number') set.margin = clamp(c.margin, 0, 15);
  if (c.position === 'top' || c.position === 'bottom') {
    native.log('phone set position ' + c.position);
    set.position = c.position;
  }
  if (typeof c.dodge === 'boolean') set.dodge = c.dodge;
  if ((c.lang === 'en' || c.lang === 'fr') && c.lang !== set.lang) {
    set.lang = c.lang;
    s = strings(set.lang);
    applyStrings(document, s);
    shownCode = '';
  }
  save();
  style();
  render();
}

/** Menu-bar items and global shortcuts. */
function action(id: string): void {
  log('overlay', 'action ' + id);
  native.log('page got action ' + id);
  if (id === 'pos-top' || id === 'pos-bottom') movePosition(id === 'pos-top' ? 'top' : 'bottom');
  else if (id === 'toggle-hide') set.hidden = !set.hidden;
  else if (id === 'toggle-dodge') set.dodge = !set.dodge;
  else if (id === 'show-code') showCodeUntil = Date.now() + 120_000;
  else if (id === 'toggle-autostart') {
    native.autostart(!set.autostart).then((on) => {
      set.autostart = on;
      save();
      pushMenu();
    });
  } else if (id.startsWith('monitor:')) {
    set.monitor = id.slice('monitor:'.length);
    placeWindow();
  }
  save();
  style();
  render();
}

function movePosition(p: Position): void {
  set.position = p;
  // Keep the phone's Top/Bottom buttons in step.
  host.tellTeacher({ t: 'cfg', position: p });
}

function checkDodge(): void {
  if (!set.dodge || $('box').hidden) return;
  native.cursor().then((c) => {
    if (dodger.update(c, $('box').getBoundingClientRect(), Date.now())) {
      log('overlay', 'moved out of the pointer’s way');
      movePosition(opposite(set.position));
      save();
      style();
    }
  });
}

/** Follow the projector: re-place whenever the set of screens changes. */
function watchMonitors(): void {
  const check = () =>
    native.monitors().then((list) => {
      if (!knownMonitors || list.join('|') !== knownMonitors.join('|')) {
        log('overlay', 'screens: ' + list.join(', '));
        knownMonitors = list;
        placeWindow();
      }
    });
  check();
  setInterval(check, 3000);
}

function placeWindow(): void {
  native.place(set.monitor).then((name) => {
    placedOn = name;
    save();
    pushMenu();
  });
}

function pushMenu(): void {
  const st = host.state;
  const status = !st.ready
    ? st.net === 'offline'
      ? s.statusOffline
      : s.statusConnecting
    : fill(st.live && st.teacher ? s.statusLive : st.teacher ? s.statusTeacher : s.statusWaiting, { code: st.code });
  const m: native.MenuState = {
    status,
    code: st.code,
    position: set.position,
    dodge: set.dodge,
    hidden: set.hidden,
    autostart: set.autostart,
    monitor: set.monitor || '',
    monitors: knownMonitors || [],
    labels: {
      showCode: s.menuShowCode,
      position: s.menuPosition,
      top: s.top,
      bottom: s.bottom,
      display: s.menuDisplay,
      projector: s.menuProjector,
      hide: s.menuHide,
      dodge: s.menuDodge,
      autostart: s.menuAutostart,
      quit: s.menuQuit,
      placedOn,
    },
  };
  const k = JSON.stringify(m);
  if (k === lastMenu) return;
  lastMenu = k;
  native.setMenu(m);
}

function style(): void {
  const root = document.documentElement.style;
  root.setProperty('--size', String(set.size));
  root.setProperty('--lines', String(set.lines));
  root.setProperty('--margin', String(set.margin));
  document.body.dataset.position = set.position;
  document.documentElement.lang = set.lang;
}

function load(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(safeGet('lcc.overlay') || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

function save(): void {
  safeSet('lcc.overlay', JSON.stringify(set));
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// Test hook.
(window as any).__lcc = { get code() { return host.state.code; }, get settings() { return set; } };

// Start last, once every declaration above exists: callbacks fire as soon as the host starts.
function boot(): void {
  applyStrings(document, s);
  style();
  host.start();
  native.onAction(action);
  watchMonitors();
  setInterval(render, 1000); // card timeout, menu status
  setInterval(() => native.reassert(), 2000);
  setInterval(checkDodge, 200);
  log('overlay', 'started' + (native.inApp ? ' in app' : ' in browser'));
}
boot();
