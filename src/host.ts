// Room host: the screen side of a room, shared by the browser screen (/show) and the
// desktop overlay. Owns the room peer, decides who the teacher is, relays captions to
// student viewers and tracks live/paused/mic state. The UI only renders `state`.
import { Peer, type DataConnection } from 'peerjs';
import { HEARTBEAT_MS, SILENCE_MS, signalOptions } from './config';
import { newCode, peerId, randomToken } from './room';
import { decode, encode, SeqFilter, type Cfg, type Msg } from './protocol';
import type { CaptionView } from './captions';
import { Retrier } from './backoff';
import { safeGet, safeSet } from './i18n';
import { log } from './diag';

export type NetState = 'connecting' | 'online' | 'offline';

export type HostState = {
  code: string;
  /** True once the room is registered with the signalling server and the code can be shown. */
  ready: boolean;
  net: NetState;
  teacher: boolean;
  live: boolean;
  paused: boolean;
  micOk: boolean;
};

export class RoomHost {
  readonly state: HostState;
  private filter = new SeqFilter();
  private retry = new Retrier();
  private storedCode: boolean;
  private takenTries = 0;
  private peer!: Peer;
  private teacher: DataConnection | null = null;
  private teacherSeen = 0;
  private viewers = new Set<DataConnection>();
  private lastState = '';
  /** The computer itself is the teacher (desktop app with its own microphone). */
  private local = false;
  /** Room problems (e.g. "browser-incompatible" when the web engine lacks WebRTC). */
  onError: (type: string) => void = () => {};
  /** Every message for viewers, as sent: the desktop app forwards these to phones on the Wi-Fi. */
  // New per page load, so viewers don't drop captions as repeats after the app restarts.
  private localSid = 'local-' + Date.now().toString(36);
  onBroadcast: (data: string) => void = () => {};
  private localSeq = 0;
  private localId = 0;

  constructor(
    private view: CaptionView,
    private onChange: (s: HostState) => void,
    private onCfg: (c: Cfg) => void,
  ) {
    const saved = safeGet('lcc.code');
    this.storedCode = !!saved;
    this.state = { code: saved || newCode(), ready: false, net: 'connecting', teacher: false, live: false, paused: false, micOk: true };
  }

  /** Desktop app: no internet room at all. Viewers are reached through onBroadcast. */
  startLocal(): void {
    this.set({ ready: true, net: 'online' });
  }

  /** What a viewer joining now needs first: the session so far and its state. */
  snapshot(): string {
    const { live, paused, micOk } = this.state;
    return encode({ t: 'sync', text: this.view.transcript, live, paused, teacher: this.teacherPresent(), mic: micOk });
  }

  start(): void {
    this.open();
    setInterval(() => this.tick(), 1000);
    setInterval(() => this.broadcast({ t: 'ping', at: Date.now() }, true), HEARTBEAT_MS);
    // Back online: reconnect signalling now instead of waiting for the retry timer.
    window.addEventListener('online', () => {
      this.retry.cancel();
      if (this.peer.destroyed) this.open();
      else if (this.peer.disconnected) this.peer.reconnect();
    });
  }

  /** Desktop mode: captions come from this computer's microphone; phones can only watch. */
  setLocal(on: boolean): void {
    this.local = on;
    this.set({ teacher: this.teacherPresent() });
  }

  localLive(on: boolean): void {
    this.broadcast({ t: 'live', on });
    this.set(on ? { live: true, paused: false } : { live: false, paused: false, micOk: true });
  }

  localPause(on: boolean): void {
    this.broadcast({ t: 'pause', on });
    this.set({ paused: on });
  }

  localMic(ok: boolean): void {
    if (ok === this.state.micOk) return;
    this.broadcast({ t: 'mic', ok });
    this.set({ micOk: ok });
  }

  /** A caption from this computer's own recognition (already through the word lists). */
  localCaption(t: 'i' | 'f', text: string): void {
    const m = { t, id: this.localId, text, seq: ++this.localSeq, sid: this.localSid } as const;
    if (t === 'f') {
      this.view.final(text);
      this.localId++;
    } else {
      this.view.interim(text);
    }
    this.broadcast(m);
  }

  /** Sends a message to the teacher's phone, e.g. a position change made on the computer. */
  tellTeacher(m: Msg): void {
    if (this.teacher) send(this.teacher, m);
  }

  private set(patch: Partial<HostState>): void {
    Object.assign(this.state, patch);
    this.onChange(this.state);
    this.broadcast({ t: 'state', teacher: this.state.teacher, live: this.state.live, paused: this.state.paused });
  }

  private open(): void {
    this.set({ net: 'connecting' });
    const peer = (this.peer = new Peer(peerId(this.state.code), signalOptions()));
    peer.on('open', () => {
      this.retry.succeeded();
      this.takenTries = 0;
      safeSet('lcc.code', this.state.code);
      this.storedCode = true;
      log('room', 'open ' + this.state.code);
      this.set({ ready: true, net: 'online' });
    });
    peer.on('connection', (c) => this.accept(c));
    peer.on('disconnected', () => {
      // Signalling lost. Open data connections keep working; reconnect for new ones.
      this.set({ net: 'offline' });
      this.retry.schedule(() => (peer.destroyed ? this.open() : peer.reconnect()));
    });
    peer.on('error', (e) => {
      log('room', 'error ' + e.type);
      this.onError(e.type);
      if (e.type === 'unavailable-id') {
        // After a reload the server may still hold our old session for a moment.
        // Keep a remembered code for a few tries, then pick a new one.
        peer.destroy();
        if (!this.storedCode || ++this.takenTries > 5) {
          this.state.code = newCode();
          this.storedCode = false;
        }
        this.retry.schedule(() => this.open());
      } else if (peer.destroyed) {
        this.retry.schedule(() => this.open());
      } else if (peer.disconnected) {
        this.retry.schedule(() => peer.reconnect());
      }
    });
  }

  private accept(conn: DataConnection): void {
    let role: 'speak' | 'view' | null = null;
    conn.on('data', (raw) => {
      const m = decode(raw);
      if (!m) return;
      if (m.t === 'hello') {
        role = m.role === 'speak' ? this.hello(conn, m.token) : 'view';
        if (role === 'view') {
          this.viewers.add(conn);
          const { live, paused } = this.state;
          send(conn, { t: 'sync', text: this.view.transcript, live, paused, teacher: this.teacherPresent() });
          if (!this.state.micOk) send(conn, { t: 'mic', ok: false });
        }
        return;
      }
      if (role === 'speak' && conn === this.teacher) this.fromTeacher(m);
    });
    conn.on('close', () => this.drop(conn));
    conn.on('error', () => this.drop(conn));
  }

  /** Teacher trust: a remembered token always wins; otherwise only an empty seat can be taken. */
  private hello(conn: DataConnection, token?: string): 'speak' | null {
    const trusted = safeGet('lcc.token');
    if (this.local || (!(token && token === trusted) && this.teacherPresent())) {
      send(conn, { t: 'reject', reason: 'busy' });
      setTimeout(() => conn.close(), 500);
      return null;
    }
    const t = token && token === trusted ? token : randomToken();
    safeSet('lcc.token', t);
    if (this.teacher && this.teacher !== conn) this.teacher.close();
    this.teacher = conn;
    this.teacherSeen = Date.now();
    send(conn, { t: 'welcome', token: t });
    log('room', 'teacher joined');
    // The phone resends mic state if it's still down.
    this.set({ teacher: true, micOk: true });
    return 'speak';
  }

  private fromTeacher(m: Msg): void {
    this.teacherSeen = Date.now();
    if (!this.state.teacher) this.set({ teacher: true });
    switch (m.t) {
      case 'ping':
        // Echo, so the phone can check the channel right after a network change.
        if (this.teacher) send(this.teacher, { t: 'ping', at: m.at });
        return;
      case 'i':
      case 'f':
        if (!this.filter.accept(m)) return;
        if (m.t === 'f') this.view.final(m.text);
        else this.view.interim(m.text);
        this.broadcast(m);
        return;
      case 'live':
        this.broadcast(m);
        this.set(m.on ? { live: true } : { live: false, paused: false, micOk: true });
        return;
      case 'mic':
        this.broadcast(m);
        this.set({ micOk: m.ok });
        return;
      case 'pause':
        this.broadcast(m);
        this.set({ paused: m.on });
        return;
      case 'cfg':
        this.onCfg(m);
        return;
    }
  }

  private drop(conn: DataConnection): void {
    this.viewers.delete(conn);
    if (conn === this.teacher) {
      this.teacher = null;
      log('room', 'teacher left');
      this.set({ teacher: false });
    }
  }

  private teacherPresent(): boolean {
    if (this.local) return true;
    return !!this.teacher && Date.now() - this.teacherSeen < SILENCE_MS;
  }

  private tick(): void {
    const p = this.teacherPresent();
    if (p !== this.state.teacher) this.set({ teacher: p });
  }

  private broadcast(m: Msg, includeTeacher = false): void {
    // Skip repeated identical state messages.
    if (m.t === 'state') {
      const k = JSON.stringify(m);
      if (k === this.lastState) return;
      this.lastState = k;
    }
    const data = encode(m);
    this.onBroadcast(data);
    this.viewers.forEach((v) => v.open && v.send(data));
    if (includeTeacher && this.teacher && this.teacher.open) this.teacher.send(data);
  }
}

function send(conn: DataConnection, m: Msg): void {
  if (conn.open) conn.send(encode(m));
}
