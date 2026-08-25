#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 3 ]; then
  echo "usage: $0 <python-with-tf2onnx> <saved-model-directory> <output.onnx>" >&2
  exit 2
fi

python_bin="$1"
saved_model="$2"
output="$3"

"$python_bin" -m tf2onnx.convert \
  --saved-model "$saved_model" \
  --tag '' \
  --signature_def default \
  --opset 17 \
  --output "$output" \
  --rename-inputs audio_samples \
  --rename-outputs embeddings
