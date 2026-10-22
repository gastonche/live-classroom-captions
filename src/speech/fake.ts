// Scripted engine for end-to-end tests (?engine=fake). Tests drive it through window.__fakeSpeech.
import type { EngineEvents, SpeechEngine } from './engine';

export class FakeEngine implements SpeechEngine {
  readonly name = 'fake';
  readonly online = false;

  constructor(private ev: EngineEvents) {}

  start(lang: string): void {
    (window as any).__fakeSpeech = {
      lang,
      interim: (t: string) => this.ev.interim(t),
      final: (t: string) => this.ev.final(t),
      /** Simulates the OS ending the session; a real engine restarts by itself. */
      end: () => {
        this.ev.state('restarting');
        setTimeout(() => this.ev.state('listening'), 50);
      },
      fail: (p: 'blocked' | 'needs-tap') => this.ev.state('error', p),
    };
    this.ev.state('listening');
  }

  stop(): void {
    this.ev.state('idle');
  }
}
