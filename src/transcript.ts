// Session transcript: kept in memory on the teacher's phone until the teacher saves or
// shares it. Nothing is uploaded. Finals within the same minute share one timestamped line.

export type Entry = { at: number; text: string };

export class Transcript {
  entries: Entry[] = [];
  startedAt = 0;

  start(now = Date.now()): void {
    this.entries = [];
    this.startedAt = now;
  }

  add(text: string, now = Date.now()): void {
    const t = text.trim();
    if (t) this.entries.push({ at: now, text: t });
  }

  get empty(): boolean {
    return this.entries.length === 0;
  }
}

const pad = (n: number) => String(n).padStart(2, '0');
const hm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function formatTranscript(t: Transcript, room: string, endedAt = Date.now()): string {
  const start = new Date(t.startedAt || (t.entries[0] ? t.entries[0].at : endedAt));
  const lines = [
    'Live Classroom Captions: transcript',
    `Date: ${ymd(start)}, ${hm(start)} to ${hm(new Date(endedAt))}`,
    `Room: ${room}`,
    '',
  ];
  let minute = '';
  let para = '';
  for (const e of t.entries) {
    const m = hm(new Date(e.at));
    if (m !== minute) {
      if (para) lines.push(para);
      minute = m;
      para = `[${m}] ${e.text}`;
    } else {
      para += ' ' + e.text;
    }
  }
  if (para) lines.push(para);
  return lines.join('\n') + '\n';
}

export function transcriptFileName(t: Transcript): string {
  const d = new Date(t.startedAt || Date.now());
  return `captions-${ymd(d)}-${pad(d.getHours())}${pad(d.getMinutes())}.txt`;
}
