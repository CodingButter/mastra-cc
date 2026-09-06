#!/usr/bin/env bash
# Native inspection only; no model task or success claim.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
if [[ "${1:-}" == deterministic ]]; then exec bash "$HERE/deterministic.sh"; fi
if [[ "${1:-}" == model ]]; then shift; exec node "$HERE/model-batch.mjs" "$@"; fi
if [[ "${1:-}" == --session ]]; then
  RUN="$2"
  pids=(); recorder=""
  cleanup() {
    status=$?; trap - EXIT INT TERM
    if [[ -n "$recorder" ]]; then
      kill -INT "$recorder" 2>/dev/null || true
      for ((i=0;i<50;i++)); do kill -0 "$recorder" 2>/dev/null || break; sleep 0.1; done
      kill -KILL "$recorder" 2>/dev/null || true
      wait "$recorder" 2>/dev/null || true
    fi
    for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
    sleep 0.2
    for pid in "${pids[@]}"; do kill -KILL "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; done
    exit "$status"
  }
  trap cleanup EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  export FIELD_PROOF_ISOLATED=1 GDK_BACKEND=x11 GTK_MODULES=gail:atk-bridge NO_AT_BRIDGE=0
  /usr/libexec/at-spi-bus-launcher --launch-immediately --a11y=1 >"$RUN/a11y.log" 2>&1 & pids+=("$!")
  openbox >"$RUN/openbox.log" 2>&1 & pids+=("$!")
  sleep 1
  ffmpeg -nostdin -y -loglevel warning -f x11grab -framerate 10 -video_size 1024x768 -i "$DISPLAY" \
    -c:v libx264 -preset ultrafast -crf 18 -pix_fmt yuv420p "$RUN/screen.mkv" >"$RUN/ffmpeg.log" 2>&1 & recorder=$!
  bash "$ROOT/docs/proofs/model-desktop-task-2026-09-06/fixture.sh" "$RUN/receipt" >"$RUN/fixture.log" 2>&1 & pids+=("$!")
  sleep 2
  node "$HERE/probe.mjs" yad "$RUN/receipt-native.json" >"$RUN/receipt-fields.txt"
  ffmpeg -nostdin -y -loglevel error -f x11grab -video_size 1024x768 -i "$DISPLAY" -frames:v 1 "$RUN/receipt.png"
  node "$ROOT/daemon/dist/main.mjs" --backend atspi --grant yad --allow edit --allow activate --allow rawInput --socket "$RUN/receipt.sock" >"$RUN/receipt-daemon.log" 2>&1 & daemon=$!; pids+=("$daemon")
  node "$HERE/observe.mjs" "$RUN/receipt.sock" yad "$RUN/receipt-public.json"
  printf '{"Receipt number":"CALIBRATION-7F29","Total paid":"123.45"}\n' >"$RUN/receipt-calibration-input.json"
  node "$HERE/calibrate.mjs" "$RUN/receipt-native.json" "$RUN/receipt-calibration-input.json" 'Record receipt' >"$RUN/receipt-calibration.json"
  sleep 1
  node "$HERE/observe.mjs" "$RUN/receipt.sock" yad "$RUN/receipt-confirmation-public.json"
  ffmpeg -nostdin -y -loglevel error -f x11grab -video_size 1024x768 -i "$DISPLAY" -frames:v 1 "$RUN/receipt-confirmation.png"
  kill "$daemon"; wait "$daemon" || true
  # Open the ordinary application only in this private session and HOME.
  printf '[Desktop Entry]\nVersion=1.0\nType=Application\nName=Initial name\nComment=Initial comment\nExec=/usr/bin/true\nTerminal=false\n' >"$RUN/launcher.desktop"
  exo-desktop-item-edit "$RUN/launcher.desktop" >"$RUN/exo.log" 2>&1 & pids+=("$!")
  sleep 2
  node "$HERE/probe.mjs" exo-desktop-item-edit "$RUN/exo-native.json" >"$RUN/exo-fields.txt"
  ffmpeg -nostdin -y -loglevel error -f x11grab -video_size 1024x768 -i "$DISPLAY" -frames:v 1 "$RUN/exo.png"
  cp "$RUN/launcher.desktop" "$RUN/launcher-before.desktop"
  printf '{"Name:":"Calibration launcher 7F29","Comment:":"Calibration comment 82B1"}\n' >"$RUN/exo-calibration-input.json"
  node "$ROOT/daemon/dist/main.mjs" --backend atspi --grant exo-desktop-item-edit --allow edit --allow activate --allow rawInput --socket "$RUN/exo.sock" >"$RUN/exo-daemon.log" 2>&1 & pids+=("$!")
  node "$HERE/observe.mjs" "$RUN/exo.sock" exo-desktop-item-edit "$RUN/exo-public.json"
  node "$HERE/calibrate.mjs" "$RUN/exo-native.json" "$RUN/exo-calibration-input.json" Save >"$RUN/exo-calibration.json"
  sleep 1
  exo-desktop-item-edit "$RUN/launcher.desktop" >"$RUN/exo-reopen.log" 2>&1 & pids+=("$!")
  sleep 1
  node "$HERE/observe.mjs" "$RUN/exo.sock" exo-desktop-item-edit "$RUN/exo-confirmation-public.json"
  ffmpeg -nostdin -y -loglevel error -f x11grab -video_size 1024x768 -i "$DISPLAY" -frames:v 1 "$RUN/exo-confirmation.png"
  exit
fi
[[ "${1:-}" == inspect ]] || { echo 'Usage: demo.sh inspect' >&2; exit 2; }
for cmd in Xvfb dbus-run-session yad exo-desktop-item-edit node timeout openbox ffmpeg ffprobe; do command -v "$cmd" >/dev/null || { echo "Missing prerequisite: $cmd" >&2; exit 1; }; done
[[ -x /usr/libexec/at-spi-bus-launcher ]]
RUN="$(mktemp -d "$HERE/inspect.XXXXXX")"
echo "RUN=$RUN"
Xvfb -displayfd 3 -screen 0 1024x768x24 -nolisten tcp 3>"$RUN/display" >"$RUN/xvfb.log" 2>&1 & xvfb=$!
trap 'kill "$xvfb" 2>/dev/null || true; wait "$xvfb" 2>/dev/null || true' EXIT
for ((i=0;i<50;i++)); do [[ -s "$RUN/display" ]] && break; sleep 0.1; done
[[ -s "$RUN/display" ]]
mkdir -m 700 "$RUN/home" "$RUN/runtime"
dpkg-query -W exo-utils >"$RUN/exo-version.txt"
sha256sum "$(command -v exo-desktop-item-edit)" >"$RUN/exo-executable.sha256"
timeout --kill-after=15s 90s env -u WAYLAND_DISPLAY -u DBUS_SESSION_BUS_ADDRESS -u AT_SPI_BUS_ADDRESS -u XAUTHORITY \
  DISPLAY=":$(<"$RUN/display")" XDG_RUNTIME_DIR="$RUN/runtime" HOME="$RUN/home" XDG_CONFIG_HOME="$RUN/home/config" \
  dbus-run-session -- bash "$HERE/demo.sh" --session "$RUN"
ffprobe -v error -show_entries format=duration -of json "$RUN/screen.mkv" >"$RUN/recording.json"
sha256sum "$RUN/receipt.png" "$RUN/exo.png" "$RUN/screen.mkv" >"$RUN/visuals.sha256"
node "$HERE/evidence.mjs" "$RUN" | tee "$RUN/oracle.json"
echo 'PROOF: EVIDENCE'
