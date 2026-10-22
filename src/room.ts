import { PEER_PREFIX } from './config';

// No 0/O, 1/I/L or 5/S: codes are read off a screen across a room.
export const ALPHABET = 'ABCDEFGHJKMNPQRTUVWXYZ2346789';
export const CODE_LENGTH = 4;

export function newCode(rand: (n: number) => number = randomInt): string {
  let s = '';
  for (let i = 0; i < CODE_LENGTH; i++) s += ALPHABET[rand(ALPHABET.length)];
  return s;
}

/** Uppercases and strips spaces and dashes. Returns null unless it's a valid code. */
export function normalizeCode(input: string): string | null {
  const s = input.toUpperCase().replace(/[\s-]/g, '');
  if (s.length !== CODE_LENGTH) return null;
  for (const c of s) if (ALPHABET.indexOf(c) < 0) return null;
  return s;
}

export function peerId(code: string): string {
  return PEER_PREFIX + code;
}

export function randomToken(bytes = 16): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  let s = '';
  for (let i = 0; i < a.length; i++) s += (a[i] < 16 ? '0' : '') + a[i].toString(16);
  return s;
}

function randomInt(n: number): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] % n;
}
