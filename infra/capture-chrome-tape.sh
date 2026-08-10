#!/usr/bin/env bash
# Captures daemon/fixtures/chrome-page/tape.json from a REAL headless Chrome -
# fixtures are captured, never hand-authored. Boots the fixture-page server
# and Chrome on the daemon's own ports, runs a one-shot query through the cdp
# backend with --capture, tears down only the pids it started, then scans the
# tape for personal strings and fails loudly on any hit.
set -eu

DEBUG_PORT=9744 # must agree with daemon/src/backends/cdp/channel.ts
PAGE_PORT=9745
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROFILE="$(mktemp -d /tmp/mastra-cc-capture-profile.XXXXXX)"

cleanup() {
  [ -n "${CHROME_PID:-}" ] && kill "$CHROME_PID" 2>/dev/null && wait "$CHROME_PID" 2>/dev/null
  [ -n "${PAGE_PID:-}" ] && kill "$PAGE_PID" 2>/dev/null
  # Chrome's renderer children can outlive the killed parent by a beat and
  # write into the profile mid-removal (the Phase 1 teardown lesson); retry.
  rm -rf "$PROFILE" 2>/dev/null || { sleep 1; rm -rf "$PROFILE" 2>/dev/null || true; }
}
trap cleanup EXIT

node "$ROOT/infra/serve-chrome-page.mjs" &
PAGE_PID=$!

# Chrome >=136 ignores the debugging port without a non-default user data dir.
google-chrome --headless=new "--remote-debugging-port=$DEBUG_PORT" \
  "--user-data-dir=$PROFILE" --no-first-run --no-default-browser-check \
  "http://127.0.0.1:$PAGE_PORT/page.html" >/dev/null 2>&1 &
CHROME_PID=$!

# wait for the endpoint to answer - fail loudly on exhaustion, never fall
# through into a confusing downstream error
i=0
until curl -sf "http://127.0.0.1:$DEBUG_PORT/json/version" >/dev/null 2>&1; do
  i=$((i + 1))
  [ "$i" -gt 50 ] && { echo "capture: chrome's debugging endpoint never answered"; exit 1; }
  sleep 0.2
done

node "$ROOT/daemon/dist/main.mjs" --backend cdp --capture chrome-page --query "OK"

TAPE="$ROOT/daemon/fixtures/chrome-page/tape.json"
[ -s "$TAPE" ] || { echo "capture: no tape written at $TAPE"; exit 1; }
if grep -iE "codingbutter|$(hostname)|/home/" "$TAPE"; then
  echo "capture: PERSONAL STRINGS in the tape above - refusing to keep it"
  rm -f "$TAPE"
  exit 1
fi
echo "capture: tape scanned clean"
