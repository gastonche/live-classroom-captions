import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { reportPlugin } from './dev/report-plugin';
import { swPlugin } from './dev/sw-plugin';

export default defineConfig({
  // Relative URLs, so a fork works under any GitHub Pages path.
  base: './',
  plugins: [reportPlugin(), swPlugin()],
  server: {
    host: true,
    // Cloudflare quick tunnels give a random *.trycloudflare.com host.
    allowedHosts: ['.trycloudflare.com'],
  },
  preview: {
    host: true,
    allowedHosts: ['.trycloudflare.com'],
  },
  build: {
    // Old TV browsers: lower syntax to ES2015 (see NOTES.md, Phase 0 decisions).
    target: 'es2015',
    rollupOptions: {
      output: {
        // PeerJS gets its own chunk so the size check can budget it separately.
        manualChunks: (id) =>
          /node_modules\/(peerjs|peerjs-js-binarypack|webrtc-adapter|sdp|eventemitter3)\//.test(id) ? 'peerjs' : undefined,
      },
      input: {
        main: resolve(__dirname, 'index.html'),
        show: resolve(__dirname, 'show/index.html'),
        speak: resolve(__dirname, 'speak/index.html'),
        view: resolve(__dirname, 'view/index.html'),
        check: resolve(__dirname, 'check/index.html'),
        overlay: resolve(__dirname, 'overlay/index.html'),
        lan: resolve(__dirname, 'lan/index.html'),
      },
    },
  },
});
