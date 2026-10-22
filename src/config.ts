// Signalling endpoint. Schools can self-host a PeerJS server and change it here,
// or override it per page with ?signal=https://host:port/path (used by the tests).
import type { PeerOptions } from 'peerjs';

export const SIGNAL: PeerOptions = {
  host: '0.peerjs.com',
  port: 443,
  path: '/',
  secure: true,
  key: 'peerjs',
};

// Room peer IDs are namespaced so they don't collide with other PeerJS apps.
export const PEER_PREFIX = 'lcc1-';

// Public address of the web app (where phones open /speak). The desktop overlay has no
// web origin of its own, so it needs this for the room-code card and QR code.
// Forks set VITE_WEB_URL to their own address at build time (docs/self-host.md).
export const WEB_URL: string = import.meta.env.VITE_WEB_URL || 'https://gastonche.github.io/live-classroom-captions/';

export const HEARTBEAT_MS = 5000;
export const SILENCE_MS = 10000;

export function signalOptions(search = location.search): PeerOptions {
  const raw = new URLSearchParams(search).get('signal');
  if (!raw) return SIGNAL;
  const u = new URL(raw);
  const secure = u.protocol === 'https:';
  return {
    host: u.hostname,
    port: Number(u.port) || (secure ? 443 : 80),
    path: u.pathname || '/',
    secure,
    key: 'peerjs',
    // A local test server runs on one machine, so host candidates are enough.
    config: { iceServers: [] },
  };
}
