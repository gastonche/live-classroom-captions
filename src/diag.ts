// On-device diagnostics: a short ring buffer of mic, connection and page events, so a
// teacher can copy exactly what happened when something sticks. Never records caption
// text, only lengths and states. Kept in localStorage so it survives a reload.

const KEY = 'lcc.diag';
const MAX = 400;

type Entry = [number, string, string]; // [epoch ms, kind, detail]

let entries: Entry[] = load();
let saveTimer: ReturnType<typeof setTimeout> | undefined;

export function log(kind: string, detail = ''): void {
  entries.push([Date.now(), kind, detail]);
  if (entries.length > MAX) entries = entries.slice(-MAX);
  // Batch writes: some events (results) come several times a second.
  if (saveTimer === undefined) {
    saveTimer = setTimeout(() => {
      saveTimer = undefined;
      save();
    }, 1000);
  }
}

/** Plain-text report: device, then one event per line, newest last, times relative to now. */
export function report(extra: Record<string, string> = {}): string {
  const now = Date.now();
  const head = [
    'Live Classroom Captions diagnostics',
    'at: ' + new Date(now).toISOString(),
    'ua: ' + navigator.userAgent,
    'standalone: ' + String((navigator as any).standalone === true || matchMedia('(display-mode: standalone)').matches),
    ...Object.keys(extra).map((k) => `${k}: ${extra[k]}`),
    '---',
  ];
  const lines = entries.map(([t, k, d]) => `${fmt(now - t)}  ${k}${d ? '  ' + d : ''}`);
  return head.concat(lines).join('\n');
}

export function count(): number {
  return entries.length;
}

export function clear(): void {
  entries = [];
  save();
}

function fmt(ago: number): string {
  const s = Math.round(ago / 1000);
  const m = Math.floor(s / 60);
  return `-${m}:${String(s % 60).padStart(2, '0')}`;
}

function load(): Entry[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(v) ? v.slice(-MAX) : [];
  } catch {
    return [];
  }
}

function save(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    /* storage full or blocked: keep it in memory only */
  }
}
