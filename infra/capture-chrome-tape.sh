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

# Refuse to run against a browser this script did not start. Measured the hard
# way: a daemon-launched Chrome holding the user's real profile was still
# listening on the debugging port, the wait loop below was satisfied by ITS
# answer, and the capture recorded that browser's tabs - inbox titles, account
# address and all - into the fixture tape. The wait loop cannot tell whose
# browser answered, so the only safe check is that nothing is there beforehand.
for PORT in "$DEBUG_PORT" "$PAGE_PORT"; do
  if curl -sf -m 2 "http://127.0.0.1:$PORT/" >/dev/null 2>&1 || curl -sf -m 2 "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1; then
    echo "capture: something is already listening on 127.0.0.1:$PORT - refusing to capture a browser this script did not start"
    exit 1
  fi
done

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

# --grant chrome: this browser was started by the script, not launched by the
# daemon - without a session observe grant, deny-by-default (ADR-0036) would
# answer an empty tree and the tape would capture nothing (the vacuous-pass trap).
#
# The exit status is deliberately not allowed to abort the script under `set
# -e`: a capture can write a tape AND exit non-zero (a query that matched
# nothing does exactly that), and skipping the scan below would leave an
# unscanned tape on disk. That happened once, with a real inbox in it. The
# scan runs on whatever was written, then the recorded status is honoured.
CAPTURE_STATUS=0
node "$ROOT/daemon/dist/main.mjs" --backend cdp --capture chrome-page --grant chrome --query "OK" || CAPTURE_STATUS=$?

TAPE="$ROOT/daemon/fixtures/chrome-page/tape.json"
[ -s "$TAPE" ] || { echo "capture: no tape written at $TAPE"; exit 1; }
if grep -iE "codingbutter|$(hostname)|/home/" "$TAPE"; then
  echo "capture: PERSONAL STRINGS in the tape above - refusing to keep it"
  rm -f "$TAPE"
  exit 1
fi
echo "capture: tape scanned clean"

# Only now, with the tape scanned, does a failed capture fail the script.
[ "$CAPTURE_STATUS" -eq 0 ] || { echo "capture: the capture command exited $CAPTURE_STATUS - the tape above is scanned but the query did not succeed"; exit "$CAPTURE_STATUS"; }
