from __future__ import annotations

import json
import shutil
from pathlib import Path

import numpy as np
from scipy.io import wavfile
import soundfile as sf

ROOT = Path('/tmp/m5-wake-spike')
DATA = ROOT / 'data'
LIBRI = ROOT / 'LibriSpeech' / 'dev-clean'
TARGET_SAMPLES = 32000


def normalize(source: Path, destination: Path) -> None:
    audio, rate = sf.read(source, dtype='float32')
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    if rate != 16000:
        raise RuntimeError(f'unexpected LibriSpeech rate {rate}: {source}')
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


def add(rows: list[dict], cohort: str, speakers: list[Path], limit: int) -> None:
    for speaker in speakers:
        clips = sorted(speaker.glob('*/*.flac'))
        if len(clips) < limit:
            raise RuntimeError(f'{speaker.name} has only {len(clips)} clips; need {limit}')
        for take, source in enumerate(clips[:limit]):
            destination = DATA / cohort / f'speaker-{speaker.name}-take-{take:03d}.wav'
            normalize(source, destination)
            rows.append({
                'cohort': cohort,
                'label': 0,
                'speaker_id': f'librispeech-{speaker.name}',
                'take': take,
                'text': None,
                'source': str(source.relative_to(ROOT)),
                'path': str(destination.relative_to(DATA)),
            })


def main() -> None:
    manifest_path = DATA / 'manifest.json'
    manifest = json.loads(manifest_path.read_text())
    rows = manifest['rows']
    speakers = sorted(
        (path for path in LIBRI.iterdir() if path.is_dir()),
        key=lambda path: (-len(list(path.glob('*/*.flac'))), int(path.name)),
    )
    if len(speakers) < 40:
        raise RuntimeError(f'expected at least 40 speakers, got {len(speakers)}')
    candidate_speakers = speakers[:20]
    train_speakers = speakers[20:30]
    validation_speakers = speakers[30:40]
    add(rows, 'train-negative', train_speakers, 50)
    add(rows, 'validation-negative', validation_speakers, 30)
    add(rows, 'candidate-negative', candidate_speakers, 50)
    rows.sort(key=lambda row: (row['cohort'], str(row['speaker_id']), row['take']))
    manifest['negativeCorpus'] = {
        'name': 'LibriSpeech dev-clean',
        'archive': 'https://www.openslr.org/resources/12/dev-clean.tar.gz',
        'license': 'CC BY 4.0',
        'speakerSplit': {
            'train': [speaker.name for speaker in train_speakers],
            'validation': [speaker.name for speaker in validation_speakers],
            'candidateTest': [speaker.name for speaker in candidate_speakers],
        },
    }
    manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps({
        'rows': len(rows),
        'trainNegative': sum(row['cohort'] == 'train-negative' for row in rows),
        'validationNegative': sum(row['cohort'] == 'validation-negative' for row in rows),
        'candidateNegative': sum(row['cohort'] == 'candidate-negative' for row in rows),
    }, indent=2))


if __name__ == '__main__':
    main()
