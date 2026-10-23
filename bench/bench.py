"""Benchmarks local speech models for the v2 desktop app (docs/v2-desktop.md).

For each model and each recording: voice detection (Silero) splits speech into segments,
the model recognises each segment, the app's own word lists are applied, and the result is
scored against the reference text.

Scores: WER (word error rate), term accuracy (course terms right), invented words on
silence/noise, and real-time factor (processing time / audio length; below 1 is faster
than real time). Streaming models are fed in 100 ms chunks, as live audio would be.

Run: bench/.venv/bin/python -I bench/bench.py [--set synthetic|real] [--threads 2] [--models a,b]
"""
import argparse
import json
import re
import subprocess
import time
import unicodedata
import wave
from pathlib import Path

import numpy as np
import sherpa_onnx as so

HERE = Path(__file__).resolve().parent
MODELS = HERE / 'models'
RATE = 16000


def model_dir(prefix: str) -> Path:
    found = sorted(p for p in MODELS.glob(prefix + '*') if p.is_dir())
    if not found:
        raise FileNotFoundError(f'model {prefix}* not found in {MODELS}')
    return found[0]


def pick(d: Path, pattern: str) -> str:
    """The int8 file if there is one, else the plain one."""
    files = sorted(d.glob(pattern))
    int8 = [f for f in files if 'int8' in f.name]
    return str((int8 or files)[0])


# ---- Models -------------------------------------------------------------------------------

def offline(name: str, lang: str, threads: int):
    if name == 'parakeet-v3':
        d = model_dir('sherpa-onnx-nemo-parakeet-tdt-0.6b-v3')
        return so.OfflineRecognizer.from_transducer(
            encoder=pick(d, 'encoder*.onnx'), decoder=pick(d, 'decoder*.onnx'), joiner=pick(d, 'joiner*.onnx'),
            tokens=str(d / 'tokens.txt'), model_type='nemo_transducer', num_threads=threads)
    if name == 'canary-180m':
        d = model_dir('sherpa-onnx-nemo-canary-180m-flash')
        return so.OfflineRecognizer.from_nemo_canary(
            encoder=pick(d, 'encoder*.onnx'), decoder=pick(d, 'decoder*.onnx'), tokens=str(d / 'tokens.txt'),
            src_lang=lang, tgt_lang=lang, num_threads=threads)
    if name == 'fastconformer':
        d = model_dir('sherpa-onnx-nemo-fast-conformer-transducer-en-de-es-fr')
        return so.OfflineRecognizer.from_transducer(
            encoder=pick(d, 'encoder*.onnx'), decoder=pick(d, 'decoder*.onnx'), joiner=pick(d, 'joiner*.onnx'),
            tokens=str(d / 'tokens.txt'), model_type='nemo_transducer', num_threads=threads)
    if name == 'whisper-base':
        d = model_dir('sherpa-onnx-whisper-base')
        return so.OfflineRecognizer.from_whisper(
            encoder=pick(d, '*encoder*.onnx'), decoder=pick(d, '*decoder*.onnx'), tokens=pick(d, '*tokens.txt'),
            language=lang, task='transcribe', num_threads=threads)
    raise ValueError(name)


def streaming(lang: str, threads: int):
    d = model_dir(f'sherpa-onnx-streaming-zipformer-{lang}-kroko')
    return so.OnlineRecognizer.from_transducer(
        encoder=pick(d, 'encoder*.onnx'), decoder=pick(d, 'decoder*.onnx'), joiner=pick(d, 'joiner*.onnx'),
        tokens=str(d / 'tokens.txt'), num_threads=threads, enable_endpoint_detection=True,
        rule1_min_trailing_silence=2.4, rule2_min_trailing_silence=0.8, rule3_min_utterance_length=20)


def vad(threads: int):
    cfg = so.VadModelConfig()
    cfg.silero_vad.model = str(MODELS / 'silero_vad_v5.onnx')
    cfg.silero_vad.threshold = 0.5
    cfg.silero_vad.min_silence_duration = 0.6   # hangover: don't cut the end of a word
    cfg.silero_vad.min_speech_duration = 0.25
    cfg.silero_vad.max_speech_duration = 20
    cfg.sample_rate = RATE
    cfg.num_threads = threads
    return so.VoiceActivityDetector(cfg, buffer_size_in_seconds=120)


# ---- Running ------------------------------------------------------------------------------

def read_wav(path: Path) -> np.ndarray:
    with wave.open(str(path)) as w:
        assert w.getframerate() == RATE and w.getnchannels() == 1 and w.getsampwidth() == 2, path
        return np.frombuffer(w.readframes(w.getnframes()), dtype='<i2').astype(np.float32) / 32768


PREROLL = int(0.3 * RATE)  # keep 300 ms before each detected segment: never clip a first word


def segments(samples: np.ndarray, threads: int) -> list[np.ndarray]:
    v = vad(threads)
    window = 512
    for i in range(0, len(samples), window):
        v.accept_waveform(samples[i:i + window])
    v.flush()
    out = []
    while not v.empty():
        seg = v.front
        start = max(0, seg.start - PREROLL)
        out.append(samples[start:seg.start + len(seg.samples)])
        v.pop()
    return out


def run_offline(rec, samples: np.ndarray, threads: int) -> tuple[str, float]:
    t = time.perf_counter()
    texts = []
    for seg in segments(samples, threads):
        s = rec.create_stream()
        s.accept_waveform(RATE, seg)
        rec.decode_stream(s)
        texts.append(s.result.text.strip())
    return ' '.join(t for t in texts if t), time.perf_counter() - t


def run_streaming(rec, samples: np.ndarray) -> tuple[str, float]:
    t = time.perf_counter()
    s = rec.create_stream()
    finals = []
    chunk = RATE // 10
    for i in range(0, len(samples), chunk):
        s.accept_waveform(RATE, samples[i:i + chunk])
        while rec.is_ready(s):
            rec.decode_stream(s)
        if rec.is_endpoint(s):
            finals.append(rec.get_result(s).strip())
            rec.reset(s)
    s.accept_waveform(RATE, np.zeros(RATE, dtype=np.float32))  # flush the tail
    s.input_finished()
    while rec.is_ready(s):
        rec.decode_stream(s)
    finals.append(rec.get_result(s).strip())
    return ' '.join(f for f in finals if f), time.perf_counter() - t


# ---- Scoring ------------------------------------------------------------------------------

def norm(text: str) -> list[str]:
    t = unicodedata.normalize('NFC', text.lower())
    t = t.replace('’', "'")
    t = re.sub(r"[^\w'.+#-]+", ' ', t)          # keep node.js, c++, c#, camel-case words
    t = re.sub(r'(?<!\w)[.\-]+|[.\-]+(?!\w)', ' ', t)  # but drop sentence dots and dashes
    return t.split()


def wer(ref: list[str], hyp: list[str]) -> tuple[int, int]:
    """Word edits (substitutions + deletions + insertions) and reference length."""
    d = list(range(len(hyp) + 1))
    for i, r in enumerate(ref, 1):
        prev, d[0] = d[0], i
        for j, h in enumerate(hyp, 1):
            cur = min(d[j] + 1, d[j - 1] + 1, prev + (r != h))
            prev, d[j] = d[j], cur
    return d[len(hyp)], len(ref)


def term_hits(ref: str, hyp: str, terms: list[str]) -> tuple[int, int]:
    """Course terms in the reference, and how many of those occurrences the hypothesis has."""
    hit = total = 0
    r, h = ' '.join(norm(ref)), ' '.join(norm(hyp))
    for term in terms:
        pat = r'(?<![\w.])' + re.escape(' '.join(norm(term))) + r'(?![\w])'
        n = len(re.findall(pat, r))
        if n:
            total += n
            hit += min(n, len(re.findall(pat, h)))
    return hit, total


def fix(lang: str, texts: list[str]) -> tuple[list[str], list[str]]:
    out = subprocess.run(['node', str(HERE / 'fix.mjs')], input=json.dumps({'lang': lang, 'texts': texts}),
                         capture_output=True, text=True, check=True)
    d = json.loads(out.stdout)
    return d['texts'], d['terms']


# ---- Main ---------------------------------------------------------------------------------

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--set', default='synthetic')
    ap.add_argument('--threads', type=int, default=2)  # a modest laptop, not this Mac's 10 cores
    ap.add_argument('--models', default='kroko,parakeet-v3,canary-180m,fastconformer,whisper-base')
    args = ap.parse_args()

    data = HERE / 'data' / args.set
    items = json.loads((data / 'manifest.json').read_text())['items']
    results = []
    for name in args.models.split(','):
        for lang in ('en', 'fr'):
            mine = [it for it in items if it['lang'] == lang]
            if not mine:
                continue
            t0 = time.perf_counter()
            rec = streaming(lang, args.threads) if name == 'kroko' else offline(name, lang, args.threads)
            load = time.perf_counter() - t0
            raw, secs, audio = [], 0.0, 0.0
            for it in mine:
                samples = read_wav(data / it['file'])
                text, took = run_streaming(rec, samples) if name == 'kroko' else run_offline(rec, samples, args.threads)
                raw.append(text)
                secs += took
                audio += len(samples) / RATE
            fixed, terms = fix(lang, raw)
            edits = words = hit = tot = invented = 0
            examples = []
            for it, r, f in zip(mine, raw, fixed):
                if it['kind'] == 'silence':
                    invented += len(norm(f))
                    if f:
                        examples.append({'file': it['file'], 'invented': f})
                    continue
                e, n = wer(norm(it['ref']), norm(f))
                edits, words = edits + e, words + n
                h, t = term_hits(it['ref'], f, terms)
                hit, tot = hit + h, tot + t
                examples.append({'file': it['file'], 'raw': r, 'fixed': f})
            row = {
                'model': name, 'lang': lang, 'threads': args.threads,
                'wer': round(100 * edits / max(words, 1), 1), 'terms': f'{hit}/{tot}',
                'term_acc': round(100 * hit / max(tot, 1), 1), 'invented_words': invented,
                'rtf': round(secs / max(audio, 1e-9), 3), 'load_s': round(load, 1), 'examples': examples,
            }
            results.append(row)
            print(f"{name:<14} {lang}  WER {row['wer']:5.1f}%  terms {row['terms']:>6} ({row['term_acc']:5.1f}%)  "
                  f"invented {invented:3d}  RTF {row['rtf']:.3f}  load {row['load_s']}s", flush=True)
    out = HERE / 'results'
    out.mkdir(exist_ok=True)
    path = out / f"{args.set}-t{args.threads}-{time.strftime('%Y%m%d-%H%M%S')}.json"
    path.write_text(json.dumps(results, indent=2, ensure_ascii=False))
    print(f'\nfull results: {path}')


if __name__ == '__main__':
    main()
