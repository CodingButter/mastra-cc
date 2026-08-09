#!/usr/bin/env bash
# Every Phase 2 spike must refuse to write a partial artifact. A spike that
# writes a half-filled table is a spike that lies, and the table gets quoted
# later by someone who was not here.
#
# A pass is: non-zero exit AND the artifact untouched.
set -u
cd "$(dirname "$0")/../.."
pass=0; fail=0

check() {
  local name="$1" artifact="$2"; shift 2
  local before after ec
  before=$(sha256sum "$artifact" 2>/dev/null | cut -d' ' -f1 || echo MISSING)
  "$@" >/dev/null 2>&1; ec=$?
  after=$(sha256sum "$artifact" 2>/dev/null | cut -d' ' -f1 || echo MISSING)
  if [ "$ec" -ne 0 ] && [ "$before" = "$after" ]; then
    echo "  PASS  $name (exit=$ec, artifact untouched)"; pass=$((pass+1))
  else
    echo "  FAIL  $name (exit=$ec, artifact changed=$([ "$before" != "$after" ] && echo yes || echo no))"; fail=$((fail+1))
  fi
}

echo "Phase 2 refusal checks:"
check "node-atspi (missing observation)" docs/proofs/can-node-read-the-accessibility-tree.md \
  node spikes/daemon/node-atspi.mjs --skip-observation roles-readable
check "node-atspi-events (missing observation)" docs/proofs/can-node-be-told-the-desktop-changed.md \
  node spikes/daemon/node-atspi-events.mjs --skip-observation attributable-events
check "node-atspi-write (missing observation)" docs/proofs/can-node-act-on-the-desktop.md \
  node spikes/daemon/node-atspi-write.mjs --skip-observation text-verified
check "thread-safety (no overlap possible)" docs/proofs/is-the-accessibility-binding-thread-safe.md \
  python3 spikes/daemon/thread-safety.py --threads 1 --reads 3

echo "  ---"
echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ]
