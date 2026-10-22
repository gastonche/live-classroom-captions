# Third-party software

Live Classroom Captions is MIT-licensed. It ships the following third-party code.

## In the web app (phones and browser screens)

| Package | Licence | Used for |
|---|---|---|
| [PeerJS](https://github.com/peers/peerjs) | MIT | Connecting phone and screen (WebRTC) |
| eventemitter3 | MIT | Used by PeerJS |
| webrtc-adapter | BSD-3-Clause | Used by PeerJS |
| sdp | MIT | Used by PeerJS |
| peerjs-js-binarypack | MIT | Used by PeerJS |
| [lean-qr](https://github.com/davidje13/lean-qr) | MIT | Room-code QR codes |

## In the Mac captions app

| Package | Licence | Used for |
|---|---|---|
| [Tauri](https://tauri.app) and `@tauri-apps/api` | Apache-2.0 OR MIT | App shell |
| tauri-plugin-global-shortcut, tauri-plugin-autostart | Apache-2.0 OR MIT | Keyboard shortcuts, open at login |
| objc2, objc2-foundation, block2 | MIT | macOS window and screen APIs |
| objc2-app-kit | Zlib OR Apache-2.0 OR MIT | macOS window and screen APIs |
| serde, serde_json | MIT OR Apache-2.0 | Data |

The Rust build pulls in about 400 crates in total. All are under permissive licences (MIT, Apache-2.0,
Zlib, Unlicense, Unicode-3.0), except five under **MPL-2.0** that Tauri uses, unmodified, for HTML and CSS handling:
`cssparser`, `cssparser-macros`, `selectors`, `dtoa-short` and `option-ext`.
MPL-2.0 is file-level copyleft. Their source is available from crates.io, and they can be used in an MIT app.
To list everything: `cd src-tauri && cargo metadata --format-version 1`.

## Services used at runtime

- **PeerJS public signalling server** (`0.peerjs.com`), only to introduce phone and screen.
  Schools can run their own; see [docs/self-host.md](docs/self-host.md).
- **Speech recognition** built into the phone's browser (Apple on iOS, Google in Chrome).

## Development only (not shipped)

Vite, TypeScript, Vitest, Playwright, happy-dom, peer (local test signalling server), and the
`/check` diagnostics page's optional Vosk test: [vosk-browser](https://github.com/ccoreilly/vosk-browser)
(Apache-2.0) and the `vosk-model-small-en-us-0.15` model (Apache-2.0). These are downloaded only on a
developer's machine and are removed from production builds.
