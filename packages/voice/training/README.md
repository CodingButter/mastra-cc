# Wake model training evidence

This directory preserves the Phase 1 `hey mastra` candidate recipe and frozen manifests. Python is training/proof tooling only; shipped code remains Node-only.

## Pinned inputs

- openWakeWord architecture reference: commit `368c03716d1e92591906a84949bc477f3a834455` (Apache-2.0 code; all distributed pretrained payloads forbidden because upstream licenses them CC BY-NC-SA 4.0).
- Google Research source: commit `e20eb00d074cdb569ee27318f112ea1e85bbb98f`.
- Google Research Apache-2.0 `LICENSE` digest: `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30`.
- Official Google `speech_embedding` SavedModel archive: 1,336,273 bytes, SHA-256 `0f626c42009c1eb916401b7b2800229a211e43100115bc591b9afbf1b60da27f`.
- Piper `en_US-libritts-high` voice: 904 speakers, LibriTTS CC BY 4.0; ONNX SHA-256 `9127a559e11603f10b366d1a20ac7426826081dbc521de4c2420c57728d73f0f`, config SHA-256 `2efdc6d7f954588b8180132cbd9b8001933fdd00932c92bc92fd0d2028a9eb3d`, model-card SHA-256 `c478d826aae8a6332f69509271a56083b9ece014a993e16fc79cb94968106a5f`.
- LibriSpeech `dev-clean`: CC BY 4.0, archive SHA-256 `76f87d09…`; exact rows and speaker splits are frozen in `manifests/candidate-bank.json`.
- LibriSpeech `test-clean`: CC BY 4.0, archive SHA-256 `39fde525…`; exact rows and speaker splits are frozen in `manifests/shipping-calibration-bank.json`.

The downloaded Google SavedModel archive did not contain an embedded licence file. Jamie accepted the pinned official Google Research Apache-2.0 source evidence for this named payload; the final proof must retain that limitation.

## Toolchain

The recorded conversion used Python 3.12.3, TensorFlow CPU 2.18.1, tf2onnx 1.16.1 (`15c810`), ONNX 1.17.0, NumPy 1.26.4, and opset 17. The classifier used onnxruntime 1.22.0, scikit-learn 1.7.2, and skl2onnx 1.19.1. Runtime validation used `onnxruntime-node@1.27.0` on Linux/Node 25.2.1.

`convert-speech-embedding.sh` preserves the export command. Raw protobuf output is not byte-stable: the reviewed export is `e6d1aaf9f052a340ee1a006103f4de4897ad9894c880b74afc90571e6596a18e`; a repeated export was `e14daa2c6a7f8958e15e462e73c44b0edd5257bd663024c16e7843ad8558b95c`. `verify-equivalent-backbone.py` proves semantic determinism by checking ONNX validity, public I/O, opsets, recursive operator/attribute inventory, exact initializer payloads, and output parity over a frozen 64-row corpus. Both exports produced structural digest `0af5cba791e63a81fa5ff6322096c1fbdd53839a1b2cc73d106c35769c0a6b38` and maximum absolute error `0.0` in that comparison.

## Recipe order

1. Convert the official SavedModel with `scripts/convert-speech-embedding.sh`.
2. Verify a repeated export against `models/speech-embedding.onnx` with `scripts/verify-equivalent-backbone.py`.
3. Generate disjoint positive cohorts with `scripts/generate-candidate.py`.
4. Add LibriSpeech `dev-clean` negatives with `scripts/add-candidate-negatives.py`.
5. Train and export the classifier with `scripts/train-candidate.py`.
6. Build the separate shipping calibration bank with `scripts/add-shipping-negatives.py` plus the same Piper synthesis settings for its 100 phrase-conditioned speaker negatives.

The scripts preserve the exact spike layout under `/tmp`; paths are evidence of the executed recipe rather than a production runtime interface. No raw audio is committed.

## Candidate result

`candidate-result.json` records 98/100 keyword recall and zero false accepts over 1,000 non-trigger clips from 20 speakers. The shipping payload digests are:

- `models/speech-embedding.onnx`: `e6d1aaf9f052a340ee1a006103f4de4897ad9894c880b74afc90571e6596a18e`
- `models/hey-mastra-keyword.onnx`: `f70e19a02544faba9a1850646f518430391b06dcfdbcb430c73c480064351264`
