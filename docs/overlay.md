# Caption overlay app: spec

Status: agreed design, not built. Decided with the course lead on 2026-10-21.

## Why

A full-screen browser page can't stay visible while the teacher demos something else.
When they switch to the terminal, editor, browser or design tool, the captions disappear,
and that's exactly when the student needs them. The fix is a small desktop app on the computer driving
the projector. It draws captions **on top of everything**, and clicks pass straight through.

This replaces the v1 non-goal "a native app for any platform". Everything else in the brief stands.

## What stays the same

- The microphone is **any device running the web app** (`/speak`): the teacher's phone, or the
  projector computer itself in a browser. The overlay doesn't capture audio.
- Word lists, the student view (`/view`), the transcript, the protocol and the transport are unchanged.
  The overlay is one more screen that joins the room, and it **hosts the room** in place of `/show`.
- The browser screen page (`/show`) remains for TVs and for anyone who doesn't install anything.

## Platforms and build

- **macOS first, then Windows**, from one codebase: **Tauri** (a webview shell, about 5–10 MB).
  The webview reuses the existing caption renderer and room code. Small native parts handle on-top and click-through.
- Distributed through **GitHub Releases**, unsigned to start (it's open source).
  macOS: a one-time "Open Anyway" in System Settings → Privacy & Security. Documented with screenshots.
  Windows: SmartScreen "More info → Run anyway". Free OSS signing (e.g. SignPath) can come later.
- Auto-update from GitHub Releases, never during a live session.

## Behaviour

**Display choice**
- Extended screens (the usual case): captions on the projector only. It's remembered by display name
  (e.g. `CASIO-PJ`) and picked again automatically next time.
- Mirrored: the single screen.
- A projector plugged in mid-session takes over automatically. It can be changed from the menu.

**Window**
- Always on top, including over full-screen apps and spaces on macOS.
- Click-through and never takes focus. Not in the Dock or taskbar: it lives in the menu bar or tray.
- Visible in screen shares and recordings.

**Caption box**
- Default: **bottom centre**, **2 lines**, about **70% of the screen width**, text about 4.5% of screen height,
  with a dark rounded backdrop behind the text only (not a full-width bar). It stays inside a safe margin so overscan can't crop it.
- **One position, changed when needed.** Not remembered per course.
  - Top or bottom from the phone (`cfg.position`).
  - A keyboard shortcut on the computer.
  - Dragging, with a modifier held, since it's otherwise click-through.
- **Move out of the way: OFF by default**, toggle in the menu and on the phone. When on, if the
  pointer stays over the caption box for about 1 s, it slides to the opposite edge.
- Size, number of lines and language come from the phone, as today.

**States** (small, never full-screen takeovers)

| State | On the projector |
|---|---|
| No session | Nothing. Menu-bar icon only |
| Waiting to pair | Small corner card: room code and QR |
| Live | Caption box |
| Paused | "Captions paused" chip |
| Mic down for more than 5 s | "Captions interrupted. Teacher: check your phone." chip |
| Teacher disconnected | "Waiting for teacher…" chip |

**Menu (menu bar / tray):** status dot and room code, the display to show on, top/bottom,
size, move-out-of-the-way toggle, hide captions (with a global shortcut), and launch at login.

## Protocol additions

- `cfg.position: "top" | "bottom"` and `cfg.dodge: boolean`, sent by the phone. `/show` ignores both.

## Risks, tested first by a throwaway prototype

Prototype status (2026-10-21): risk 2 **passed** on an extended AirPlay screen (full-screen Chrome, Edge, iTerm2, VS Code).
Risk 1 (Keynote play mode) and mirroring are **not yet tested**. See NOTES.md.


1. **Presentation modes:** Keynote and PowerPoint play mode on macOS can capture the display and
   hide other windows. Highest risk; it decides whether this design works for slide-based courses.
2. macOS full-screen spaces (full-screen Terminal or VS Code) need the window to join all spaces as a full-screen auxiliary.
3. Windows: topmost plus transparent plus click-through over normal apps and PowerPoint slideshows
   (exclusive-full-screen games and video are out of scope).
4. If the projector computer is the mic, a laptop's built-in mic across a room is weak. Recommend a clip-on mic.

## Prototype exit criteria

On the classroom Mac, with the projector extended and then mirrored: the caption box stays visible and click-through over
Terminal (windowed and full screen), VS Code full screen, a browser, Figma, Keynote play mode and PowerPoint slideshow.
Each combination is recorded as pass or fail in `NOTES.md` before the real build starts.
