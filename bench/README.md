# Speech model benchmark

Chooses the local speech models for the v2 desktop app ([docs/v2-desktop.md](../docs/v2-desktop.md)).
It scores each model on **word error rate**, **course terms right**, **words invented on silence
and noise**, and **speed** (real-time factor), after applying the app's own word lists.

## Set up (once)

```bash
python3 -m venv bench/.venv
bench/.venv/bin/pip install sherpa-onnx numpy
npx esbuild src/wordlist.ts --bundle --format=esm --outfile=bench/.build/wordlist.mjs
```

Download the models into `bench/models/` from the
[sherpa-onnx `asr-models` release](https://github.com/k2-fsa/sherpa-onnx/releases/tag/asr-models)
and unpack them: the two `streaming-zipformer-{en,fr}-kroko-2025-08-06`, `nemo-parakeet-tdt-0.6b-v3-int8`,
`nemo-canary-180m-flash-en-es-de-fr-int8`, `nemo-fast-conformer-transducer-en-de-es-fr-14288-int8`,
`whisper-base`, and `silero_vad_v5.onnx`.

## Run

```bash
bench/.venv/bin/python -I bench/make_synthetic.py           # computer voices: checks the harness, measures speed
bench/.venv/bin/python -I bench/bench.py --set synthetic     # 2 threads by default, like a modest laptop
bench/.venv/bin/python -I bench/bench.py --set real --threads 4
```

## Real recordings (what actually decides the model)

Computer voices are far cleaner than a classroom. Record with **the microphone you'll teach with**,
at teaching distance, then put the files in `bench/data/real/`:

1. Read each script in [`texts.json`](texts.json) (`bash-en`, `prog-en`, `bash-fr`, `prog-fr`) at your
   normal teaching pace. Name the files by script id, for example `bash-en.m4a`.
2. About 5 minutes of normal teaching in each language (`free-en.m4a`, `free-fr.m4a`), plus a text file
   with what you actually said (`free-en.txt`). A rough transcript you've corrected is fine.
3. 30 seconds of the classroom with nobody speaking (`room.m4a`): fans, chairs, students.

Convert to 16 kHz mono WAV with macOS's built-in tool:

```bash
afconvert -f WAVE -d LEI16@16000 -c 1 bash-en.m4a bash-en.wav
```

Then write `bench/data/real/manifest.json` in the same shape as the synthetic one
(`{"items": [{"file", "lang", "ref", "kind": "speech" | "silence"}]}`).
