// Teacher phone (/speak): pair with a screen, listen, fix technical words, send captions.
import { RoomLink, type LinkStatus } from '../link';
import { normalizeCode, randomToken } from '../room';
import { CaptionView } from '../captions';
import type { Cfg, Lang, Msg } from '../protocol';
import { applyStrings, detectLang, fill, safeGet, safeSet, strings } from '../i18n';
import { keepAwake, retryOnGesture } from '../wake';
import { bcp47, type EngineProblem, type EngineState, type SpeechEngine } from '../speech/engine';
import { WebSpeechEngine } from '../speech/webspeech';
import { FakeEngine } from '../speech/fake';
import { bindEditor, fixer } from './words';
import { bindTapFix } from './tapfix';
import { log, report } from '../diag';
import { Transcript, formatTranscript, transcriptFileName } from '../transcript';
import { registerSW } from '../sw/register';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
let lang: Lang = detectLang();
let s = strings(lang);
document.documentElement.lang = lang;
applyStrings(document, s);

const sid = randomToken(6);
let seq = 0;
let utt = 0;
let link: RoomLink | null = null;
let live = false;
let paused = false;
let micState: EngineState = 'idle';
let problem: EngineProblem | undefined;
let fix = fixer(lang);
const preview = new CaptionView($('preview'), 2);
const transcript = new Transcript();
let ended = false;
// Mic health reported to the screen: down for MIC_DOWN_MS while live means "interrupted".
const MIC_DOWN_MS = 5000;
let micDownSince = 0;
let micReported = false;
const cfg: Required<Omit<Cfg, 't'>> = { size: 6, lines: 3, margin: 5, lang, position: 'bottom', dodge: false, ...readCfg() };

const events = {
  interim: (t: string) => caption('i', t),
  final: (t: string) => caption('f', t),
  state: (st: EngineState, p?: EngineProblem) => {
    if (st !== micState || p !== problem) log('mic-state', st + (p ? ' ' + p : ''));
    micState = st;
    problem = st === 'error' ? p : undefined;
    micHealth();
    render();
  },
};
const engine: SpeechEngine =
  new URLSearchParams(location.search).get('engine') === 'fake' ? new FakeEngine(events) : new WebSpeechEngine(events);

// Entry: ?room=CODE (from the QR code), else the last screen, else ask.
const fromUrl = normalizeCode(new URLSearchParams(location.search).get('room') || '');
const remembered = normalizeCode(safeGet('lcc.room') || '');
if (fromUrl || remembered) join((fromUrl || remembered)!);

$('code').addEventListener('input', () => {
  const c = normalizeCode($<HTMLInputElement>('code').value);
  if (c) join(c);
});
$('connect').addEventListener('click', () => {
  const c = normalizeCode($<HTMLInputElement>('code').value);
  if (c) join(c);
  else $('join-error').textContent = s.badCode;
});

function join(code: string): void {
  if (link) link.close();
  $('join-error').textContent = '';
  $('room').textContent = code;
  $('join').hidden = true;
  $('main').hidden = false;
  link = new RoomLink(code, 'speak', fromScreen, () => render());
  link.onJoin = () => {
    safeSet('lcc.room', code);
    // Resend state after every (re)connect: the screen may have reloaded. Size, lines and
    // margin stay with each screen (a TV and an overlay want different sizes); they're
    // only sent when the teacher moves a slider.
    link!.send({ t: 'cfg', lang: cfg.lang, position: cfg.position, dodge: cfg.dodge });
    if (live) link!.send({ t: 'live', on: true });
    if (paused) link!.send({ t: 'pause', on: true });
    if (micReported) link!.send({ t: 'mic', ok: false });
  };
  render();
}

/** Messages from the screen: the overlay reports position changes made on the computer. */
function fromScreen(m: Msg): void {
  if (m.t === 'cfg' && (m.position === 'top' || m.position === 'bottom')) {
    cfg.position = m.position;
    safeSet('lcc.speakcfg', JSON.stringify(cfg));
    render();
  }
}

function listen(): void {
  engine.start(bcp47(lang));
}

$('start').addEventListener('click', () => {
  log('app', 'start captions');
  live = true;
  paused = false;
  ended = false;
  transcript.start();
  link?.send({ t: 'live', on: true });
  listen(); // inside the tap: iOS only grants the mic and media here
  keepAwake(new URL('../keepawake.mp4', location.href).href);
  retryOnGesture();
  render();
});
$('pause').addEventListener('click', () => {
  paused = !paused;
  log('app', paused ? 'pause' : 'resume');
  link?.send({ t: 'pause', on: paused });
  // Private moments: the mic really stops, not just the screen.
  if (paused) engine.stop();
  else listen();
  render();
});
$('end').addEventListener('click', () => {
  log('app', 'end');
  live = false;
  paused = false;
  engine.stop();
  link?.send({ t: 'live', on: false });
  ended = true;
  render();
});

// End of session: the transcript lives only on this phone until saved or shared.
function transcriptFile(): File {
  const text = formatTranscript(transcript, link ? link.code : '-');
  return new File([text], transcriptFileName(transcript), { type: 'text/plain' });
}
$('t-download').addEventListener('click', () => {
  const f = transcriptFile();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(f);
  a.download = f.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
});
$('t-share').addEventListener('click', () => {
  const f = transcriptFile();
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  const data: ShareData = nav.canShare && nav.canShare({ files: [f] }) ? { files: [f], title: f.name } : { title: f.name, text: formatTranscript(transcript, link ? link.code : '-') };
  navigator.share(data).catch(() => {});
});
$('t-done').addEventListener('click', () => {
  ended = false;
  render();
});

// One-time hint to install, shown only in iPhone/iPad Safari outside the home-screen app.
const standalone = (navigator as any).standalone === true || matchMedia('(display-mode: standalone)').matches;
$('a2hs').hidden = !(/iPhone|iPad/.test(navigator.userAgent) && !standalone && !safeGet('lcc.a2hs'));
$('a2hs-ok').addEventListener('click', () => {
  safeSet('lcc.a2hs', '1');
  $('a2hs').hidden = true;
});
$('forget').addEventListener('click', () => {
  engine.stop();
  live = false;
  link?.close();
  link = null;
  safeSet('lcc.room', '');
  $('main').hidden = true;
  $('join').hidden = false;
  $<HTMLInputElement>('code').value = '';
  $('code').focus();
});

function micHealth(): void {
  const down = live && !paused && micState !== 'listening';
  if (!down) {
    micDownSince = 0;
    if (micReported) {
      micReported = false;
      link?.send({ t: 'mic', ok: true });
    }
    return;
  }
  if (!micDownSince) micDownSince = Date.now();
  if (!micReported && Date.now() - micDownSince > MIC_DOWN_MS) {
    micReported = true;
    log('app', 'mic down for 5s, told the screen');
    link?.send({ t: 'mic', ok: false });
  }
}
setInterval(micHealth, 1000);

// iOS sometimes refuses to restart the mic without a tap. Any tap on the phone counts,
// and that tap does nothing else (it doesn't open tap-to-fix on the preview).
let tapResumed = false;
document.addEventListener('pointerdown', (e) => {
  tapResumed = live && !paused && problem === 'needs-tap' && !(e.target as Element).closest('#fix');
  if (tapResumed) {
    log('app', 'tap anywhere resumed the mic');
    listen();
  }
});

// One plain-language problem at a time, with one fix.
$('fix').addEventListener('click', () => {
  log('app', 'tapped fix for ' + problem);
  if (problem === 'blocked') {
    $('fix-help').textContent = s.errBlockedHelp;
    $('fix-help').hidden = false;
  } else if (problem === 'needs-tap' || problem === 'no-mic') {
    listen();
  }
});

function render(): void {
  $('ended').hidden = !ended;
  $('ended-help').textContent = transcript.empty ? s.endedEmpty : s.endedHelp;
  $('t-download').hidden = $('t-share').hidden = transcript.empty;
  if (typeof navigator.share !== 'function') $('t-share').hidden = true;
  $('start').hidden = live || ended;
  $('controls').hidden = !live;
  $('type-box').hidden = !live;
  $('position').hidden = !live;
  $('pos-top').setAttribute('aria-pressed', String(cfg.position === 'top'));
  $('pos-bottom').setAttribute('aria-pressed', String(cfg.position === 'bottom'));
  $('pause').textContent = paused ? s.resume : s.pause;

  const mic: Record<EngineState, [string, string]> = {
    idle: ['off', s.micOff],
    listening: ['ok', s.micListening],
    restarting: ['wait', s.micRestarting],
    error: ['bad', s.micBlocked],
  };
  $('chip-mic').setAttribute('data-s', mic[micState][0]);
  $('mic-state').textContent = mic[micState][1];
  $('chip-engine').setAttribute('data-s', 'ok');
  $('engine-state').textContent = engine.online ? s.engineOnline : s.engineOffline;

  const fixText =
    problem === 'blocked'
      ? s.errBlocked
      : problem === 'needs-tap'
        ? s.errNeedsTap
        : problem === 'unsupported'
          ? s.errUnsupported
          : problem === 'no-mic'
            ? s.errNoMic
            : '';
  $('fix').textContent = fixText;
  $('fix').hidden = !fixText;
  if (!fixText) $('fix-help').hidden = true;

  if (link) {
    const st: LinkStatus = link.status;
    const tv: Record<LinkStatus, [string, string]> = {
      connected: ['ok', s.tvConnected],
      connecting: ['wait', s.tvConnecting],
      offline: ['wait', s.tvConnecting],
      notfound: ['bad', s.tvOffline],
      busy: ['bad', s.tvOffline],
    };
    $('chip-tv').setAttribute('data-s', tv[st][0]);
    $('tv-state').textContent = tv[st][1];
    $('main-error').textContent =
      st === 'notfound' ? fill(s.notFound, { code: link.code }) : st === 'busy' ? s.tvBusy : '';
  }
}

// Typed captions: each keystroke is an interim, Enter makes it final.
const testInput = $<HTMLInputElement>('test-text');
testInput.addEventListener('input', () => caption('i', testInput.value));
$('test').addEventListener('submit', (e) => {
  e.preventDefault();
  if (!testInput.value.trim()) return;
  caption('f', testInput.value);
  testInput.value = '';
});

/** The single path every caption takes, spoken or typed. */
function caption(t: 'i' | 'f', raw: string): void {
  const text = fix.apply(raw);
  if (t === 'f' && live) transcript.add(text);
  if (t === 'f') preview.final(text);
  else preview.interim(text);
  link?.send({ t, id: utt, text, seq: ++seq, sid, at: Date.now() });
  if (t === 'f') utt++;
}

// Settings
const sel = $<HTMLSelectElement>('lang');
sel.value = lang;
sel.addEventListener('change', () => {
  lang = sel.value as Lang;
  safeSet('lcc.lang', lang);
  s = strings(lang);
  document.documentElement.lang = lang;
  applyStrings(document, s);
  fix = fixer(lang);
  showWords();
  tapFix.close();
  setCfg({ lang });
  // Switch recognition language straight away if listening.
  if (live && !paused) listen();
  render();
});
for (const k of ['size', 'lines', 'margin'] as const) {
  const input = $<HTMLInputElement>(k);
  input.value = String(cfg[k]);
  input.addEventListener('input', () => setCfg({ [k]: Number(input.value) }));
}

// Overlay placement: one position, changed whenever the demo needs it.
for (const p of ['top', 'bottom'] as const) {
  $('pos-' + p).addEventListener('click', () => {
    setCfg({ position: p });
    render();
  });
}
const dodgeBox = $<HTMLInputElement>('dodge');
dodgeBox.checked = cfg.dodge;
dodgeBox.addEventListener('change', () => setCfg({ dodge: dodgeBox.checked }));

function setCfg(c: Partial<Cfg>): void {
  Object.assign(cfg, c);
  safeSet('lcc.speakcfg', JSON.stringify(cfg));
  link?.send({ t: 'cfg', ...c });
}

function readCfg(): Partial<Cfg> {
  try {
    return JSON.parse(safeGet('lcc.speakcfg') || '{}');
  } catch {
    return {};
  }
}

const showWords = bindEditor(
  {
    text: $<HTMLTextAreaElement>('words'),
    save: $('words-save'),
    reset: $('words-reset'),
    importInput: $<HTMLInputElement>('words-import'),
    exportBtn: $('words-export'),
    msg: $('words-msg'),
  },
  () => lang,
  () => (fix = fixer(lang)),
  () => s.saved,
);

// Tap a wrong word in the preview to add a word-list rule for it.
const tapFix = bindTapFix(
  {
    preview: $('preview'),
    panel: $<HTMLFormElement>('tapfix'),
    chips: $('tapfix-words'),
    label: $('tapfix-label'),
    input: $<HTMLInputElement>('tapfix-write'),
    cancel: $('tapfix-cancel'),
    hint: $('tapfix-hint'),
  },
  () => lang,
  () => s,
  () => {
    log('app', 'tap-to-fix added a rule');
    fix = fixer(lang);
    showWords();
  },
  () => tapResumed,
);

// Diagnostics: copy or share the event log.
function diagText(): string {
  return report({ room: link ? link.code : '-', lang, live: String(live), paused: String(paused), mic: micState, screen: link ? link.status : '-' });
}
$('diag-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(diagText());
    $('diag-msg').textContent = s.copied;
  } catch {
    $('diag-msg').textContent = s.copyFailed;
  }
});
$('diag-share').hidden = typeof navigator.share !== 'function';
$('diag-share').addEventListener('click', () => {
  navigator.share({ title: 'Captions diagnostics', text: diagText() }).catch(() => {});
});

log('app', 'speak page loaded');
render();

// Test hook: lets the end-to-end latency harness send captions directly. Harmless in production.
(window as any).__lcc = { caption };

registerSW('../', () => live);
