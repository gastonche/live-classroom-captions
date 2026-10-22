import { describe, expect, it } from 'vitest';
import { Transcript, formatTranscript, transcriptFileName } from '../../src/transcript';

const at = (h: number, m: number, s = 0) => new Date(2026, 9, 21, h, m, s).getTime();

describe('transcript', () => {
  it('groups finals by minute with a header', () => {
    const t = new Transcript();
    t.start(at(10, 2));
    t.add('Good morning everyone.', at(10, 2, 5));
    t.add('Today: grep.', at(10, 2, 40));
    t.add('Now chmod.', at(10, 4, 1));
    t.add('   ', at(10, 4, 2));
    expect(formatTranscript(t, 'K7PX', at(10, 55))).toBe(
      'Live Classroom Captions: transcript\nDate: 2026-10-21, 10:02 to 10:55\nRoom: K7PX\n\n' +
        '[10:02] Good morning everyone. Today: grep.\n[10:04] Now chmod.\n',
    );
  });

  it('names the file after the session start', () => {
    const t = new Transcript();
    t.start(at(9, 5));
    expect(transcriptFileName(t)).toBe('captions-2026-10-21-0905.txt');
  });

  it('starts empty for each new session', () => {
    const t = new Transcript();
    t.add('old');
    t.start();
    expect(t.empty).toBe(true);
  });
});
