// Desktop app (docs/v2-desktop.md): this computer hears the teacher through its own
// microphone, recognises speech locally (src-tauri/src/asr.rs) and draws captions on top
// of whatever the projector shows. It hosts the room, so students can follow on their
// phones by scanning the QR code. Native window behaviour lives in src-tauri.
import { generate } from 'lean-qr/nano';
import { CaptionView } from '../captions';
import { RoomHost } from '../host';
import { WEB_URL } from '../config';
import type { Lang, Position } from '../protocol';
import { applyStrings, detectLang, fill, safeGet, safeSet, strings } from '../i18n';
import { log } from '../diag';
import { fixer } from '../speak/words';
import { Transcript, formatTranscript, transcriptFileName } from '../transcript';
import { decide, Dodger, opposite, type Chip } from './logic';
import * as native from './native';

const $ = (id: string) => document.getElementById(id)!;
native.log('page script running');

// If the microphone is down this long during a lesson, everyone sees "interrupted".
const MIC_DOWN_MS = 5000;

type Settings = {
  position: Position;
  dodge: boolean;
  hidden: boolean;
  monitor: string; // '' = automatic (the projector)
  mic: string; // '' = system default
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
  mic: '',
  size: 4.5,
  lines: 2,
  margin: 5,
  lang: detectLang(),
  autostart: false,
};
const set: Settings = load();
let s = strings(set.lang);
let fix = fixer(set.lang);
let placedOn = '';
let knownMonitors: string[] | null = null; // null until the first check, which always places
let mics: string[] = [];
// The student QR shows briefly at launch and at the start of a lesson, and on request.
let showCodeUntil = Date.now() + 30_000;
let shownCode = '';
let lastMenu = '';
let lastLogged = '';
// Lesson state on this computer.
let micName = '';
let micDownSince = 0;
let ending: ReturnType<typeof setTimeout> | undefined;
let notice = ''; // one-off status line in the menu (saved transcript, missing models)
const transcript = new Transcript();

const view = new CaptionView($('stage'), 4);
const host = new RoomHost(view, () => render(), () => {});
const dodger = new Dodger(1000);

function render(): void {
  const st = host.state;
  const k = `room=${st.code} ready=${st.ready} net=${st.net} live=${st.live} paused=${st.paused} mic=${st.micOk} pos=${set.position} hidden=${set.hidden} screen=${placedOn}`;
  if (k !== lastLogged) native.log((lastLogged = k));
  const v = decide(st, { hidden: set.hidden, showCode: Date.now() < showCodeUntil });
  $('box').hidden = !v.box;
  setChip(v.chip);
  $('card').hidden = !v.card;
  if (v.card && st.code !== shownCode) showCode(st.code);
  pushMenu();
}

function setChip(c: Chip): void {
  const chip = $('chip');
  chip.hidden = !c;
  if (!c) return;
  chip.dataset.kind = c;
  chip.textContent = c === 'waiting' ? s.waiting : c === 'paused' ? s.paused : s.micProblem;
}

function webUrl(): string {
  if (WEB_URL) return WEB_URL.replace(/\/?$/, '/');
  // In a browser (tests, dev) the overlay is served next to the web app.
  return location.protocol.startsWith('http') ? new URL('../', location.href).href : '';
}

/** The card is for students: it opens the follow-along page for this room. */
function showCode(code: string): void {
  shownCode = code;
  $('code').textContent = code;
  const base = webUrl();
  if (base) generate(base + 'view/?room=' + code).toCanvas($('qr') as HTMLCanvasElement);
  $('card-hint').textContent = s.studentHint;
}

// ---- Lesson: start, pause, end -------------------------------------------------------

function start(): void {
  if (host.state.live) return;
  clearTimeout(ending);
  ending = undefined;
  notice = '';
  transcript.start();
  view.clear();
  host.localLive(true);
  showCodeUntil = Date.now() + 60_000; // students join at the start
  listen();
}

function listen(): void {
  micDownSince = Date.now(); // until the engine says it's listening
  native.asrStart(set.mic).catch((e) => {
    notice = fill(s.modelsMissing, { detail: String(e) });
    native.log('asr start failed: ' + String(e));
    render();
  });
}

function togglePause(): void {
  if (!host.state.live) return;
  const paused = !host.state.paused;
  host.localPause(paused);
  // Private moments: the microphone really stops.
  if (paused) native.asrStop();
  else listen();
}

function end(): void {
  if (!host.state.live || ending) return;
  native.asrStop();
  // The engine finishes the sentence in progress and then reports "idle"; give it 3 s at most.
  ending = setTimeout(finishEnd, 3000);
}

function finishEnd(): void {
  clearTimeout(ending);
  ending = undefined;
  host.localLive(false);
  if (transcript.empty) return;
  const text = formatTranscript(transcript, host.state.code);
  native.saveTranscript(transcriptFileName(transcript), text).then(
    (path) => {
      notice = fill(s.statusSaved, { path: path.replace(/^.*\/(Documents\/)/, '$1') });
      render();
    },
    (e) => native.log('transcript save failed: ' + String(e)),
  );
}

/** Recognition events from this computer's microphone. */
function onAsr(e: native.AsrEvent): void {
  if (e.kind === 'interim' || e.kind === 'final') {
    if (!host.state.live) return;
    const text = fix.apply(e.text);
    if (e.kind === 'final') transcript.add(text);
    host.localCaption(e.kind === 'final' ? 'f' : 'i', text);
  } else if (e.kind === 'state') {
    native.log(`mic ${e.state} ${e.detail}`);
    if (e.state === 'listening') {
      micName = e.detail;
      micDownSince = 0;
      host.localMic(true);
    } else if (e.state === 'error') {
      micDownSince = micDownSince || Date.now();
    } else if (e.state === 'idle' && ending) {
      finishEnd();
    }
  } else if (e.kind === 'stats') {
    log('stats', `captured ${e.captured} processed ${e.processed} backlog ${e.backlog} rtf ${e.rtf.toFixed(3)} level ${e.level.toFixed(3)}`);
  }
  render();
}

/** While live and not paused, a microphone down for 5 s shows "interrupted" to everyone. */
function micHealth(): void {
  const st = host.state;
  if (!st.live || st.paused) return;
  if (micDownSince && Date.now() - micDownSince > MIC_DOWN_MS) host.localMic(false);
}

// ---- Menu-bar items and global shortcuts -----------------------------------------------

function action(id: string): void {
  log('overlay', 'action ' + id);
  native.log('page got action ' + id);
  if (id === 'start') start();
  else if (id === 'pause') togglePause();
  else if (id === 'end') end();
  else if (id === 'pos-top' || id === 'pos-bottom') movePosition(id === 'pos-top' ? 'top' : 'bottom');
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
  } else if (id.startsWith('mic:')) {
    set.mic = id.slice('mic:'.length);
    // Switch straight away if listening; the engine restarts on the new microphone.
    if (host.state.live && !host.state.paused) listen();
  } else if (id === 'lang:en' || id === 'lang:fr') {
    setLang(id.slice(5) as Lang);
  }
  save();
  style();
  render();
}

function setLang(lang: Lang): void {
  set.lang = lang;
  safeSet('lcc.lang', lang);
  s = strings(lang);
  fix = fixer(lang);
  applyStrings(document, s);
  shownCode = '';
}

function movePosition(p: Position): void {
  set.position = p;
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

/** Keep the microphone list current (USB and wireless mics come and go). */
function watchMics(): void {
  const check = () =>
    native.asrDevices().then((list) => {
      if (list.join('|') !== mics.join('|')) {
        mics = list;
        pushMenu();
      }
    });
  check();
  setInterval(check, 5000);
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
  const status = notice
    ? notice
    : !st.ready
      ? st.net === 'offline'
        ? s.statusOffline
        : s.statusConnecting
      : fill(st.live ? (st.paused ? s.statusPausedLocal : s.statusListening) : s.statusReady, {
          code: st.code,
          mic: micName || set.mic || s.menuMicDefault,
        });
  const m: native.MenuState = {
    status,
    code: st.code,
    position: set.position,
    dodge: set.dodge,
    hidden: set.hidden,
    autostart: set.autostart,
    monitor: set.monitor || '',
    monitors: knownMonitors || [],
    live: st.live,
    paused: st.paused,
    lang: set.lang,
    mic: set.mic,
    mics,
    labels: {
      start: s.menuStart,
      pause: s.menuPause,
      resume: s.menuResume,
      end: s.menuEnd,
      showCode: s.menuStudentQr,
      position: s.menuPosition,
      top: s.top,
      bottom: s.bottom,
      display: s.menuDisplay,
      projector: s.menuProjector,
      mic: s.menuMic,
      micDefault: s.menuMicDefault,
      language: s.menuLanguage,
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

// Test hook.
(window as any).__lcc = {
  get code() {
    return host.state.code;
  },
  get settings() {
    return set;
  },
  get transcript() {
    return formatTranscript(transcript, host.state.code);
  },
};

// Start last, once every declaration above exists: callbacks fire as soon as the host starts.
function boot(): void {
  applyStrings(document, s);
  style();
  host.setLocal(true);
  host.start();
  native.onAction(action);
  native.onAsr(onAsr);
  watchMonitors();
  watchMics();
  setInterval(render, 1000); // card timeout, menu status
  setInterval(micHealth, 1000);
  setInterval(() => native.reassert(), 2000);
  setInterval(checkDodge, 200);
  log('overlay', 'started' + (native.inApp ? ' in app' : ' in browser'));
}
boot();
