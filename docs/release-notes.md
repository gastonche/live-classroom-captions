**Captions** shows live captions of what the teacher says on top of everything on the classroom screen:
terminal, editor, browser or slides. Speech is recognised **on the computer**, from a microphone
plugged into it. Students can follow on their phones by scanning the QR code.

**New in 0.2.1:** the CC menu no longer flickers while the models download; on Linux, student phones can connect
(WebRTC is switched on) and the status no longer says "offline" when only the student connection is unavailable.

> **Pre-release for testing.** macOS has been tested with a real microphone. Windows and Linux are new and **not yet tested on real machines**. Please report what works.

## Download

| Computer | File |
|---|---|
| Mac with Apple Silicon (M1 or later) | `Captions-…-macOS-arm64.zip` |
| Windows 10 or 11 (64-bit) | `Captions-…-Windows-x64-setup.exe` |
| Linux, most distributions (64-bit) | `Captions-…-Linux-x64.AppImage` |
| Ubuntu / Debian (64-bit) | `Captions-…-Linux-x64.deb` |

## Install

The app is free and open source, and isn't registered with Apple or Microsoft, so each system asks you to confirm it once.

- **Mac:** unzip, move **Captions** to Applications and open it. If macOS blocks it, go to **System Settings → Privacy & Security → Open Anyway**.
- **Windows:** run the setup file. If Windows SmartScreen appears, choose **More info → Run anyway**.
- **Linux (AppImage):** make it executable (`chmod +x Captions-*.AppImage`), then run it.
  **Linux (.deb):** `sudo apt install ./Captions-*.deb`, then open **Captions** from your apps.
  Works best on an **X11** session. On Wayland, staying on top of other windows may be limited.

## First run

The app needs its speech models (**467 MB, one time**). Choose **Download speech models** in the **CC** menu
(Mac: menu bar at the top; Windows: system tray near the clock; Linux: system tray). The download resumes if
the connection drops, and every file is checked before use.

## Use

1. **CC menu → Microphone:** pick the microphone you teach with (a clip-on or USB mic works best).
2. **Start captions.** Allow microphone access when asked. Talk normally: grey words while you speak, white when settled.
3. **Show student QR code:** students scan it to follow on their phones.
4. **End and save transcript:** saved in **Documents/Captions**.

Keyboard shortcuts: **Mac** Ctrl+Option+Cmd, **Windows and Linux** Ctrl+Alt+Shift, with:
**S** start · **P** pause/resume · **C** hide/show · **↑ / ↓** captions top/bottom.

## Privacy

Audio never leaves the computer. Captions go only to the student phones in your room. No accounts, no tracking.

Speech recognition: NVIDIA Parakeet TDT 0.6B v3 (CC-BY-4.0) through sherpa-onnx (Apache-2.0); voice detection: Silero VAD (MIT).
