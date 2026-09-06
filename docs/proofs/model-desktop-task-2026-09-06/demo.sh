#!/usr/bin/env bash
# Controlled native fixture, not a real business app or proof of general competence.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"

if [[ "${1:-}" == --session ]]; then
  RUN="$2"; LAUNCHER="$3"
  pids=(); recorder=""
  cleanup() {
    local status=$? recording_status=0
    trap - EXIT INT TERM
    if [[ -n "$recorder" ]]; then
      # SIGINT lets ffmpeg write the Matroska trailer before the display disappears.
      kill -INT "$recorder" 2>/dev/null || true
      for ((i=0; i<100; i++)); do
        kill -0 "$recorder" 2>/dev/null || break
        sleep 0.1
      done
      if kill -0 "$recorder" 2>/dev/null; then
        kill -KILL "$recorder" 2>/dev/null || true
        recording_status=1
      fi
      wait "$recorder" || { [[ "$?" == 255 ]] || recording_status=1; }
      ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,duration \
        -of json "$RUN/screen.mkv" >"$RUN/recording.json" 2>"$RUN/recording-error.log" || recording_status=1
      [[ -s "$RUN/screen.mkv" ]] || recording_status=1
    fi
    for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
    sleep 0.3
    for pid in "${pids[@]}"; do kill -KILL "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; done
    (( recording_status == 0 )) || status=1
    exit "$status"
  }
  trap cleanup EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  export GDK_BACKEND=x11 GTK_MODULES=gail:atk-bridge NO_AT_BRIDGE=0
  "$LAUNCHER" --launch-immediately --a11y=1 >"$RUN/a11y.log" 2>&1 & pids+=("$!")
  openbox >"$RUN/openbox.log" 2>&1 & pids+=("$!")
  sleep 1
  ffmpeg -nostdin -y -loglevel warning -f x11grab -framerate 10 -video_size 1024x768 \
    -i "$DISPLAY" -c:v libx264 -preset ultrafast -crf 18 -pix_fmt yuv420p \
    "$RUN/screen.mkv" >"$RUN/ffmpeg.log" 2>&1 & recorder=$!
  sleep 0.5
  kill -0 "$recorder"
  bash "$HERE/fixture.sh" "$RUN" >"$RUN/fixture.log" 2>&1 & pids+=("$!")
  node "$ROOT/daemon/dist/main.mjs" --backend atspi --grant yad \
    --allow edit --allow activate --allow rawInput --socket "$RUN/daemon.sock" \
    --ws-host 127.0.0.1 --ws-port 0 >"$RUN/daemon.log" 2>&1 & pids+=("$!")
  node "$HERE/driver.mjs" "$RUN" 2>&1 | tee "$RUN/transcript.log"
  exit
fi

for cmd in Xvfb dbus-run-session yad node timeout openbox ffmpeg ffprobe; do
  command -v "$cmd" >/dev/null || { echo "Missing requirement: $cmd" >&2; exit 1; }
done
for built in daemon/dist/main.mjs packages/desktop/dist/index.mjs packages/desktop/dist/mastra.mjs; do
  [[ -f "$ROOT/$built" ]] || { echo "Build first: missing $built" >&2; exit 1; }
done
[[ -n "${GOOGLE_API_KEY:-}" ]] || { echo 'Missing GOOGLE_API_KEY' >&2; exit 1; }
LAUNCHER=""
for candidate in /usr/libexec/at-spi-bus-launcher /usr/libexec/at-spi2-core/at-spi-bus-launcher /usr/lib/at-spi2-core/at-spi-bus-launcher; do
  if [[ -x "$candidate" ]]; then LAUNCHER="$candidate"; break; fi
done
[[ -n "$LAUNCHER" ]] || { echo 'Missing at-spi-bus-launcher' >&2; exit 1; }
RUN="$(mktemp -d /tmp/model-desktop-task.XXXXXX)"
echo "Controlled native fixture; not a real business app or proof of general competence."
echo "RUN=$RUN"
Xvfb -displayfd 3 -screen 0 1024x768x24 -nolisten tcp 3>"$RUN/display" >"$RUN/xvfb.log" 2>&1 &
XVFB_PID=$!
cleanup() { kill "$XVFB_PID" 2>/dev/null || true; wait "$XVFB_PID" 2>/dev/null || true; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
for ((i=0; i<50; i++)); do
  [[ -s "$RUN/display" ]] && break
  kill -0 "$XVFB_PID" 2>/dev/null || { echo 'Xvfb failed' >&2; exit 1; }
  sleep 0.1
done
[[ -s "$RUN/display" ]] || { echo 'Xvfb readiness timed out' >&2; exit 1; }
mkdir -m 700 "$RUN/runtime" "$RUN/home"
timeout --kill-after=15s 240s env -u WAYLAND_DISPLAY -u DBUS_SESSION_BUS_ADDRESS \
  -u AT_SPI_BUS_ADDRESS -u XAUTHORITY -u MASTRA_CC_SOCKET -u MASTRA_CC_URL \
  DISPLAY=":$(<"$RUN/display")" XDG_RUNTIME_DIR="$RUN/runtime" \
  HOME="$RUN/home" XDG_CONFIG_HOME="$RUN/home/config" \
  dbus-run-session -- bash "$HERE/demo.sh" --session "$RUN" "$LAUNCHER"
cleanup
trap - EXIT
echo 'PROOF: GREEN'
