#!/usr/bin/env bash
# The live lane for the cdp backend, on demand: boots the fixture-page server
# and a REAL headless Chrome on the daemon's ports, runs the conformance suite
# with MASTRA_CC_LIVE=1, then tears down only the pids it started.
set -eu

DEBUG_PORT=9744 # must agree with daemon/src/backends/cdp/channel.ts
PAGE_PORT=9745
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROFILE="$(mktemp -d /tmp/mastra-cc-live-profile.XXXXXX)"

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

for _ in $(seq 1 50); do
  curl -sf "http://127.0.0.1:$DEBUG_PORT/json/version" >/dev/null 2>&1 && break
  sleep 0.2
done

cd "$ROOT"
MASTRA_CC_LIVE=1 pnpm --filter @mastra-cc/daemon exec vitest run src/__tests__/backend-conformance.test.ts --reporter=dot
