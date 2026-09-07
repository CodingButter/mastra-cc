#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(git -C "$HERE" rev-parse --show-toplevel)"
CONSUMER="$(realpath "${1:?Pass an installed consumer directory}")"
BASE="${2:-2e48a59}"
SCRATCH="$(mktemp -d /tmp/fetch-retry-proof.XXXXXX)"
trap 'rm -rf "$SCRATCH"' EXIT
# Both runs use the same installed SDK and offline injected failure.
for variant in branch base; do
  mkdir "$SCRATCH/$variant"
  ln -s "$CONSUMER/node_modules" "$SCRATCH/$variant/node_modules"
  cp "$HERE/sdk-probe.mjs" "$SCRATCH/$variant/"
done
cp "$HERE/../model-rate.mjs" "$SCRATCH/branch/"
git -C "$ROOT" show "$BASE:docs/proofs/mousepad-verified-find-replace/model-rate.mjs" > "$SCRATCH/base/model-rate.mjs"
# Prove the new path before relying on the old failure.
node "$SCRATCH/branch/sdk-probe.mjs" > "$HERE/with.txt" 2>&1
printf '\nPROOF: GREEN — installed SDK recovers before-response failure within original retry bound\n' >> "$HERE/with.txt"
if node "$SCRATCH/base/sdk-probe.mjs" > "$HERE/without.txt" 2>&1; then
  echo 'ERROR: baseline unexpectedly passed'; exit 1
fi
grep -q 'other side closed' "$HERE/without.txt"
printf '\nPROOF: RED — identical installed SDK probe fails before the transport fix\n' >> "$HERE/without.txt"
tail -1 "$HERE/without.txt"
tail -1 "$HERE/with.txt"
