from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path

import numpy as np
import onnxruntime as ort
from scipy.io import wavfile
from sklearn.neural_network import MLPClassifier
from skl2onnx import convert_sklearn
from skl2onnx.common.data_types import FloatTensorType

ROOT = Path('/tmp/m5-wake-candidate-data')
FEATURE_MODEL = Path('/tmp/google-speech-embedding/speech_embedding.onnx')
OUTPUT_MODEL = Path('/tmp/m5-hey-mastra-keyword.onnx')
RESULT = Path('/tmp/m5-candidate-result.json')
SEED = 20260823
BATCH = 32


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def load_rows() -> list[dict]:
    return json.loads((ROOT / 'manifest.json').read_text())['rows']


def extract(rows: list[dict]) -> np.ndarray:
    session = ort.InferenceSession(str(FEATURE_MODEL), providers=['CPUExecutionProvider'])
    output = []
    for start in range(0, len(rows), BATCH):
        batch_rows = rows[start:start+BATCH]
        audio = []
        for row in batch_rows:
            rate, samples = wavfile.read(ROOT / row['path'])
            assert rate == 16000 and samples.shape == (32000,)
            audio.append(samples.astype(np.float32) / 32768.0)
        embeddings = session.run(['embeddings'], {'audio_samples': np.stack(audio)})[0]
        output.append(embeddings.reshape(len(batch_rows), -1))
    return np.concatenate(output).astype(np.float32)


def cohort(rows: list[dict], features: np.ndarray, prefix: str):
    indices = [index for index, row in enumerate(rows) if row['cohort'].startswith(prefix)]
    return features[indices], np.asarray([rows[index]['label'] for index in indices], dtype=np.int64), [rows[index] for index in indices]


def metrics(scores: np.ndarray, labels: np.ndarray, threshold: float) -> dict:
    accepts = scores >= threshold
    positives = labels == 1
    negatives = labels == 0
    return {
        'positiveCount': int(positives.sum()),
        'negativeCount': int(negatives.sum()),
        'trueAccepts': int((accepts & positives).sum()),
        'falseAccepts': int((accepts & negatives).sum()),
        'recall': float((accepts & positives).sum() / positives.sum()),
        'maxNegativeScore': float(scores[negatives].max()),
        'minPositiveScore': float(scores[positives].min()),
    }


def strictest_eighty_percent_threshold(scores: np.ndarray, labels: np.ndarray) -> float:
    positive_scores = np.sort(scores[labels == 1])[::-1]
    required = int(np.ceil(0.80 * len(positive_scores)))
    return float(positive_scores[required - 1])


def main() -> None:
    rows = load_rows()
    started = time.monotonic()
    features = extract(rows)
    extraction_seconds = time.monotonic() - started

    x_train, y_train, _ = cohort(rows, features, 'train-')
    x_val, y_val, _ = cohort(rows, features, 'validation-')
    x_test, y_test, test_rows = cohort(rows, features, 'candidate-')

    classifier = MLPClassifier(
        hidden_layer_sizes=(32,),
        activation='relu',
        solver='adam',
        alpha=0.0001,
        batch_size=128,
        learning_rate_init=0.001,
        max_iter=300,
        shuffle=True,
        random_state=SEED,
        early_stopping=False,
        verbose=False,
    )
    classifier.fit(x_train, y_train)

    val_scores = classifier.predict_proba(x_val)[:, 1]
    threshold = strictest_eighty_percent_threshold(val_scores, y_val)
    validation = metrics(val_scores, y_val, threshold)

    candidate_scores = classifier.predict_proba(x_test)[:, 1]
    candidate = metrics(candidate_scores, y_test, threshold)
    candidate['passes'] = candidate['recall'] >= 0.80 and candidate['falseAccepts'] == 0

    onnx_model = convert_sklearn(
        classifier,
        initial_types=[('embeddings', FloatTensorType([None, 16 * 96]))],
        target_opset=17,
        options={id(classifier): {'zipmap': False}},
    )
    OUTPUT_MODEL.write_bytes(onnx_model.SerializeToString())

    onnx_session = ort.InferenceSession(str(OUTPUT_MODEL), providers=['CPUExecutionProvider'])
    outputs = onnx_session.run(None, {'embeddings': x_test})
    onnx_scores = outputs[1][:, 1]
    max_export_error = float(np.max(np.abs(candidate_scores - onnx_scores)))
    if max_export_error > 1e-5:
        raise RuntimeError(f'ONNX export mismatch: {max_export_error}')

    result = {
        'schemaVersion': 1,
        'seed': SEED,
        'architecture': 'openWakeWord-style flattened 16x96 speech embeddings -> dense 32 ReLU -> sigmoid',
        'featureModel': {'path': str(FEATURE_MODEL), 'sha256': sha256(FEATURE_MODEL)},
        'keywordModel': {'path': str(OUTPUT_MODEL), 'sha256': sha256(OUTPUT_MODEL), 'bytes': OUTPUT_MODEL.stat().st_size},
        'training': {
            'positiveCount': int((y_train == 1).sum()),
            'negativeCount': int((y_train == 0).sum()),
            'speakers': len({row['speaker_id'] for row in rows if row['cohort'].startswith('train-')}),
            'iterations': int(classifier.n_iter_),
            'loss': float(classifier.loss_),
        },
        'validation': {**validation, 'threshold': threshold},
        'candidateTest': candidate,
        'candidateCohorts': {
            'positiveSpeakers': sorted({row['speaker_id'] for row in test_rows if row['label'] == 1}),
            'negativeSpeakers': sorted({row['speaker_id'] for row in test_rows if row['label'] == 0}),
        },
        'onnxExportMaxAbsoluteError': max_export_error,
        'featureExtractionSeconds': extraction_seconds,
    }
    RESULT.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))
    if not candidate['passes']:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
