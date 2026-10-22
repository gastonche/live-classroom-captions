// Client side of a room: the teacher phone (role "speak") or a student viewer ("view").
// Reconnects by itself after Wi-Fi drops, display reloads and signalling hiccups.
import { Peer, type DataConnection } from 'peerjs';
import { HEARTBEAT_MS, SILENCE_MS, signalOptions } from './config';
import { peerId } from './room';
import { decode, encode, type Msg, type Role } from './protocol';
import { Backoff, Retrier } from './backoff';
import { safeGet, safeSet } from './i18n';
import { log } from './diag';

export type LinkStatus = 'connecting' | 'connected' | 'offline' | 'notfound' | 'busy';

const MAX_QUEUE = 100;
// A dial can stall with neither 'open' nor 'close' (e.g. ICE never completes). Give up and retry.
const DIAL_TIMEOUT_MS = 6000;
const PROBE_MS = 2500;

export class RoomLink {
  status: LinkStatus = 'connecting';
  private peer: Peer | null = null;
  private conn: DataConnection | null = null;
  private retry = new Retrier(new Backoff(300, 3000));
  private lastHeard = 0;
  private lastPing = 0;
  // When the network comes back, ask the screen for a reply instead of waiting 10 s.
  private probeAt = 0;
  private queue: string[] = [];
  private beat: ReturnType<typeof setInterval> | undefined;
  private closed = false;
  /** Called after every successful (re)join, so the caller can resend its state. */
  onJoin: () => void = () => {};

  constructor(
    readonly code: string,
    private role: Role,
    private onMsg: (m: Msg) => void,
    private onStatus: (s: LinkStatus) => void,
  ) {
    this.beat = setInterval(() => this.heartbeat(), 1000);
    window.addEventListener('online', this.kick);
    window.addEventListener('online', onlineLog);
    window.addEventListener('offline', onlineLog);
    document.addEventListener('visibilitychange', this.kick);
    this.start();
  }

  /** Sends now if connected. Finals and control messages are queued while offline; interims are dropped. */
  send(m: Msg): void {
    const data = encode(m);
    if (this.status === 'connected' && this.conn && this.conn.open) {
      this.conn.send(data);
    } else if (m.t !== 'i' && m.t !== 'ping') {
      this.queue.push(data);
      if (this.queue.length > MAX_QUEUE) this.queue.shift();
    }
  }

  close(): void {
    this.closed = true;
    clearInterval(this.beat);
    this.retry.cancel();
    window.removeEventListener('online', this.kick);
    document.removeEventListener('visibilitychange', this.kick);
    if (this.conn) this.conn.close();
    if (this.peer) this.peer.destroy();
  }

  private get tokenKey(): string {
    return 'lcc.token.' + this.code;
  }

  private setStatus(s: LinkStatus): void {
    if (this.status === s) return;
    log('screen', s);
    this.status = s;
    this.onStatus(s);
  }

  private start(): void {
    if (this.closed) return;
    if (!this.peer || this.peer.destroyed) {
      this.peer = new Peer(signalOptions());
      this.peer.on('open', () => this.dial());
      this.peer.on('disconnected', () => {
        if (!this.closed) this.retry.schedule(() => this.peer && !this.peer.destroyed && this.peer.reconnect());
      });
      this.peer.on('error', (e) => {
        log('signal', 'error ' + e.type);
        if (e.type === 'peer-unavailable') {
          // Display not there (yet): maybe restarting. Keep trying, but say so.
          this.setStatus('notfound');
          this.again();
        } else if (this.peer && this.peer.destroyed) {
          this.peer = null;
          this.again();
        } else if (this.peer && this.peer.disconnected) {
          this.retry.schedule(() => this.peer && this.peer.reconnect());
        }
      });
    } else if (this.peer.open) {
      this.dial();
    } else if (this.peer.disconnected) {
      this.peer.reconnect();
    }
  }

  private dial(): void {
    if (this.closed || !this.peer) return;
    if (this.conn) this.conn.close();
    if (this.status !== 'notfound') this.setStatus('connecting');
    const conn = this.peer.connect(peerId(this.code), { reliable: true, serialization: 'raw' });
    this.conn = conn;
    setTimeout(() => {
      if (conn === this.conn && !conn.open) {
        conn.close();
        this.lost(conn);
      }
    }, DIAL_TIMEOUT_MS);
    conn.on('open', () => {
      this.lastHeard = Date.now();
      const token = this.role === 'speak' ? safeGet(this.tokenKey) || undefined : undefined;
      conn.send(encode({ t: 'hello', role: this.role, token }));
      if (this.role === 'view') this.joined();
    });
    conn.on('data', (raw) => {
      if (conn !== this.conn) return;
      this.lastHeard = Date.now();
      const m = decode(raw);
      if (!m) return;
      if (m.t === 'welcome') {
        if (m.token) safeSet(this.tokenKey, m.token);
        this.joined();
      } else if (m.t === 'reject') {
        this.setStatus('busy');
        this.retry.cancel();
        // A teacher seat can free up; check again slowly.
        setTimeout(() => this.status === 'busy' && this.again(), 10000);
      } else {
        this.onMsg(m);
      }
    });
    conn.on('close', () => this.lost(conn));
    conn.on('error', () => this.lost(conn));
  }

  private joined(): void {
    this.retry.succeeded();
    this.setStatus('connected');
    this.onJoin();
    const q = this.queue;
    this.queue = [];
    for (const d of q) this.conn!.send(d);
  }

  private lost(conn: DataConnection): void {
    if (conn !== this.conn || this.closed || this.status === 'busy') return;
    this.conn = null;
    this.setStatus('offline');
    this.again();
  }

  private again(): void {
    this.retry.schedule(() => this.start());
  }

  private heartbeat(): void {
    if (this.closed || this.status !== 'connected' || !this.conn) return;
    const probeFailed = this.probeAt && this.lastHeard < this.probeAt && Date.now() - this.probeAt > PROBE_MS;
    if (probeFailed) log('screen', 'no reply to probe, redialling');
    if (probeFailed || Date.now() - this.lastHeard > SILENCE_MS) {
      this.probeAt = 0;
      log('screen', `silent for ${Math.round((Date.now() - this.lastHeard) / 1000)}s, redialling`);
      // A data channel can look open long after the network went away.
      const c = this.conn;
      this.conn = null;
      c.close();
      this.setStatus('offline');
      this.again();
      return;
    }
    if (Date.now() - this.lastPing >= HEARTBEAT_MS) {
      this.lastPing = Date.now();
      this.conn.send(encode({ t: 'ping', at: this.lastPing }));
    }
  }

  private kick = (): void => {
    if (document.visibilityState === 'hidden' || this.closed) return;
    if (this.status === 'connected' && this.conn && this.conn.open) {
      // The channel may look open but be dead after a network change: probe it.
      this.probeAt = Date.now();
      this.conn.send(encode({ t: 'ping', at: this.probeAt }));
    } else if (this.status === 'offline' || this.status === 'notfound') {
      this.retry.cancel();
      this.start();
    }
  };
}

function onlineLog(e: Event): void {
  log('network', e.type);
}
