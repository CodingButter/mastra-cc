#!/usr/bin/env bash
set -euo pipefail
here="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cap=75s
for arg in "$@"; do
  if [[ "$arg" == --uncooperative ]]; then cap=20s; fi
done
# pipefail preserves the harness/timeout status while retaining a readable log.
if [[ -n "${PROOF_LOG:-}" ]]; then
  # Reserve a new log without truncating historical evidence.
  (set -o noclobber; : > "$PROOF_LOG") || exit 1
  timeout --signal=TERM --kill-after=2s "$cap" node "$here/proof.mjs" "$@" 2>&1 | tee -a "$PROOF_LOG"
else
  timeout --signal=TERM --kill-after=2s "$cap" node "$here/proof.mjs" "$@"
fi
