"""Builds a synthetic benchmark set with macOS voices, plus silence and noise clips.

Synthetic speech is far cleaner than a classroom: use it to check the harness and to
measure speed, not to choose a model. Real recordings go in bench/data/real/ (see README).

Run: bench/.venv/bin/python -I bench/make_synthetic.py
"""
import json
import subprocess
import wave
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
OUT = HERE / 'data' / 'synthetic'
RATE = 16000


def write_wav(path: Path, samples: np.ndarray) -> None:
    pcm = (np.clip(samples, -1, 1) * 32767).astype('<i2')
    with wave.open(str(path), 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(pcm.tobytes())


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    texts = json.loads((HERE / 'texts.json').read_text())
    manifest = []
    for item in texts['items']:
        for voice in texts['voices'][item['lang']]:
            slug = voice.split(' ')[0].lower()
            aiff = OUT / f"{item['id']}-{slug}.aiff"
            wav = OUT / f"{item['id']}-{slug}.wav"
            subprocess.run(['say', '-v', voice, '-o', str(aiff), item['text']], check=True)
            subprocess.run(['afconvert', '-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', str(aiff), str(wav)], check=True)
            aiff.unlink()
            manifest.append({'file': wav.name, 'lang': item['lang'], 'ref': item['text'], 'kind': 'speech'})

    rng = np.random.default_rng(7)
    # 20 s of near-silence (a quiet room) and 20 s of noise (fans, chairs, chatter-like),
    # where any captioned word is invented text.
    write_wav(OUT / 'silence.wav', rng.normal(0, 0.002, RATE * 20))
    white = rng.normal(0, 1, RATE * 20)
    brown = np.cumsum(white)
    brown = brown - np.convolve(brown, np.ones(4000) / 4000, mode='same')
    noise = 0.05 * brown / np.max(np.abs(brown)) + 0.01 * white
    write_wav(OUT / 'noise.wav', noise)
    for f in ('silence.wav', 'noise.wav'):
        for lang in ('en', 'fr'):
            manifest.append({'file': f, 'lang': lang, 'ref': '', 'kind': 'silence'})

    (OUT / 'manifest.json').write_text(json.dumps({'items': manifest}, indent=2, ensure_ascii=False))
    print(f'wrote {len(manifest)} items to {OUT}')


if __name__ == '__main__':
    main()
