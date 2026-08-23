from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.io import wavfile

ROOT = Path('/tmp/m5-wake-spike')
DATA = ROOT / 'shipping-data'
LIBRI = ROOT / 'LibriSpeech' / 'test-clean'
TARGET_SAMPLES = 32000


def normalize(source: Path, destination: Path) -> None:
    audio, rate = sf.read(source, dtype='float32')
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    if rate != 16000:
        raise RuntimeError(f'unexpected rate {rate}: {source}')
    if audio.size > TARGET_SAMPLES:
        start = (audio.size - TARGET_SAMPLES) // 2
        audio = audio[start:start + TARGET_SAMPLES]
    else:
        before = (TARGET_SAMPLES - audio.size) // 2
        audio = np.pad(audio, (before, TARGET_SAMPLES - audio.size - before))
    peak = float(np.max(np.abs(audio))) if audio.size else 0.0
    if peak > 0:
        audio = audio * min(0.95 / peak, 4.0)
    destination.parent.mkdir(parents=True, exist_ok=True)
    wavfile.write(destination, 16000, np.clip(audio * 32767, -32768, 32767).astype(np.int16))


def main() -> None:
    manifest_path = DATA / 'manifest.json'
    manifest = json.loads(manifest_path.read_text())
    rows = manifest['rows']
    speakers = sorted(
        (path for path in LIBRI.iterdir() if path.is_dir()),
        key=lambda path: (-len(list(path.glob('*/*.flac'))), int(path.name)),
    )[:20]
    for speaker in speakers:
        clips = sorted(speaker.glob('*/*.flac'))
        if len(clips) < 50:
            raise RuntimeError(f'{speaker.name} has only {len(clips)} clips')
        for take, source in enumerate(clips[:50]):
            destination = DATA / 'shipping-keyword-negative' / f'speaker-{speaker.name}-take-{take:03d}.wav'
            normalize(source, destination)
            rows.append({
                'cohort': 'shipping-keyword-negative',
                'label': 0,
                'speaker_id': f'librispeech-{speaker.name}',
                'take': take,
                'text': None,
                'source': str(source.relative_to(ROOT)),
                'path': str(destination.relative_to(DATA)),
            })
    rows.sort(key=lambda row: (row['cohort'], str(row['speaker_id']), row['take']))
    manifest['negativeCorpus'] = {
        'name': 'LibriSpeech test-clean',
        'archive': 'https://www.openslr.org/resources/12/test-clean.tar.gz',
        'license': 'CC BY 4.0',
        'speakers': [speaker.name for speaker in speakers],
    }
    manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps({
        'rows': len(rows),
        'shippingKeywordNegative': sum(row['cohort'] == 'shipping-keyword-negative' for row in rows),
        'shippingSpeakerNegative': sum(row['cohort'] == 'shipping-speaker-negative' for row in rows),
    }, indent=2))


if __name__ == '__main__':
    main()
