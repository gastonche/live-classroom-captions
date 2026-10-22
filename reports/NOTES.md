
### TV model and browser problem (2026-10-21, 13:40)
- DIAL (SSDP `urn:dial-multiscreen-org:service:dial:1`, desc at `:56790/dd.xml`, apps at `:56789/apps/`) reports
  **modelName HE70A6100F**, manufacturer Hisense. DIAL apps: Netflix 200, YouTube 403, no Browser entry.
  **So DIAL can't open our page.**
- **The user reports the TV switches off as soon as its browser app is opened** (before any URL is typed, so it isn't our page).
  After that the TV still answers on its ports (36669/38400/56789), which looks like a crash into network standby.
  This risk isn't in the brief: the brief assumes a working TV browser.

### iPhone /check results (Safari, not home-screen yet)
- iOS 18.7, Safari UA "Version/27.2". 4 cores, 402x874 @3x.
- ES2022, modules, service worker, **Wake Lock: yes (request granted)**, WebRTC loopback OK (open 77 ms), WSS to PeerJS 642 ms / HiveMQ 1004 ms, AES-GCM OK.
- **webkitSpeechRecognition works in Safari**: 1 final + 10 interims, session ran the full 20 s. onstart came 9.6 s after the tap,
  which includes the permission prompt. A second run with silence got `aborted: No speech detected`, so restart logic will be needed.
- **Vosk on iPhone: real-time factor 0.22** (as fast as desktop), library 7.2 s and model 39 s cold through the tunnel. Same transcript as desktop
  (grab/pike/sword/tomato/pseudo). That makes Vosk viable for the offline and vocabulary modes.
- Still to do: French speech, and speech from the home-screen app.
- Note: `/check` keys are overwritten by repeated tests (the second EN run replaced the first). Keep this in mind when reading reports.
