#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"

if [[ "${1:-}" == --session ]]; then
  RUN="$2"; LAUNCHER="$3"
  pids=()
  cleanup() {
    trap - EXIT INT TERM
    for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
    sleep 0.3
    for pid in "${pids[@]}"; do kill -KILL "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; done
  }
  trap cleanup EXIT
  trap 'exit 130' INT TERM
  "$LAUNCHER" --launch-immediately --a11y=1 >"$RUN/a11y.log" 2>&1 & pids+=("$!")
  # Force GTK onto this X server and private accessibility bus, not inherited ones.
  export GDK_BACKEND=x11 GTK_MODULES=gail:atk-bridge NO_AT_BRIDGE=0
  sleep 1
  bash "$HERE/fixture.sh" "$RUN" >"$RUN/fixture.log" 2>&1 & pids+=("$!")
  node "$ROOT/daemon/dist/main.mjs" --backend atspi --grant yad \
    --allow edit --allow activate --allow rawInput --socket "$RUN/daemon.sock" \
    --ws-host 127.0.0.1 --ws-port 0 >"$RUN/daemon.log" 2>&1 & pids+=("$!")
  xwd -root -silent >"$RUN/root.xwd"
  node "$HERE/driver.mjs" "$RUN"
  exit
fi

for cmd in Xvfb dbus-run-session yad node timeout xwd; do
  command -v "$cmd" >/dev/null || { echo "Missing requirement: $cmd" >&2; exit 1; }
done
for built in daemon/dist/main.mjs packages/desktop/dist/index.mjs; do
  [[ -f "$ROOT/$built" ]] || { echo "Build first: missing $built" >&2; exit 1; }
done
LAUNCHER=""
for candidate in /usr/libexec/at-spi-bus-launcher /usr/libexec/at-spi2-core/at-spi-bus-launcher /usr/lib/at-spi2-core/at-spi-bus-launcher; do
  if [[ -x "$candidate" ]]; then LAUNCHER="$candidate"; break; fi
done
[[ -n "$LAUNCHER" ]] || { echo 'Missing at-spi-bus-launcher' >&2; exit 1; }
RUN="$(mktemp -d /tmp/native-restoration.XXXXXX)"
echo "Artifacts: $RUN"
Xvfb -displayfd 3 -screen 0 1024x768x24 -nolisten tcp 3>"$RUN/display" >"$RUN/xvfb.log" 2>&1 &
XVFB_PID=$!
cleanup() { kill "$XVFB_PID" 2>/dev/null || true; wait "$XVFB_PID" 2>/dev/null || true; }
trap cleanup EXIT
trap 'exit 130' INT TERM
for ((i=0; i<50; i++)); do
  [[ -s "$RUN/display" ]] && break
  kill -0 "$XVFB_PID" 2>/dev/null || { cat "$RUN/xvfb.log" >&2; exit 1; }
  sleep 0.1
done
[[ -s "$RUN/display" ]] || { echo 'Xvfb readiness timed out' >&2; exit 1; }
mkdir -m 700 "$RUN/runtime" "$RUN/home"
# Only loopback WebSocket traffic; no external service or personal desktop.
timeout --kill-after=5s 90s env -u WAYLAND_DISPLAY -u DBUS_SESSION_BUS_ADDRESS \
  -u AT_SPI_BUS_ADDRESS -u XAUTHORITY -u MASTRA_CC_SOCKET -u MASTRA_CC_URL \
  DISPLAY=":$(<"$RUN/display")" XDG_RUNTIME_DIR="$RUN/runtime" \
  HOME="$RUN/home" XDG_CONFIG_HOME="$RUN/home/config" \
  dbus-run-session -- bash "$HERE/demo.sh" --session "$RUN" "$LAUNCHER"
echo 'PROOF: GREEN'
