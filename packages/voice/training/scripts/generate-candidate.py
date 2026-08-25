from __future__ import annotations

import json
import math
import os
import random
import wave
from concurrent.futures import ProcessPoolExecutor
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np
from piper import PiperVoice
from piper.config import SynthesisConfig
from scipy.io import wavfile
from scipy.signal import resample_poly

MODEL = "/tmp/m5-piper/en_US-libritts-high.onnx"
CONFIG = "/tmp/m5-piper/en_US-libritts-high.onnx.json"
ROOT = Path("/tmp/m5-wake-candidate-data")
SEED = 20260823
TARGET_SAMPLES = 32000

NEGATIVE_PHRASES = [
    "open the dashboard", "tell me the latest message", "close the window", "start the timer",
    "show my recent email", "what is the weather", "play some music", "turn down the volume",
    "wake the computer", "save this document", "read the next line", "send the answer",
    "hello there", "good morning", "never mind", "shut up", "keep listening", "stop listening",
    "hey master", "hey mattress", "hey mister", "hey maestro", "a master", "the master",
    "mascara", "mass transit", "my assistant", "may I ask", "make pasta", "main task runner",
    "the machine is ready", "measure the distance", "manage this process", "message received",
    "launch the application", "refresh the templates", "record another sample", "cancel the action",
    "there is nothing to transcribe", "the microphone is unavailable", "the gate remains closed",
    "the speaker is different", "the phrase was incorrect", "the session has ended",
    "the widget is armed", "the dashboard is connected", "the model rejected it",
    "the model accepted it", "please try again", "that is enough",
]

@dataclass(frozen=True)
class Job:
    cohort: str
    label: int
    speaker_id: int
    take: int
    text: str
    length_scale: float
    noise_scale: float
    noise_w_scale: float


def build_jobs() -> list[Job]:
    jobs: list[Job] = []

    def positives(cohort: str, speakers: range, takes: int) -> None:
        for speaker_id in speakers:
            for take in range(takes):
                jobs.append(Job(
                    cohort, 1, speaker_id, take, "hey mastra",
                    0.88 + 0.06 * (take % 5),
                    0.55 + 0.06 * ((take + speaker_id) % 5),
                    0.65 + 0.07 * ((2 * take + speaker_id) % 5),
                ))

    positives("train-positive", range(100, 300), 5)       # 1,000 clips / 200 speakers
    positives("validation-positive", range(300, 320), 5)  # 100 clips / 20 speakers
    positives("candidate-positive", range(0, 20), 5)      # 100 clips / 20 speakers
    return jobs


def normalize(path: Path) -> None:
    rate, audio = wavfile.read(path)
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    if audio.dtype != np.float32:
        max_value = max(abs(np.iinfo(audio.dtype).min), np.iinfo(audio.dtype).max)
        audio = audio.astype(np.float32) / max_value
    if rate != 16000:
        divisor = math.gcd(rate, 16000)
        audio = resample_poly(audio, 16000 // divisor, rate // divisor).astype(np.float32)
    peak = float(np.max(np.abs(audio))) if audio.size else 0.0
    if peak > 0:
        audio = audio * min(0.95 / peak, 4.0)
    if audio.size > TARGET_SAMPLES:
        start = (audio.size - TARGET_SAMPLES) // 2
        audio = audio[start:start + TARGET_SAMPLES]
    else:
        before = (TARGET_SAMPLES - audio.size) // 2
        audio = np.pad(audio, (before, TARGET_SAMPLES - audio.size - before))
    wavfile.write(path, 16000, np.clip(audio * 32767, -32768, 32767).astype(np.int16))


def worker(chunk: list[Job]) -> list[dict]:
    voice = PiperVoice.load(MODEL, CONFIG)
    rows = []
    for job in chunk:
        directory = ROOT / job.cohort
        directory.mkdir(parents=True, exist_ok=True)
        path = directory / f"speaker-{job.speaker_id:03d}-take-{job.take:02d}.wav"
        with wave.open(str(path), "wb") as wav_file:
            voice.synthesize_wav(job.text, wav_file, SynthesisConfig(
                speaker_id=job.speaker_id,
                length_scale=job.length_scale,
                noise_scale=job.noise_scale,
                noise_w_scale=job.noise_w_scale,
            ))
        normalize(path)
        rows.append({**asdict(job), "path": str(path.relative_to(ROOT))})
    return rows


def main() -> None:
    ROOT.mkdir(parents=True, exist_ok=True)
    jobs = build_jobs()
    workers = min(12, os.cpu_count() or 1)
    chunks = [jobs[index::workers] for index in range(workers)]
    rows = []
    with ProcessPoolExecutor(max_workers=workers) as pool:
        for result in pool.map(worker, chunks):
            rows.extend(result)
    rows.sort(key=lambda row: (row["cohort"], row["speaker_id"], row["take"]))
    manifest = {
        "schemaVersion": 1,
        "seed": SEED,
        "ttsModel": MODEL,
        "ttsConfig": CONFIG,
        "rows": rows,
    }
    (ROOT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps({"workers": workers, "clips": len(rows), "cohorts": {name: sum(r["cohort"] == name for r in rows) for name in sorted({r["cohort"] for r in rows})}}, indent=2))


if __name__ == "__main__":
    main()
