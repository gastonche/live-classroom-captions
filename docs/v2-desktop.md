# v2: desktop captions with local speech recognition

Status: spec agreed in direction (2026-10-23), nothing built yet. Supersedes the phone-as-microphone
design for classroom use. Sign language is **out of scope for now**.

## Goal

One desktop app (macOS, Windows, Linux) that hears the teacher through a microphone plugged into
the computer, recognises speech **locally** with accurate models, and shows captions **on top of
everything** on the chosen display. Students can scan a QR code to follow on their phones.
The aim is to get the core product right, reliably: **no missing words, and as few wrong words as
we can measure and drive down.**

## What changes from v1

| Kept | Changed | Dropped |
|---|---|---|
| Overlay app (Tauri): on top, click-through, follows desktops, display choice | Speech recognition runs **in the app**, locally | Phone as microphone (`/speak` becomes optional, later) |
| Room hosting and the student view (`/view`) | The QR code on screen is for **students** (`/view?room=CODE`) | Dependence on Apple or Google speech services |
| Word lists (bash and programming packs), transcript, diagnostics | Controls (start, pause, end, language, microphone) move into the app | Web Speech restart logic |

## "No missing words, no wrong words", made measurable

No recogniser is perfect. These are the targets the build is tested against, on recordings of real
lessons and on the **reference low-end computer** (to be named, see Open questions).

| Requirement | Target | How it's checked |
|---|---|---|
| **No dropped audio** | 100% of captured audio reaches the recogniser. No gaps at restarts, pauses or language switches | Frame counters (captured vs processed) in diagnostics, plus a 3-hour soak test |
| **No clipped words** | Voice detection never cuts the start or end of speech | 300 ms pre-roll, 600 ms hangover. Tested on recordings with words at segment edges |
| **Word accuracy, read script** | WER ≤ 5% English, ≤ 8% French, after word lists | Benchmark set below |
| **Technical terms** | ≥ 95% of course terms (`grep`, `boolean`, `JSON`…) correct | Term-level scoring in the benchmark |
| **No invented text** | Zero words captioned during silence or noise (a known Whisper failure mode) | Silence and noise clips in the benchmark |
| **Speed** | In-progress words ≤ 1 s. A finished sentence is final ≤ 2.5 s after it ends | Timestamped benchmark on the reference machine |
| **Stability** | 3 hours live with no crash and no memory growth. Recovers by itself if the mic is unplugged and plugged back | Soak test, plus diagnostics |

## How recognition works

```
mic ─► capture (cpal) ─► 16 kHz ─► voice detection (Silero) ─┬─► fast streaming model ─► grey in-progress words
                                                             └─► accurate model, per sentence ─► final white text
                                                                          │
                                         course vocabulary as hints ──────┘──► word lists ─► overlay + students
```

- **Two speeds:** a small streaming model shows words as they're spoken. When voice detection
  marks the end of a sentence, a more accurate model re-recognises that whole sentence and replaces it.
  This matches the grey-to-white display that already works.
- **One runtime:** [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) (Apache-2.0) runs every
  candidate model on all three systems, so the model is a setting, not a rewrite.
- **Vocabulary at the source:** where the model supports it (hotwords or a prompt), course terms are
  passed as hints. Word lists stay as the safety net.
- **Audio never stops:** capture runs continuously into a ring buffer. The recognisers read from it,
  and nothing restarts in a way that loses audio. This is the main cause of missing words in v1.

## Candidate models (benchmark first, then choose)

From sherpa-onnx's model releases (sizes are the downloads):

| Role | Model | Size | Languages | Why |
|---|---|---|---|---|
| Streaming (fast, in-progress words) | streaming zipformer **kroko** en | 55 MB | EN | Small, made for live streaming |
| Streaming | streaming zipformer **kroko** fr | 55 MB | FR | French counterpart |
| Accurate (finals) | **Parakeet TDT 0.6B v3**, int8 | 465 MB | 25 European languages incl. EN, FR | Best accuracy candidate |
| Accurate, lighter | **Canary 180M flash**, int8 | 147 MB | EN, FR, DE, ES | For weaker machines |
| Accurate, lightest | NeMo fast-conformer transducer, int8 | 102 MB | EN, FR, DE, ES | Fallback for very old machines |
| Accurate, comparison | **Whisper base** (multilingual) | 198 MB | 99 languages | Prompt biasing. Can invent text on silence |
| Voice detection | Silero VAD v5 | 2 MB | any | Finds speech, skips silence |

**Benchmark set:** the teacher reads the bash and programming scripts in English and French with the
real classroom mic at teaching distance, plus 5 minutes of natural teaching per language and
silence and noise clips. Each model is scored for WER, term accuracy, invented text, real-time factor
and latency, on this Mac and on the reference low-end computer. The winners become the defaults, and
weaker machines get the lighter model automatically.

## Student phones

The overlay already hosts a room that `/view` joins. The QR code on screen becomes the student link
(`https://gastonche.github.io/live-classroom-captions/view/?room=CODE`). Needs internet for the introduction
only. A later option, if classrooms lack internet: the app serves `/view` itself on the school Wi-Fi.

## Risks

- **Linux on Wayland** restricts always-on-top and click-through windows. X11 works.
- **Mic quality matters more than model choice.** A laptop's built-in mic across a room will miss words.
  A wired or wireless clip-on mic is recommended.
- **Old CPUs without a graphics card** may only run the lighter models in real time. The benchmark
  shows how much accuracy that costs.
- **Model size:** downloaded once on first launch (100–600 MB), not bundled in the installer.

## Build order

1. Benchmark harness and model choice (needs recordings and the reference machine).
2. Audio capture, voice detection and the two-speed pipeline in the Tauri app, with frame counters.
3. In-app controls and the student QR code. Word lists and transcript move into the app.
4. Soak test, mic unplug and replug, and diagnostics.
5. Windows build, then Linux (X11).

## Open questions

1. The **weakest computer** to support: OS, processor, RAM, age.
2. **Classroom internet:** reliable enough for the student introduction?
3. **Microphone:** what's available (built-in, USB, wireless clip-on)?
