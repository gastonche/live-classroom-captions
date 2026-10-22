// Wire protocol between the teacher phone, the display and student viewers.
// Captions: {t:"i"|"f", id, text, seq, sid}. Seq numbers are per sender session (sid),
// so a reloaded phone starts a new sequence instead of looking stale.

export type Caption = { t: 'i' | 'f'; id: number; text: string; seq: number; sid: string; at?: number };
// position/dodge are for the desktop overlay; the browser screen ignores them.
export type Position = 'top' | 'bottom';
export type Cfg = { t: 'cfg'; size?: number; lines?: number; margin?: number; lang?: Lang; position?: Position; dodge?: boolean };
export type Lang = 'en' | 'fr';

export type Msg =
  | Caption
  | Cfg
  | { t: 'pause'; on: boolean }
  | { t: 'live'; on: boolean }
  | { t: 'mic'; ok: boolean }
  | { t: 'ping'; at: number }
  | { t: 'hello'; role: Role; token?: string }
  | { t: 'welcome'; token?: string }
  | { t: 'reject'; reason: 'busy' }
  | { t: 'state'; teacher: boolean; live: boolean; paused: boolean }
  | { t: 'sync'; text: string; live: boolean; paused: boolean; teacher: boolean };

export type Role = 'speak' | 'view';

const TYPES = new Set(['i', 'f', 'cfg', 'pause', 'live', 'mic', 'ping', 'hello', 'welcome', 'reject', 'state', 'sync']);

export function encode(m: Msg): string {
  return JSON.stringify(m);
}

/** Parses and shape-checks a message. Anything unexpected returns null and is ignored. */
export function decode(raw: unknown): Msg | null {
  let m: any = raw;
  if (typeof raw === 'string') {
    try {
      m = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!m || typeof m !== 'object' || !TYPES.has(m.t)) return null;
  if ((m.t === 'i' || m.t === 'f') && (typeof m.text !== 'string' || !isNum(m.id) || !isNum(m.seq) || typeof m.sid !== 'string'))
    return null;
  if ((m.t === 'pause' || m.t === 'live') && typeof m.on !== 'boolean') return null;
  if (m.t === 'mic' && typeof m.ok !== 'boolean') return null;
  if (m.t === 'hello' && m.role !== 'speak' && m.role !== 'view') return null;
  if (typeof m.text === 'string' && m.text.length > 5000) return null;
  return m as Msg;
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && isFinite(v);
}

/**
 * Drops duplicates and out-of-order messages, plus interims for utterances already finalised.
 * One tracker per receiver. A new sid (a reloaded phone) starts fresh.
 */
export class SeqFilter {
  private sid = '';
  private last = -1;
  private finalId = -1;

  accept(c: Caption): boolean {
    if (c.sid !== this.sid) {
      this.sid = c.sid;
      this.last = -1;
      this.finalId = -1;
    }
    if (c.seq <= this.last) return false;
    if (c.t === 'i' && c.id <= this.finalId) return false;
    this.last = c.seq;
    if (c.t === 'f') this.finalId = Math.max(this.finalId, c.id);
    return true;
  }
}
