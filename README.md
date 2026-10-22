# Live Classroom Captions

Free live captions of what you say in class, shown on the classroom screen, for deaf and
hard-of-hearing students (and everyone else). Your phone is the microphone. No accounts,
no subscriptions, nothing to pay.

*Sous-titres en direct, gratuits, de votre parole vers l'écran de la classe. Votre téléphone
sert de micro. En anglais et en français.*

> **Web address:** <https://gastonche.github.io/live-classroom-captions/>
> **Mac captions app:** [download from Releases](https://github.com/gastonche/live-classroom-captions/releases) · [install guide](docs/install-mac.md)
> **Host your own copy for free:** [docs/self-host.md](docs/self-host.md)

---

## Use it today, in 3 steps

**1. On the computer connected to the projector**, choose one:

- **Captions app (recommended):** captions float on top of everything, including your terminal,
  editor, browser or slides, so they never disappear when you switch apps.
  [Install it on a Mac](docs/install-mac.md). It shows a room code and QR code.
- **No install:** open `https://gastonche.github.io/live-classroom-captions/show/` in the browser and make it full screen.
  Captions fill the screen, but they're hidden when you switch to another app.

**2. On your phone**, scan the QR code, or open `https://gastonche.github.io/live-classroom-captions/speak/` and type the
4-letter room code. Tap **Share → Add to Home Screen** once, so next time it's one tap away.

**3. Tap "Start captions" and teach.** Leave the phone on the desk or in your pocket. It keeps
listening on its own, even after silences. Tap **Pause** for private moments and **End** when you finish.

After **End** you can **save or share the transcript** (a `.txt` file) and send it to your student.

---

## Good to know

- **Moving the captions:** tap **Top** or **Bottom** on your phone while live. In a bash class, put
  them at the **top** so they don't cover the command you're typing. On the Mac you can also use the
  **CC** menu-bar icon or **Ctrl+Option+Cmd+↑ / ↓**. **Ctrl+Option+Cmd+C** hides or shows them.
- **Students can follow on their own phone:** they open `https://gastonche.github.io/live-classroom-captions/view/` and enter
  the same code. They can scroll back through everything said in the session.
- **Technical words:** speech recognition mishears terms like `grep` ("grab") or `chmod`
  ("tomato"). The **Word list** on your phone fixes them automatically. English and French bash lists
  are built in. Add your own terms one per line, like `grip, grab => grep`.
- **If something goes wrong:** the screen says **"Captions interrupted. Teacher: check your phone."**
  so your student knows nothing is being missed. Usually one tap on your phone fixes it.
  If it keeps happening, open **Diagnostics** on your phone, tap **Copy**, and send it to whoever
  maintains the app for your school.
- **Internet:** the phone and screen need internet to find each other, and Safari's speech recognition
  needs it too. After that, the captions travel directly over your Wi-Fi.

## Add a word list for your subject

Word lists are plain files in [`wordlists/`](wordlists/). Copy `bash.en.json`, rename it
(for example `javascript.en.json`), and change the rules:

```json
{ "heard": ["java script", "jay s"], "write": "JavaScript" }
```

`heard` is what speech recognition writes; `write` is what appears on screen. You can also
import a list on your phone (Word list → Import), or send it to us as a pull request so other
teachers get it too.

## Tested devices

| Device | What | Result |
|---|---|---|
| iPhone, iOS 18.7, Safari and home-screen app | Teacher phone (speech, word list, transcript) | Works. Used in a real class. |
| Mac (Apple Silicon, macOS 26) + CASIO projector, browser | Screen (`/show`) | Works |
| Mac + LG TV over AirPlay, extended | Captions app (overlay) | Works over full-screen apps and across desktops. Keynote slide show not tested yet. |
| Chrome and Safari engines (automated tests) | Everything | Works |
| Hisense VIDAA TV HE70A6100F | Built-in TV browser | Not tested: this TV switches off on any bright picture (hardware fault) |
| Windows | Captions app | Not built yet |

Tell us how it works on your devices, and we'll add them here.

## Privacy

- **Your voice:** the default speech recognition is your phone's (Apple on iPhone, Google in Chrome),
  so audio is processed by them, just as with dictation. Nothing is recorded or stored by this app.
- **Captions** go only to the screens and student phones in your room, directly over the network
  where possible. Nothing is kept on any server.
- **The transcript** exists only on your phone until you save or share it.
- **No accounts, no analytics, no trackers.**

## For developers

Vanilla TypeScript and Vite. The phone and screen connect over WebRTC through PeerJS. The Mac app is
[Tauri](https://tauri.app). See [NOTES.md](NOTES.md) for decisions and test results,
[docs/overlay.md](docs/overlay.md) for the captions app, and [TESTING.md](TESTING.md) for the
real-device checklist.

```bash
npm install
npm run dev          # web app on http://localhost:5173
npm test             # unit tests
npm run e2e          # end-to-end tests (Chromium + WebKit)
npm run build        # production build and size budgets
npx tauri build      # the Mac captions app (needs Rust)
```

MIT licence. Third-party licences are listed in [THIRD_PARTY.md](THIRD_PARTY.md).
