# NOTES

Running log of decisions, measurements and anything that contradicts the brief.

## 2026-10-21 — Phase 0 (recon)

### Dev machine and network
- Dev machine: macOS on the classroom Wi-Fi (a private /24 subnet).
- Tools present: node 25, npm 11, git, cloudflared, mkcert, python3, dns-sd.
  **nmap and arp-scan are not installed.** Installing them would be system-wide, so the
  sweep used `ping` over the /24 plus the ARP table, and Python TCP connects for ports.
- The subnet is a busy shared network.

### TV discovery
- On the first sweep the TV was off: no Hisense OUI and no port 36669 anywhere.
- After the TV was turned on:
  - Found on the LAN. MAC vendor (OUI `80:CB:BC`) = *Qingdao Intelligent & Precise
    Electronics Co., Ltd.*, a Hisense group company.
  - SSDP (multicast; unicast M-SEARCH gets no reply): `Location: http://<tv>:38400/MediaServer/rendererdevicedesc.xml`,
    `SERVER: Platform 1.0 His/1.0 UPnP/1.0 DLNADOC/1.50`.
  - Device description: `friendlyName` "Hisense VIDAA TV", `deviceType` MediaRenderer:1,
    `manufacturer` "SmartTV", `modelName` "Renderer". **The DLNA XML does not expose the real model number.**
  - Open ports: **36669** (TLS 1.2, cert `CN=127.0.0.1, OU=multiscreen`, issuer `CN=RemoteCA, O=hh, L=qingdao`,
    which is the VIDAA MQTT remote service), 38400 (DLNA HTTP), 56789 (HTTP, 404 on `/`).
  - mDNS: the TV advertises nothing that is visible from here.
- **The remote protocol is not used yet.** As the brief asks, this was reported to the user before trying it.
  Because the broker presents a self-signed "RemoteCA" chain, this is the newer VIDAA variant that
  usually needs a client certificate and a PIN shown on the TV.

### Repo
- Vite 6.4.5, TypeScript 5.9.3, Vitest 3.2.7, Playwright 1.64.1 (all dev-only, nothing at runtime).
- MIT licence.

### /check diagnostics page
- `public/check.js` is **hand-written ES5 with no build step** (validated with `esbuild --target=es5`).
  The page must run on whatever engine the TV has, so it can't depend on the build target it is meant to discover.
  Syntax support is detected with `new Function(...)` for each ES level.
- It checks UA, screen, secure context, standalone mode, ES level (ES5 to ES2022), modules, storage, service worker,
  Wake Lock, WebSocket, RTCPeerConnection plus a **live in-page data-channel loopback with 20 RTTs**,
  an AES-GCM round trip, WebAssembly, AudioWorklet, getUserMedia, SpeechRecognition, and WSS reachability of the
  free public PeerJS server and HiveMQ broker.
- Manual buttons (they need a user gesture): speech EN/FR (records time to first result, interim/final counts and when the session ends),
  wake lock, and Vosk (library and model load time, real-time factor on an 8.6 s `say`-generated clip with bash terms).
- Results POST to `/report` (a dev-only Vite middleware in `dev/report-plugin.ts`) and land in `reports/*.json`.
- `/check/manifest.webmanifest` lets `/check` itself be added to the home screen, so Web Speech can be
  tested inside a standalone PWA on iOS.

### Sizes found so far
- `vosk-browser@0.0.8`: `vosk.js` is 5.8 MB raw / **2.37 MB gzipped** (the WASM is inlined), plus the small EN model at 41 MB (tar.gz).
  It is acceptable only as an opt-in lazy load. The package was last published in Dec 2022, which counts against promoting it.

### Desktop smoke test (the built-in Chromium browser; this checks the page logic only, not the target devices)
- All 49 automatic checks ran and the report was saved. Data-channel loopback opened in 13 ms with a median RTT of 0.10 ms.
  PeerJS public WSS opened in ~1.2 s and HiveMQ WSS in ~1.3 s, so both free endpoints are reachable from this network.

### Open: decisions waiting on device results
- Default engine, transport and `/show` JS build target: **not decided**. They need the TV and iPhone `/check` reports.

### Vosk on desktop (M-series Mac, Chromium; this checks the logic, not iPhone performance)
- Library load: 549 ms (cached) / 7.0 s (cold, through the tunnel). Model load: **46 s cold through the tunnel** (41 MB).
- Real-time factor **0.20** on an 8.6 s clip.
- Transcript of the bash script with no vocabulary list:
  "the day we will learn the **grab** command use **grab** to search of file then **pike** the output into **sword**
  if you get permission denied use **tomato** or **pseudo**".
  Every bash term was wrong, so the word list and Vosk's grammar/vocabulary mode are both clearly needed. This is the baseline for Phase 4.
- Fix found during testing: Vosk fetches the model from a blob-URL worker, so the model URL must be absolute.

### VIDAA remote protocol (researched 2026-10-21, user approved trying it)
- Source: pyvidaa / hisense2mqtt (github.com/warrenrees/myhisense-tv), which reverse-engineered the official VIDAA app.
  - MQTT credentials are derived from the time and a client id (details in pyvidaa's `credentials.py`).
  - Pairing: publish `…/ui_service/{client}/actions/vidaa_app_connect`, the TV shows a 4-digit PIN, then publish
    `…/actions/authenticationcode` `{"authNum":"XXXX"}`. The PIN times out after about 60 s.
  - Launch: `…/ui_service/{client}/actions/launchapp` `{"name":…,"urlType":37,"storeType":0,"url":…}`.
    **No documented payload opens the browser at an arbitrary URL.** Web apps (Disney+, Tubi) are launched with their HTML URL,
    which is promising but unverified.
- **This TV requires mutual TLS.** A handshake with no client certificate gets TLS alert 40 (handshake_failure).
  The client certificate and key exist only inside Hisense's VIDAA Android app (`res/3R.p12`, `CN=VidaaAppAndroidV01`).
  pyvidaa doesn't ship them for legal reasons. Getting them means downloading either the APK from a mirror or
  `hi_keys.zip` (2.6 KB) from github.com/d3nd3/Hisense-mqtt-keyfiles (2021, no licence, possibly an older cert).
  **I stopped here and asked the user** rather than download third-party copies of Hisense's private key.
- User confirms: opening the TV browser turns the TV **fully off** (it needs the power button to come back). This is a firmware or browser-app fault,
  not something the app can fix. Suggested fixes: a 60 s unplug, a firmware update, clearing the browser cache. Fallback: an HDMI device (old Android phone, laptop, or streaming stick).
- Factory reset didn't help: the browser still powers the TV off. **HDMI from the user's Mac also powers the TV off, but another computer works.**
  Working hypothesis: a hardware or power fault (PSU or LED backlight driver tripping on bright, full-white or high-bandwidth content), not software.
  The browser opens on a white page, and the Mac likely sends 4K/HDR at high brightness. Tests sent to the user: lower backlight / energy saving, then the browser;
  a full-white video in an app; the Mac forced to 1080p SDR with a dark wallpaper.
- Native TV app considered and rejected for v1: VIDAA apps are HTML5 apps running in the same web engine. Publishing one needs Hisense's partner store review.
  It would only help Hisense TVs, and it wouldn't avoid a hardware or engine fault.
- User clarifies: the 14:24–14:25 network drops were with the Mac connected by HDMI, **but the browser, YouTube and picture-test shutdowns all happened with no HDMI connected**.
  That rules out current leaking through the HDMI cable as the main cause. Conclusion: a hardware fault inside the TV (backlight or power board) that trips under full-screen picture load.
  Menus still work. **TV needs repair. It can't be used for real-device testing until then.** Device testing moves to another screen with a browser, or a computer over HDMI.

### DLNA control (no certificate needed), 2026-10-21 14:30
- The TV's DLNA renderer (`:38400`, control URLs `/upnp/control/mingusavtr|mingusrcr|minguscmr`) accepts standard UPnP SOAP with no auth.
  Readable: transport state (`NO_MEDIA_PRESENT`), volume (10). It has no power or sleep actions.
- The TV powered off while idle during a full port scan (user confirmed it was the idle timer, not a fault).
- To keep it awake with minimal backlight load: made 1080p solid-colour H.264 test videos (black 1 h, grey 64/128/255 60 s) with a Swift AVAssetWriter tool
  (Homebrew ffmpeg is broken: missing libx265, not fixed because that's system-wide). Served on the Mac's LAN address, port 8765.
- `SetAVTransportURI` + `Play` returned 200 and the TV reports PLAYING, **but it never requested the file** (Mac firewall is off).
  This needs a look at the TV screen, probably a cast-permission prompt.

### Brightness step test over DLNA (2026-10-21 14:41, a single cast of `steps.mp4`)
- Black 60 s: OK. Grey 64 (25%) 60 s: OK. **Grey 128 (50%): TV fully off about 11 s in** (last good sample 14:43:18 at 00:02:11, down from 14:43:21).
  The user saw a near-white screen for a few seconds, then it went off. White (255) was never reached.
- **Confirms a hardware fault that trips on backlight or picture load** (LED strip or power board). There is a clear threshold between 25% and 50% average brightness.
- Implication for this TV until it is repaired: a white-on-black caption screen has a very low average brightness and may survive. The TV browser's bright
  start page probably trips it. Next test: lower the Backlight setting to minimum and repeat.
- Tooling (scratchpad, not in repo): `solidvideo` (Swift AVAssetWriter, grey:seconds segments), `rangeserve.py` (HTTP Range server, which DLNA needs),
  `dlna.py` (AVTransport play/stop/state), `steplog.py` (1 Hz status and position log). The TV asks permission for every new cast.
- **Rerun with Backlight at minimum and dynamic backlight / energy features off** (14:49): black 60 s OK, grey-64 60 s OK,
  **grey-128 held for about 54 s** (before: 11 s). Last good sample 14:52:30 at 00:02:54. Down by 14:52:41, i.e. at the end of grey-128 or within the first seconds of white.
  So minimum backlight raises the threshold a lot, but full white still trips it. A dark caption screen should be OK at minimum backlight.
  A bright browser start page is still a risk.

## 2026-10-21 15:00 — Pivot: the TV is broken, use the projector
- User decision: the TV can't be used for this student until it's repaired. **The display is now a CASIO projector driven by this Mac over HDMI** (it shows as `CASIO-PJ`).
  Current mode is 1280x720@60. The modes advertised include 1280x800, 1920x1200, 1600x1200 and 1920x1080, so it's a 16:10 panel.
  The user sees **edges cut off**: the classic overscan you get when a projector receives a TV-format signal (720p).
  Suggested fix: a 16:10 mode (1280x800, then try 1920x1200) through "Show all resolutions", or the Underscan slider if macOS shows one.
- **New product requirement:** `/show` needs a safe-area margin (default about 5% each side), adjustable from the phone,
  because projectors and older TVs overscan. Captions must never sit at the very edge.
- For Phase 1 the "TV" is a browser on this Mac fullscreened on the projector, which I can verify directly.
  A standalone TV browser is still the target for other teachers.

## Phase 0 decisions (2026-10-21)
| Decision | Choice | Evidence |
|---|---|---|
| Default speech engine | **Web Speech (`webkitSpeechRecognition`)** | It works in iOS 18.7 Safari (finals and interims, full 20 s session). **Not yet verified from a home-screen PWA.** If that fails, the plan is to open in Safari. |
| Offline / vocabulary engine | Vosk, opt-in (Phase 4) | iPhone RTF 0.22. The lib is 2.37 MB gz plus a 41 MB model, so it's lazy-loaded only. |
| Whisper / Moonshine | Not in v1 | Vosk already meets real-time, and there's no need to fetch extra hundreds of MB. |
| Transport | **WebRTC data channel through PeerJS, public 0.peerjs.com signalling** | Loopback works on iPhone, Mac Safari and Chromium. PeerJS WSS reachable in 0.6–1.2 s. Endpoint configurable in one constant. |
| MQTT fallback | Not built unless a display lacks WebRTC | Every display tested has WebRTC. |
| `/show` JS target | **ES2015** (syntax-lowered by esbuild). `check.js` stays ES5 | The VIDAA browser couldn't be measured (hardware fault). ES2015 covers TV browsers from about 2017. The current display is Mac Safari 26. |
| Display for now | Mac on the CASIO projector over HDMI, full-screen browser | The TV is broken; user decision. |

Hub design: the display (`/show`) owns the room peer `lcc1-<CODE>`. The teacher phone and student viewers both connect to it, and the display relays captions to its viewers.
That keeps the display as the single, always-on point and the phone as a client that can reconnect.

## Phase 1 results (2026-10-21)
- Libraries: `peerjs@1.5.5` (MIT, **23.9 KB gz**, own chunk), `lean-qr@2.7.4/nano` (MIT, **2.1 KB gz**, /show only). Dev: `peer@1.0.2` (local signalling for tests), `happy-dom`.
- Unit tests (Vitest): 18 pass. They cover room codes, protocol shape checks, SeqFilter dedupe/stale/sid reset, Backoff/Retrier, and append-only CaptionView.
- End-to-end (Playwright, Chromium + WebKit, each device its own context, local PeerJS server): **16/16 pass**. Covered:
  pairing by code, start→live under 2 s, typed interim and final, pause/resume, "Waiting for teacher…" plus recovery with a remembered token,
  display reload and automatic phone rejoin (same code kept), a second phone refused while the teacher is connected, two student viewers with backlog, and phone settings applied on the display.
- Latency harness (100 finals at about 50/s, same machine): Chromium median 0.6–1.2 ms / p95 0.8–1.8 ms. WebKit median 1–5 ms / p95 4–29 ms.
  **Target (median under 300 ms) passes by a wide margin, but this is loopback, not Wi-Fi.** Real phone→Mac latency is still to be measured.
- Size budgets (gz, CI-checked by `scripts/size-check.mjs` inside `npm run build`): /show 6.9/15 KB, /speak 5.6/40 KB, /view 4.9/40 KB, CSS 2.0/5 KB, PeerJS 23.9 KB.
- Bugs found by the tests:
  1. Test contexts that were never closed kept reconnecting and slowed WebKit to about 40 s per test. Fixed in the tests.
  2. **Real bug:** a WebRTC dial can stall with neither open nor close, which would leave a phone on "connecting" forever. Added a 6 s dial timeout and retry.
- "Waiting for teacher…" timing: WebKit sees the data channel close at once (about 1–3 s). Chromium doesn't fire close on page close, so it relies on the 10 s silence timer, as the brief specifies.
- Known v1 limit: teacher trust is "remembered token, or an empty seat". If the teacher's phone is gone for more than 10 s, another phone holding the code could take the seat.
- **Real devices (user-confirmed 2026-10-21):** typed captions from the user's iPhone appear on the CASIO projector (Mac browser, full screen) through the tunnel and the public PeerJS server.
  Phase 1's real-device criterion passes.

## Phase 2 (2026-10-21): live speech
- `SpeechEngine` interface (`src/speech/engine.ts`): `interim`, `final`, `state(idle|listening|restarting|error, problem)`.
  Problems map to one plain-language fix each: blocked, needs-tap, unsupported, no-mic, network.
- **Web Speech engine** (`src/speech/webspeech.ts`):
  - continuous with interims, silent restart on every `onend` (30 ms; backs off to 3 s cap when sessions die instantly), pending interim flushed as final when a session ends.
  - **Stall-to-final after 1.4 s** of unchanged interim. iOS Safari can go a long time without `isFinal`, which otherwise would leave everything grey.
  - Tracks emitted characters per session, so late `isFinal`s don't duplicate text.
  - `not-allowed` before any successful start = blocked; after one = iOS refusing a background restart, which needs a tap.
  - Restarts are skipped while the page is hidden and resume on `visibilitychange`.
- **Pause stops the mic** (privacy), not just the screen. Resume restarts it inside the tap.
- **Word list** (`src/wordlist.ts`, `wordlists/bash.{en,fr}.json`): whole-word, case-insensitive, longest-first, phrases match across spaces or hyphens,
  optional exact-case rules, accented letters are word characters. Editor: one rule per line `heard, heard => write`, saved per language on the phone, with JSON import/export and reset.
  A unit test proves the EN pack turns the exact Phase 0 Vosk transcript (grab/pike/sword/tomato/pseudo) into grep/pipe/sort/chmod/sudo.
  Removed "paille" and "grappe" from the FR pack (ordinary words). "grab", "sword", "pike" and "pseudo" in the EN pack are deliberate trade-offs for a bash class, and a teacher can delete them.
- Tests: **40 unit** (incl. a mock `webkitSpeechRecognition`: restart, backoff, stall, blocked vs needs-tap, flush on stop) and **32 e2e** (16 per browser; incl. 7 speech tests with `?engine=fake`). All pass.
- Sizes: /show 7.8 KB, /speak 9.9 KB, /view 5.8 KB, CSS 2.1 KB (gz), all in budget.
- **Not verified yet: real speech on the iPhone.** TESTING.md steps 2–4 are waiting on the user.

### Real class result and the "stuck mic" fix (2026-10-21)
- **User report: worked really well from the iPhone during a real class, but got stuck once.** The user confirmed it was the microphone:
  the phone said "listening" but no words came. Root cause, by inference (no log existed yet): iOS Safari can keep a recognition session
  alive without delivering results or ending it, and our restart logic only reacted to `onend`.
- Fix in `webspeech.ts`:
  - **Watchdog:** no result for 20 s means the session is aborted and restarted.
  - If `abort()` gives no `onend` within 1.5 s, the session is treated as hung: handlers are detached so it can't feed late text, and a fresh one starts.
  - Sessions over 4 min are recycled at a pause (no pending interim, more than 1.5 s since the last result).
  - In real silence this costs a restart every 20 s, which is harmless.
- **Diagnostics log** (`src/diag.ts`): a 400-event ring buffer in localStorage covering mic/session/error/restart/watchdog, screen-link status, signalling errors, network online/offline,
  page visibility and app actions. **It never records caption text** (an e2e test asserts the spoken words aren't in it). Copy or Share it from the phone's Diagnostics section.
- Tests: 46 unit (4 new watchdog tests: silent, hung, busy, long-session) and 33 e2e pass. Diagnostics copy is Chromium-only in Playwright.
- **Still to confirm on the iPhone:** that the watchdog clears a real stall. If it sticks again, the copied diagnostics will show what happened.

## Phase 3 (2026-10-21): PWA and resilience
- **Manifests:** `manifest.webmanifest` (teacher app, `start_url ./speak/`, standalone, `#0b0b0c`, 192/512 plus a maskable 512 "CC" icon drawn with CoreGraphics)
  and `view.webmanifest` (student view). Apple meta tags and touch icon on /speak and /view.
- **Service worker** (`src/sw/sw-template.js`, generated by `dev/sw-plugin.ts`): cache-first app shell, **cache name = content hash of the build**,
  old caches deleted on activate, cross-origin (signalling) untouched, navigations match with `ignoreSearch` so `/speak/?room=X` works offline.
  Registered in production builds only. The plugin also strips the dev-only Vosk model and bundle from `dist` (dist is about 260 KB).
- **Wake lock:** Wake Lock API first. If it's missing or refused, a 914-byte muted looping inline video (`keepawake.mp4`) is started from the Start tap.
  The method used is logged in diagnostics.
- **End of session:** the mic stops, the screen returns to the code view, and the phone shows "Session ended" with **Save as .txt** and **Share** (file share where supported, else text).
  Transcript is in memory only, as the brief says. **Risk:** if iOS kills the backgrounded app before saving, the transcript is lost.
- **Faster Wi-Fi recovery:** on `online` or `visibilitychange`, the phone pings the screen (which now echoes pings). With no reply in 2.5 s it redials,
  rather than waiting for the 10 s silence timeout. The screen reconnects signalling as soon as it's back online.
- **One-time install tip** in iPhone/iPad Safari outside the home-screen app.
- Tests: **49 unit, 38 e2e** (dev, both engines; 2 Chromium-only skips in WebKit) and **4 prod-build e2e**: manifest valid, all pages open **offline** after one visit,
  repeat-load `domInteractive` about 3 ms (target under 500 ms, desktop Chromium), one versioned cache.
- Sizes (gz): /show 9.1, /speak 12.8, /view 7.3 KB, CSS 2.2 KB, PeerJS 23.9 KB. All in budget.
- **CI:** `.github/workflows/ci.yml` runs unit, build plus size budgets, and both e2e suites. It isn't run yet: there's no GitHub remote until Phase 5.
- The tunnel now serves **`vite preview` of the production build** on :5173 (same URL), so the iPhone gets the service worker. `/report` no longer exists there.
- Observed: a screen whose remembered code is held by another live session takes about 20 s (5 retries) before choosing a new code. That's acceptable. Normal reloads keep the code.

### Real-device results so far
- 2026-10-21: Phase 2 steps 2–4. **Worked really well from the iPhone in a real class**, but stuck once (mic said listening, no words) → watchdog fix.
  User is watching for a repeat and will send diagnostics.

### Offline test: mic never came back (user report, 2026-10-21)
- **User: "after going offline, the mic disconnected and never continued."** (TESTING step 5, Wi-Fi off for 10 s.) Diagnostics have been asked for to confirm which path it was.
  Likely causes: Web Speech needs the network, so while offline sessions fail and back off; then either iOS refused the timer-driven restart
  (needs-tap, which is easy to miss on the phone) or a session hung until the 20 s watchdog fired.
- Fixes:
  1. `online` event: the engine resets its backoff and starts a fresh session at once, replacing any hanging one.
  2. **Any tap on the phone** resumes a mic that needs a tap, not only the yellow box. The box is now bright yellow and large.
  3. **The mic's state is shown on the screen:** if the mic isn't listening for more than 5 s while live and not paused, the phone sends `{t:"mic",ok:false}`,
     and the projector and student views show "Captions interrupted. Teacher: check your phone." It clears when listening resumes.
     That way the deaf student never waits on silence without knowing, which the brief requires.
- Tests: 51 unit (+2: network return during backoff, replaces a hanging session), 42 e2e (+2: interrupted notice and tap-anywhere resume, student sees the notice), 4 prod. All pass.
- **Self-updating app:** when a new service worker takes control, the page reloads into the new version, **but only when not live** (it retries every 5 s).
  It also checks for updates each time the app comes back to the foreground. The first install doesn't trigger a reload.
  Prod e2e: a copy of dist on a local server gets a new sw.js written on disk, and the idle page reloads into the new cache.
  The "not while live" deferral has no e2e (it needs a live phone in the prod harness); it's a 3-line check in `src/sw/register.ts`.
  Note: Playwright's route() can't intercept a service worker's own script update fetch, hence the on-disk swap.

## 2026-10-21 — Scope change: caption overlay app (spec only, nothing built)
- User: a full-screen browser display is fine for a demo, but not for real classes. **Captions must stay visible while the teacher demos other apps.**
  This reverses the brief's v1 non-goal "a native app for any platform". Spec: `docs/overlay.md`.
- Decisions (user): mostly Macs, some Windows. Screens mostly extended, sometimes mirrored. Content varies by course (bash, JS, HTML, design).
  Installing an app is fine and it can stay unsigned (open source). **Any device running the web app can be the mic.**
  Caption position is **one position, changed when needed** (not per course). **"Move out of the way" is off by default**, toggleable.
- Technical choice (mine): **Tauri**, macOS first, reusing the existing renderer and room code. The overlay hosts the room, and `/show` stays for TVs.
- Next: a throwaway prototype aimed at the highest risk (Keynote/PowerPoint play mode hiding overlays on macOS) before the real build.

## Overlay prototype results (2026-10-21, `prototype/overlay/main.swift`, throwaway)
- Native AppKit `NSPanel`: borderless, non-activating, `ignoresMouseEvents`, clear background, level `.screenSaver`,
  `collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]`, `orderFrontRegardless` on every tick and on every space change.
  Accessory activation policy (no Dock icon). Menu-bar "CC" item switches level, position and screen live. Logs front app and occlusion once a second.
- Test screen: an **LG webOS TV over AirPlay, extended** (the CASIO projector wasn't connected). The prototype picked it automatically as the non-main screen.
- **Pass (user: "works great"; log 18:36:28–18:37:00):** full-screen Chrome, Edge, iTerm2 and VS Code spaces. The overlay stayed on top.
  `occlusionState` went non-visible only for single 1 s samples during the space-switch animation, then recovered. That's expected and fine.
- **Not yet tested (user unavailable):** Keynote play mode (highest risk), mirrored displays, and click-through confirmed by eye.
  PowerPoint isn't installed on this Mac.
- Learned: this process can't take screenshots (no Screen Recording permission), so visual checks rely on the user.
- Position in the prototype: CC menu → Position top/bottom only.

## macOS overlay app, first build (2026-10-21)
- **Tauri 2** (stable; Tauri 3 is alpha), `src-tauri/`. **Captions.app is 4.6 MB.** The window loads `overlay/index.html` from `dist`.
- Native (`src-tauri/src/lib.rs`): the transparent, undecorated window gets the prototype's NSWindow settings (level 1000, CanJoinAllSpaces|FullScreenAuxiliary|Stationary|IgnoresCycle,
  ignoresMouseEvents, no shadow, orderFrontRegardless), reasserted every 2 s. Accessory activation policy (no Dock icon). Menu-bar tray (template "CC" icon) whose menu is rebuilt
  from the page's EN/FR labels: status, show room code, position Top/Bottom, show on (Projector automatic or a named screen), move out of the pointer's way, hide captions,
  open at login (tauri-plugin-autostart, LaunchAgent), quit. Global shortcuts (tauri-plugin-global-shortcut): ⌃⌥⌘C hide, ⌃⌥⌘↑/↓ top/bottom.
- Commands: `monitors`, `place` (by name, else first screen not at the main screen's origin, else main), `cursor` (pointer in window CSS px for move-out-of-the-way), `reassert`, `autostart`, `set_menu`, `log`.
- Screen names: Tauri names macOS screens "Monitor #<n>", where **n is the CGDisplayModelNumber** (not the display id). Real names come from matching NSScreen ids by `CGDisplayModelNumber` → "Built-in Retina Display".
- Web side: `src/host.ts` RoomHost (extracted from /show; all /show e2e still pass), `src/overlay/{main,logic,native}.ts`, `overlay/index.html`. Overlay page excluded from the web service worker.
  Phone: Top/Bottom buttons while live, move-out-of-the-way switch; on join it resends only lang/position/dodge (each screen keeps its own size); it follows position changes made on the computer.
- Bugs found while building:
  1. Two temporal-dead-zone crashes: `render()` ran (from `host.start()`) before later `let`s were initialised. Fixed by starting everything in a `boot()` at the end of the module.
  2. First screen check never placed the window (empty initial list compared equal). It now always places first.
  3. Auto-projector choice used names. It now uses position.
- Smoke test in the real app (logs to stderr): page loads, room registers with the public PeerJS server from WKWebView, placement logged.
  A teacher phone paired and went live (most likely the user, from the on-screen card). **Visual checks, click-through and full-screen/Keynote are with the user.**
- Tests: 59 unit, 56 e2e (dev) incl. 14 overlay-page tests, 5 prod. All pass. No automated test of the native window yet.
- Not done yet: Windows build, signing, auto-update, drag-to-move (spec: drag with a modifier). VITE_WEB_URL is the tunnel for now.

### Overlay app fixes after the first classroom check (2026-10-21/22)
- User: "QR works, captions work great. Can't change the position. Can't get it to appear on a different desktop when I swipe."
- **Position:** root cause was the **quick tunnel dying** (Cloudflare dropped `closer-spirits-…`; quick-tunnel hostnames can't be recovered).
  The phone kept running a cached old build (offline shell) without the Top/Bottom buttons. New tunnel: `experts-anyone-ministry-kathy.trycloudflare.com`.
  After re-adding the app: phone Top/Bottom confirmed in the log (pos=top, then bottom).
  **Lesson: a quick tunnel isn't a classroom URL. Stable hosting (GitHub Pages) is needed before real use.**
- **Desktops:** the log showed `on-this-desktop=false` after a swipe, despite `collectionBehavior=0x151` (CanJoinAllSpaces|Stationary|IgnoresCycle|FullScreenAuxiliary)
  and re-ordering. A regular Tauri (TaoWindow) NSWindow wasn't carried across desktops. **Fix: swap the window's class at runtime to a non-activating NSPanel subclass**
  (`CaptionsOverlayPanel`, canBecomeKey/Main = NO, NonactivatingPanel style, floating, not hidden on deactivate), the technique tauri-nspanel uses and the prototype's window type.
  After the fix: **59 desktop switches, `on-this-desktop` stayed true throughout.**
- **Card out of view:** a mixed-scale placement bug. A Tauri monitor's physical position is in that monitor's *own* scale; placing it with the window's current (2x) scale put the window
  half on the laptop screen. Fix: convert with the target monitor's scale to logical points.
- **Card timed out** after 60 s at launch. Now it stays until the first phone pairs, and is available from the menu later.
- Still unconfirmed: menu-bar actions and global shortcuts (no "[native] action" lines yet, so not tried), the Keynote slide show, mirroring, and click-through by eye.

## 2026-10-22 — Published (user-approved)
- Public repo: **https://github.com/gastonche/live-classroom-captions**. Site (GitHub Pages via Actions): **https://gastonche.github.io/live-classroom-captions/**.
- Before publishing, local network details (LAN IPs, the TV's MAC address and device ID, the LAN device inventory) were generalised in NOTES.md, and the VIDAA login formula
  was replaced by a pointer to pyvidaa. The repo was published as **one fresh commit**: the earlier local history (which contains those details) stays on the
  local, unpushed branch `local-history`.
- Live-site smoke test (built-in browser): `/show` registered a room via the public PeerJS server, `/speak?engine=fake` paired and went live, and "grip" rendered as "grep". All pages return 200.
- `WEB_URL` now defaults to the Pages address; forks override it with `VITE_WEB_URL`. The Mac app was rebuilt for it: `Captions-macOS-arm64.zip` (2.1 MB, Apple Silicon only, unsigned). **Not released yet.**
- The quick tunnel and preview server are stopped. Phones must re-add the app from the permanent address (the old home-screen icon points at a dead origin).

### CI on GitHub (2026-10-22)
- Chromium e2e (Linux), unit tests, build and size budgets, and prod-build e2e: **pass**.
- **WebKit e2e fails on GitHub runners, on both Linux and macOS:** the test phone never connects (chip stays "wait"). The same tests pass on a real Mac, and real iPhone Safari works.
  Locally both engines gather only **mDNS-obfuscated host candidates** (`*.local`) with no STUN. The working theory is that WebKit can't resolve them inside CI VMs.
  `test/e2e/ice-diagnostic.spec.ts` printed the candidates on CI: **Chromium 1 (mDNS), WebKit 0**. So the mDNS theory was wrong too.
  Playwright's WebKit on the runner gathers **no ICE candidates at all** (no usable interface in that sandbox), and STUN/TURN can't help without one.
  The WebKit CI job stays **non-blocking** (CI conclusion: success). **Run `npx playwright test --project=webkit` on a Mac before releases** (it passes there, 28/28 non-skipped).
- First diagnosis ("Linux WebKit lacks WebRTC") was wrong: macOS runners fail the same way.

## 2026-10-22 — Programming word packs and tap-to-fix (branch `claude/changes`, PR, not deployed)
Real problem: Safari writes "bully" when the teacher says "boolean". Web Speech takes no custom vocabulary, so the fixes stay post-correction.

### Packs
- New `wordlists/programming.en.json` (116 rules, 213 heard phrases) and `programming.fr.json` (55 rules, 131 phrases): JavaScript/TypeScript, React hooks, DOM APIs, HTML/CSS, Python, git/GitHub,
  npm/Node, JSON, SQL, regex, case styles, loops. Both packs (bash + programming) are on by default: `src/speak/words.ts` merges them per language
  (`defaultRules`); the editor shows and saves the merged list; Reset restores it.
- **Existing saved lists:** a saved list now records `packs: ["bash", "programming"]`. A list saved before this change has no `packs`, so on first load the
  programming pack is merged into it **once**, keeping the teacher's own rules first (a phrase he already maps keeps his spelling). Deleting a pack rule
  afterwards sticks. Import marks all packs as present, so an imported list is used as is.
- **Curation rules (precision over recall):** only phrases that aren't ordinary classroom speech. Never plain "get" (git), "in" (int), "car" (char), "no" (null),
  "Jason", "sequel", "a wait", "rejects", "red X", "to pull", "the dome". Instead: "Jason file / object / data / format", "in Jason", "sequel query / database /
  injection", "get commit / push / pull / clone...", "two pull" (with "two pull requests" mapped to itself so git talk survives), "four loop", "wild loop".
  `await` has no rule: Safari writes "await", and "a wait" is ordinary English. "the dome" was dropped after it broke a test sentence.
- **Known trade-off, asked for:** `bully, bullion, bully and, boo lean => boolean`. "Please don't bully" becomes "don't boolean". A unit test pins this so it's a
  visible choice; removing the line in the Word list undoes it.
- **Not changed, worth a look (bash pack, older):** some bash rules map ordinary words: EN "grab", "grape", "sword", "pike", "tomato", "pseudo", "vin";
  FR "pseudo" (= nickname/username in French). The no-false-positive sentences avoid them; they're a separate decision.

### Tap-to-fix (`src/speak/tapfix.ts`)
- Tap anywhere on a word in the `/speak` preview. `caretPositionFromPoint` / `caretRangeFromPoint` finds the word (no per-word spans, so `CaptionView` and the
  preview's layout are untouched). A small form opens **below** the preview (in the flow, so it sits above the iOS keyboard) with the tapped word and its
  neighbours as 48 px buttons: tap a neighbour to stretch the selection ("bully" → "bully and"), tap inside to start again. Type the spelling, Save
  (or Enter). `addRule` moves the phrase out of any older rule and joins a rule that already writes the same thing; the live fixer is rebuilt at once.
- Confirmation ("Saved: bully → boolean") replaces the one-line hint under the preview for 3 s, in green, then the hint comes back. The line never wraps (ellipsis), so nothing moves. (First version was a toast over the preview; on the live site it hid the 2-line preview for 4 s, so it moved here.) Cancel (or Escape) closes it; captions keep
  flowing while it's open. The tap that resumes a stopped mic ("needs-tap") does only that: it doesn't open the editor.
- The heard phrase is stored lowercase (rules are case-insensitive). The preview shows *fixed* text, so tapping a word another rule produced (e.g. "grep"
  from "grab") adds a rule for "grep", which won't re-fix "grab": edit that rule in the Word list instead.
- Sizes: `/speak` JS 13.9 → 17.7 KB gz (budget 40), CSS 3.0 → 3.2 KB (budget 5).

### Test results (2026-10-22, this Mac)
- `npm test`: **197 passed** (adds `programming.test.ts`: 48 EN + 19 FR key mappings, 36 EN + 22 FR ordinary sentences that must stay unchanged; `words.test.ts`: merge, migration, tap-to-fix rules, word picking).
- `npm run build`: budgets ok (/speak 17.7 KB / 40 KB).
- `npm run e2e`: Chromium **34 passed**; WebKit **32 passed, 2 skipped** (clipboard and network-change tests are Chromium-only, as before). New `tapfix.spec.ts`: bully → boolean end to end (rule in editor, survives reload), two-word selection, Cancel while captions flow, French strings.
- `npm run e2e:prod`: **5 passed**.
- Not tested yet: a real iPhone (tap accuracy on 18 px text, keyboard staying up while tapping word buttons).

## 2026-10-23 — Direction change: v2 desktop with local recognition
- User: the phone-as-mic form factor was wrong for real classes. Wanted: one desktop app (Mac, Windows, Linux) with a mic plugged into the computer, local and accurate models
  on non-high-end machines, the on-top overlay on any display, and a student QR code for phones. **Sign language is out for now.** Priority: work correctly and reliably,
  without missing or wrong words.
- Spec: `docs/v2-desktop.md`, with measurable targets (no dropped audio, no clipped words, WER ≤ 5% EN / ≤ 8% FR, ≥ 95% term accuracy, zero invented text, latency, 3-hour soak).
- Candidate models (sherpa-onnx releases, sizes checked from release metadata): kroko streaming EN/FR (55 MB each), Parakeet TDT 0.6B v3 int8 (465 MB), Canary 180M flash int8 (147 MB),
  NeMo fast-conformer transducer int8 (102 MB), Whisper base (198 MB), Silero VAD v5 (2 MB). Nothing downloaded yet.

### First benchmark: synthetic voices, 2 threads, this Mac (2026-10-23)
Set: 4 scripts × 2 macOS voices per language (EN: Samantha, Eddy; FR: Jacques, Flo), plus silence and noise. **Computer voices: good for speed and harness checks, not for choosing a model.**
References are written as the caption should read (`log.txt`, not "log dot txt").

| Model (greedy) | EN WER | EN terms | FR WER | FR terms | Invented (silence/noise) | RTF @2 threads |
|---|---|---|---|---|---|---|
| kroko streaming (EN/FR) | 11.0% | 70% | 28.2% | 14% | 0 | 0.013 |
| **Parakeet TDT 0.6B v3** | 12.3% | 68% | **21.4%** | **25%** | 0 | 0.028 |
| Canary 180M flash | 23.7% | 60% | 44.7% | 7% | 0 | 0.051 |
| NeMo fast-conformer | 22.3% | 40% | 36.1% | 0% | 0 | 0.012 |
| Whisper base | **9.0%** | 68% | 34.2% | 7% | 0 | 0.052 |

- **Speed is a non-issue:** every model runs at under 0.07× real time on 2 threads. A machine 10× slower than this Mac still keeps up.
- **No model invented text** on 20 s of silence or noise (greedy decoding).
- **The hard problem is English commands inside French speech:** "grep" became "grip", "sudo" became "ce do", "chmod" became "mots", "mkdir" became "MD".
  Added the safe French rule `grip → grep`. "mots" can't be a rule (it's an ordinary word).
- **Hotwords** (course terms given in advance, `modified_beam_search`): at score 2.0 **no change**, identical to beam search without hotwords.
  At 12.0 they apply but **break output** (Parakeet EN 100% WER, kroko invents words on noise). The cause is likely that terms were split greedily from `tokens.txt` rather than with each model's real
  sentencepiece model (not shipped in these downloads). Proper hotwords need the real tokenizer and score tuning. **Not a quick win.**
- Beam search alone: small gain for Parakeet EN (12.3% → 10.7%).
- **Licences:** Parakeet and Canary are CC-BY-4.0, Whisper and Silero MIT, **kroko community models CC-BY-SA** (attribution, share-alike on model changes; the model card metadata is unclear).
  Prefer CC-BY or MIT models when quality is equal.
- **Tentative direction:** Parakeet v3 for final text (best French, good English, fast, CC-BY). Because it's so fast, it may also produce the in-progress words by re-decoding the growing
  segment every ~0.5 s. That would mean one model and no CC-BY-SA dependency. To test.
- Fixed in passing: the programming pack's `bully and → boolean` deleted a real "and". Removed, with a regression test.
- **Decision waits on real recordings** with the classroom mic (bench/README.md).

## v2 desktop pipeline, first build (2026-10-23)
- **Engine** `src-tauri/src/asr.rs` uses the official `sherpa-onnx` crate 1.13.8 (Apache-2.0; prebuilt static libs downloaded from sherpa-onnx's GitHub releases at build time) and `cpal` 0.18 for capture.
  - Capture thread: default or chosen mic, downmix, sherpa's LinearResampler to 16 kHz. **Never restarted during a lesson.** If the device fails or is unplugged it retries every 2 s.
  - Worker thread: 60 s history ring with absolute sample positions; every sample goes through Silero VAD (0.5 threshold, 0.6 s hangover, 15 s max segment).
    While speech is detected, the growing sentence is re-decoded every ≥0.7 s for grey text. The interval adapts to 2.5× the last decode time on slow machines.
    When VAD closes a segment, exactly that audio plus 300 ms pre-roll is decoded once for the final. Stopping flushes the sentence in progress.
  - Stats every 2 s: captured vs processed samples, backlog, segments, RTF, mic level, device.
  - **Parakeet v3 detects English or French itself**, so the app's language setting only picks word lists and UI strings.
  - Test sources: `CAPTIONS_TEST_WAV` (real-time pace), `filefast:` in tests. `CAPTIONS_AUTOSTART` starts a lesson after launch.
- **Desktop mode in the page:** `RoomHost.setLocal(true)` makes the computer the teacher (phones are refused as teachers and can only watch via `/view`).
  The menu bar has Start (⌃⌥⌘S), Pause/Resume (⌃⌥⌘P), End and save transcript (Documents/Captions), Microphone submenu, Language (EN/FR), student QR (`/view?room=CODE`), position, display, move out of the way, hide, login, quit.
  A mic down for over 5 s while live shows "Captions interrupted: microphone problem." on screen and to students (the wording is now neutral, no phone).
- `NSMicrophoneUsageDescription` in `src-tauri/Info.plist`.
- Tests: Rust unit (history ring, downmix) plus an **ignored end-to-end engine test** on a recording (all key terms right).
  Web: 198 unit, **68 e2e** (incl. 8 new desktop-mode overlay tests with injected engine events). All pass.
- **In the real app** with a recording as the mic: start → listening → 2 finals (45 + 37 words of the 85-word script) → idle. Text quality was checked in the Rust test.
- App bundle **21.9 MB** (speech engine statically linked). Models are separate.
- **Not done yet:** (1) **first-run model download**: models are found via `CAPTIONS_MODELS`, the app data folder, or (dev only) `bench/models`, so on another computer they're missing.
  (2) Real-mic test with the teacher's voice. (3) 3-hour soak test, plus mic unplug and replug on real hardware. (4) Windows and Linux builds.

## First-run model download and Windows build (2026-10-23)
- `src-tauri/src/models.rs`: on the teacher's say-so (menu **Download speech models (467 MB, one time)**; nothing downloads by itself, since networks cost money):
  `silero_vad_v5.onnx` (2.3 MB) and the Parakeet v3 int8 archive (465 MB) from the sherpa-onnx GitHub release, into the app data folder.
  - **Checksums pinned:** the archive's SHA-256 is GitHub's published digest. The VAD file has no published digest, so it's pinned from our verified copy.
    The 4 extracted files (encoder, decoder, joiner, tokens) are pinned too, and match both the benchmarked copies and Hugging Face's published LFS hashes.
  - **Only those 4 files** are taken from the archive (no archive paths are used: tested against `../` escapes), then the archive is deleted.
  - **Chunked range downloads (8 MB per request, 3 min each)** with resume, and retries counted as *consecutive stalls without progress* (8 max, backoff ≤ 30 s).
    **Bug found by the real test:** the first version gave each attempt a 60 s limit on the whole transfer, so a 465 MB download could never finish (338 s, then fail).
  - **Real test** (`cargo test --release -- --ignored real_install`): interrupted after 4 s, resumed at byte 2,441,543, verified, unpacked, archive removed. **705 s on this Mac's link (~0.7 MB/s).**
  - Overlay: a setup panel (bottom-left) with a progress bar; Start disabled until ready; errors say how to resume. E2E covers missing → progress → error → done → captions.
- **Windows:** shortcuts are Ctrl+Alt+Shift+… (Win-key combos are reserved by Windows); colour tray icon; NSIS installer (`tauri.windows.conf.json`, per-user, EN/FR).
  Built on GitHub Actions (`.github/workflows/desktop.yml`: macOS arm64 `.app` and Windows x64 installer, both with Rust unit tests). **Untested on a real Windows PC.**
- Tests: Rust 5 unit (+3 ignored: engine on a recording, pinned checksums, real install), web 198 unit, **70 e2e**. All pass.
