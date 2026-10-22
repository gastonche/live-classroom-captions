// Every speech engine (Web Speech, Vosk, the test fake) emits the same three events.
export type EngineState = 'idle' | 'listening' | 'restarting' | 'error';

/** Why an engine is in the error state; the UI turns each into one plain fix. */
export type EngineProblem = 'unsupported' | 'blocked' | 'needs-tap' | 'no-mic' | 'network';

export interface EngineEvents {
  interim(text: string): void;
  final(text: string): void;
  state(s: EngineState, problem?: EngineProblem): void;
}

export interface SpeechEngine {
  readonly name: string;
  /** Online engines send audio to Apple or Google; offline ones keep it on the phone. */
  readonly online: boolean;
  /** Call from a tap the first time: iOS only grants the microphone inside a user gesture. */
  start(lang: string): void;
  stop(): void;
}

export function bcp47(lang: 'en' | 'fr'): string {
  return lang === 'fr' ? 'fr-FR' : 'en-US';
}
