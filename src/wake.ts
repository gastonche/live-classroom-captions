// Keeps the screen awake where the browser allows it. The lock drops whenever the page
// is hidden, so it's requested again on every return to the foreground. Where the Wake
// Lock API is missing or refused, a tiny muted looping video does the job instead
// (start it from a tap: iOS only plays media inside a user gesture).
import { log } from './diag';

type Sentinel = { release(): Promise<void>; addEventListener(t: 'release', f: () => void): void };

let lock: Sentinel | null = null;
let wanted = false;
let videoUrl: string | undefined;
let video: HTMLVideoElement | null = null;

export function keepAwake(fallbackVideo?: string): () => void {
  wanted = true;
  if (fallbackVideo) videoUrl = fallbackVideo;
  request();
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    wanted = false;
    document.removeEventListener('visibilitychange', onVisible);
    if (lock) lock.release().catch(() => {});
    lock = null;
    if (video) video.pause();
  };
}

export function isAwake(): boolean {
  return !!lock || (!!video && !video.paused);
}

function onVisible(): void {
  if (document.visibilityState === 'visible') request();
}

function request(): void {
  if (!wanted || document.visibilityState !== 'visible') return;
  if (lock) return;
  const wl = (navigator as any).wakeLock;
  if (!wl) {
    playVideo('no Wake Lock API');
    return;
  }
  wl.request('screen').then(
    (l: Sentinel) => {
      lock = l;
      log('wake', 'lock');
      if (video) video.pause();
      l.addEventListener('release', () => {
        lock = null;
      });
    },
    (e: unknown) => playVideo('lock refused: ' + String(e)),
  );
}

function playVideo(why: string): void {
  if (!videoUrl) return;
  if (!video) {
    video = document.createElement('video');
    video.src = videoUrl;
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('aria-hidden', 'true');
    video.style.cssText = 'position:fixed;left:0;bottom:0;width:1px;height:1px;opacity:0.01;pointer-events:none';
    document.body.appendChild(video);
  }
  video.play().then(
    () => log('wake', 'video (' + why + ')'),
    () => log('wake', 'none (' + why + ', video blocked)'),
  );
}

/** Retries after a user gesture, which some browsers require. */
export function retryOnGesture(): void {
  const once = () => {
    request();
    document.removeEventListener('pointerdown', once);
  };
  document.addEventListener('pointerdown', once);
}
