#!/usr/bin/env bash
# Throwaway. Proves that every spike in this directory REFUSES rather than
# writing a partial artifact.
#
# A spike that writes a half-filled table is worse than a spike that writes
# nothing, because the half-filled table gets quoted later with no memory of
# what was missing. This script makes each spike fail on purpose and asserts
# two things: a non-zero exit, and an artifact file that did not change.
#
# Usage: bash spikes/browser/refusal-check.sh

set -uo pipefail
cd "$(dirname "$0")/../.."

pass=0
fail=0

check() {
  local label="$1" artifact="$2"
  shift 2

  local before="/tmp/refusal-before-$$"
  if [ -f "$artifact" ]; then cp "$artifact" "$before"; else rm -f "$before"; fi

  set +e
  "$@" >/dev/null 2>&1
  local code=$?
  set -e

  local unchanged=1
  if [ -f "$before" ] && [ -f "$artifact" ]; then
    cmp -s "$before" "$artifact" || unchanged=0
  elif [ ! -f "$before" ] && [ -f "$artifact" ]; then
    unchanged=0   # it wrote an artifact that did not exist before: not a refusal
  fi

  if [ "$code" -ne 0 ] && [ "$unchanged" -eq 1 ]; then
    printf '  PASS  %-46s exit=%s artifact untouched\n' "$label" "$code"
    pass=$((pass + 1))
  else
    printf '  FAIL  %-46s exit=%s artifact-unchanged=%s\n' "$label" "$code" "$unchanged"
    fail=$((fail + 1))
  fi
  rm -f "$before"
}

echo "Making each spike fail on purpose. A pass here is a non-zero exit AND an untouched artifact."
echo

check "cdp-substrate: missing observation" \
  docs/proofs/what-the-browser-protocol-gives-us.md \
  node spikes/browser/cdp-substrate.mjs --port 9611 --skip-observation oopif-after-rearm

check "coverage-count: missing observation" \
  docs/proofs/what-a-page-level-recorder-observes.md \
  node spikes/browser/coverage-count.mjs --port 9621 --skip-observation paths-observed

check "unfocused-input: missing observation" \
  docs/proofs/can-we-type-without-taking-focus.md \
  node spikes/browser/unfocused-input.mjs --port 9631 --skip-observation typed-text-arrived

check "subscribe-changes: missing observation" \
  docs/proofs/can-we-subscribe-to-element-changes.md \
  node spikes/browser/subscribe-changes.mjs --port 9641 --skip-observation latency-ms

check "electron-attach: unknown app to launch" \
  docs/proofs/which-apps-the-browser-adapter-covers.md \
  node spikes/browser/electron-attach.mjs --launch definitely-not-installed --port 9651

check "a11y-conditions: impossible condition" \
  docs/proofs/which-condition-makes-a-browser-readable.md \
  python3 spikes/browser/a11y-conditions.py --condition baseline --settle 0.05

echo
echo "refusal-check: ${pass} passed, ${fail} failed"
[ "$fail" -eq 0 ]
