// Bridge to the desktop shell (Tauri). In a plain browser (tests) every call is a no-op,
// so the overlay page can be tested like any other page.
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export const inApp = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

// Report page errors to the terminal: there are no devtools in release builds.
if (inApp) {
  window.addEventListener('error', (e) => log(`error ${e.message} at ${e.filename}:${e.lineno}`));
  window.addEventListener('unhandledrejection', (e) => log(`rejection ${String(e.reason)}`));
}

export type MenuState = {
  status: string;
  code: string;
  position: 'top' | 'bottom';
  dodge: boolean;
  hidden: boolean;
  autostart: boolean;
  monitor: string;
  monitors: string[];
  live: boolean;
  paused: boolean;
  lang: 'en' | 'fr';
  mic: string;
  mics: string[];
  models: 'ready' | 'missing' | 'installing';
  labels: Record<string, string>;
};

export type ModelsProgress = {
  stage: 'download' | 'verify' | 'unpack' | 'done' | 'error' | 'cancelled';
  done: number;
  total: number;
  detail: string;
};

/** Whether the speech models are installed. In a browser, tests choose with ?models=missing. */
export async function modelsStatus(): Promise<{ ready: boolean; installing: boolean; totalBytes: number }> {
  if (inApp) return invoke('models_status');
  return { ready: new URLSearchParams(location.search).get('models') !== 'missing', installing: false, totalBytes: 489_483_156 };
}

export async function modelsInstall(): Promise<void> {
  if (inApp) await invoke('models_install');
}

export async function modelsCancel(): Promise<void> {
  if (inApp) await invoke('models_cancel');
}

/** Download progress. Tests inject the same events through window.__models. */
export function onModels(fn: (p: ModelsProgress) => void): void {
  if (inApp) listen<ModelsProgress>('models', (e) => fn(e.payload));
  (window as any).__models = fn;
}

export type AsrEvent =
  | { kind: 'interim'; text: string }
  | { kind: 'final'; text: string }
  | { kind: 'state'; state: 'listening' | 'error' | 'idle'; detail: string }
  | { kind: 'stats'; captured: number; processed: number; backlog: number; segments: number; rtf: number; level: number; device: string };

/** Starts the computer's microphone and speech recognition (empty mic = system default). */
export async function asrStart(mic: string): Promise<void> {
  if (inApp) await invoke('asr_start', { mic });
}

export async function asrStop(): Promise<void> {
  if (inApp) await invoke('asr_stop');
}

export async function asrDevices(): Promise<string[]> {
  return inApp ? invoke<string[]>('asr_devices') : [];
}

/** Writes the transcript to Documents/Captions; returns the path. */
export async function saveTranscript(name: string, text: string): Promise<string> {
  return inApp ? invoke<string>('save_transcript', { name, text }) : '';
}

/** The address students open on the school Wi-Fi, e.g. http://192.168.1.20:47213/ (null if none). */
export async function lanInfo(): Promise<{ url: string | null; clients: number }> {
  if (inApp) return invoke('lan_info');
  // In a browser (tests), the student page is served next to this one.
  return { url: new URLSearchParams(location.search).get('lan') || null, clients: 0 };
}

// In a browser (tests), what would go to phones is kept on window.__lanOut.
const lanOut: { sent: string[]; snapshot: string } = ((window as any).__lanOut = { sent: [], snapshot: '' });

export function lanSend(msg: string): void {
  if (inApp) invoke('lan_send', { msg }).catch(() => {});
  else lanOut.sent.push(msg);
}

export function lanSnapshot(msg: string): void {
  if (inApp) invoke('lan_snapshot', { msg }).catch(() => {});
  else lanOut.snapshot = msg;
}

/** Recognition events from the app. Tests inject the same events through window.__asr. */
export function onAsr(fn: (e: AsrEvent) => void): void {
  if (inApp) listen<AsrEvent>('asr', (e) => fn(e.payload));
  (window as any).__asr = fn;
}

/** Cover the chosen monitor (by name; empty means "the projector", i.e. not the built-in one). Returns its name. */
export async function place(monitor: string): Promise<string> {
  return inApp ? invoke<string>('place', { monitor }) : '';
}

export async function monitors(): Promise<string[]> {
  return inApp ? invoke<string[]>('monitors') : [];
}

/** Pointer position relative to the overlay window, in CSS pixels; null if unknown or outside. */
export async function cursor(): Promise<{ x: number; y: number } | null> {
  return inApp ? invoke<{ x: number; y: number } | null>('cursor') : null;
}

export async function setMenu(m: MenuState): Promise<void> {
  if (inApp) await invoke('set_menu', { state: m });
}

/** Keeps the window above everything; some apps reorder windows when they activate. */
export async function reassert(): Promise<void> {
  if (inApp) await invoke('reassert');
}

export function log(line: string): void {
  if (inApp) invoke('log', { line }).catch(() => {});
}

export async function autostart(on: boolean): Promise<boolean> {
  return inApp ? invoke<boolean>('autostart', { on }) : false;
}

/** Menu-bar and global-shortcut actions arrive as ids: "pos-top", "toggle-hide", "monitor:NAME", ... */
export function onAction(fn: (id: string) => void): void {
  if (inApp) listen<string>('action', (e) => fn(e.payload));
  // Tests drive the same actions through window.__overlayAction.
  (window as any).__overlayAction = fn;
}
