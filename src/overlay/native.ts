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
  labels: Record<string, string>;
};

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
