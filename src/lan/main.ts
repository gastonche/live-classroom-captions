// Student page served by the desktop app on the school Wi-Fi (src-tauri/src/lan.rs): no
// internet, no WebRTC, no room code. Captions arrive over a WebSocket from the laptop that
// served this page; the whole session stays here to scroll back through.
import { CaptionView } from '../captions';
import { SeqFilter, decode, type Msg } from '../protocol';
import { SILENCE_MS } from '../config';
import { Backoff } from '../backoff';
import { applyStrings, detectLang, strings } from '../i18n';
import { keepAwake } from '../wake';

const $ = (id: string) => document.getElementById(id)!;
const s = strings(detectLang());
applyStrings(document, s);

const box = $('transcript');
const view = new CaptionView(box, 0);
const filter = new SeqFilter();
const backoff = new Backoff(500, 5000);
let ws: WebSocket | null = null;
let connected = false;
let lastHeard = 0;
let live = true;
let paused = false;
let micOk = true;
let teacher = true;

function connect(): void {
  const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
  const sock = new WebSocket(url);
  ws = sock;
  sock.onopen = () => {
    connected = true;
    lastHeard = Date.now();
    backoff.reset();
    show();
  };
  sock.onmessage = (e) => {
    lastHeard = Date.now();
    const m = decode(e.data);
    if (m) onMsg(m);
  };
  sock.onclose = () => {
    if (ws !== sock) return;
    connected = false;
    ws = null;
    show();
    setTimeout(connect, backoff.next());
  };
}

function onMsg(m: Msg): void {
  const stick = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  switch (m.t) {
    case 'sync':
      view.load(m.text);
      live = m.live;
      paused = m.paused;
      teacher = m.teacher;
      if (typeof m.mic === 'boolean') micOk = m.mic;
      break;
    case 'i':
    case 'f':
      if (!filter.accept(m)) return;
      if (m.t === 'f') view.final(m.text);
      else view.interim(m.text);
      break;
    case 'pause':
      paused = m.on;
      break;
    case 'live':
      live = m.on;
      if (!m.on) micOk = true;
      break;
    case 'mic':
      micOk = m.ok;
      break;
    case 'state':
      teacher = m.teacher;
      live = m.live;
      paused = m.paused;
      break;
  }
  show();
  if (stick) box.scrollTop = box.scrollHeight;
}

function show(): void {
  const msg = !connected
    ? s.connecting
    : !teacher || !live
      ? s.waiting
      : paused
        ? s.paused
        : !micOk
          ? s.interrupted
          : '';
  $('state').textContent = msg;
  $('state').hidden = !msg;
}

// A connection can look open after the Wi-Fi went away: reconnect if the laptop goes quiet
// (it sends something at least every 5 s).
setInterval(() => {
  if (ws && connected && Date.now() - lastHeard > SILENCE_MS) ws.close();
}, 1000);

keepAwake();
connect();
show();

// Test hook.
(window as any).__lan = { get connected() { return connected; } };
