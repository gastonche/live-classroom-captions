// Student view (/view): the whole session's captions, free to scroll back.
// It sticks to the bottom only while the reader is already at the bottom.
import { RoomLink, type LinkStatus } from '../link';
import { normalizeCode } from '../room';
import { CaptionView } from '../captions';
import { SeqFilter, type Msg } from '../protocol';
import { applyStrings, detectLang, safeGet, safeSet, strings } from '../i18n';
import { keepAwake } from '../wake';
import { registerSW } from '../sw/register';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const s = strings(detectLang());
applyStrings(document, s);

const box = $('transcript');
const view = new CaptionView(box, 0);
const filter = new SeqFilter();
let link: RoomLink | null = null;
let teacher = true;
let paused = false;
let micOk = true;

const start = normalizeCode(new URLSearchParams(location.search).get('room') || safeGet('lcc.viewroom') || '');
if (start) join(start);

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
  safeSet('lcc.viewroom', code);
  $('join').hidden = true;
  $('main').hidden = false;
  link = new RoomLink(code, 'view', onMsg, onStatus);
  keepAwake();
  onStatus(link.status);
}

function onMsg(m: Msg): void {
  const stick = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  switch (m.t) {
    case 'sync':
      view.load(m.text);
      teacher = m.teacher;
      paused = m.paused;
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
    case 'mic':
      micOk = m.ok;
      break;
    case 'live':
      if (!m.on) micOk = true;
      break;
    case 'state':
      teacher = m.teacher;
      paused = m.paused;
      break;
  }
  showState(link ? link.status : 'connecting');
  if (stick) box.scrollTop = box.scrollHeight;
}

function onStatus(st: LinkStatus): void {
  showState(st);
}

function showState(st: LinkStatus): void {
  const msg =
    st === 'connected' ? (!teacher ? s.waiting : paused ? s.paused : !micOk ? s.interrupted : '') : st === 'notfound' ? s.offline : s.connecting;
  $('state').textContent = msg;
  $('state').hidden = !msg;
}

registerSW('../');
