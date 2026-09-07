#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
RUN="$2"; CONSUMER="$3"
if [[ "$1" == --display ]]; then
  mkdir -m 700 "$RUN/home" "$RUN/runtime"
  Xvfb -displayfd 3 -screen 0 1024x768x24 -nolisten tcp 3>"$RUN/display" >"$RUN/xvfb.log" 2>&1 & xvfb=$!
  trap 'kill "$xvfb" 2>/dev/null || true; wait "$xvfb" 2>/dev/null || true' EXIT
  trap 'exit 143' TERM INT
  for ((i=0;i<50;i++)); do [[ -s "$RUN/display" ]] && break; sleep .1; done
  [[ -s "$RUN/display" ]]
  env -u WAYLAND_DISPLAY -u DBUS_SESSION_BUS_ADDRESS -u AT_SPI_BUS_ADDRESS -u XAUTHORITY -u MASTRA_CC_SOCKET -u MASTRA_CC_URL \
    DISPLAY=":$(<"$RUN/display")" HOME="$RUN/home" XDG_CONFIG_HOME="$RUN/home/config" XDG_CACHE_HOME="$RUN/home/cache" XDG_DATA_HOME="$RUN/home/data" XDG_RUNTIME_DIR="$RUN/runtime" MOUSEPAD_PROOF_ISOLATED=1 \
    dbus-run-session -- bash "$0" --session "$RUN" "$CONSUMER"
  exit
fi
pids=(); recorder=""
cleanup() {
  status=$?; trap - EXIT INT TERM
  if [[ -n "$recorder" ]]; then
    kill -INT "$recorder" 2>/dev/null || true
    for ((i=0;i<60;i++)); do kill -0 "$recorder" 2>/dev/null || break; sleep .1; done
    kill -KILL "$recorder" 2>/dev/null || true; wait "$recorder" 2>/dev/null || true
    ffprobe -v error -show_entries format=duration -of json "$RUN/screen.mkv" >"$RUN/recording.json" || status=1
  fi
  for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; done
  exit "$status"
}
trap cleanup EXIT
trap 'exit 143' INT TERM
export GDK_BACKEND=x11 GTK_MODULES=gail:atk-bridge NO_AT_BRIDGE=0
/usr/libexec/at-spi-bus-launcher --launch-immediately --a11y=1 >"$RUN/a11y.log" 2>&1 & pids+=("$!")
openbox >"$RUN/openbox.log" 2>&1 & pids+=("$!")
sleep 1
ffmpeg -nostdin -y -loglevel warning -f x11grab -framerate 10 -video_size 1024x768 -i "$DISPLAY" -c:v libx264 -preset ultrafast -crf 18 -pix_fmt yuv420p "$RUN/screen.mkv" >"$RUN/ffmpeg.log" 2>&1 & recorder=$!
printf 'North TOKEN_41 east\nTOKEN_41 centre TOKEN_41 south.\n' >"$RUN/document.txt"
cp "$RUN/document.txt" "$RUN/before.txt"
printf 'North VALUE_73 east\nVALUE_73 centre VALUE_73 south.\n' >"$RUN/expected.txt"
mousepad --disable-server "$RUN/document.txt" >"$RUN/app.log" 2>&1 & app=$!; pids+=("$app")
sleep 1
printf '%s\n' '--backend atspi --grant mousepad (observe only; mutation belongs to independent native calibration)' >"$RUN/grant.txt"
node "${MOUSEPAD_PROOF_DAEMON:-$ROOT/daemon/dist/main.mjs}" --backend atspi --grant mousepad --socket "$XDG_RUNTIME_DIR/d.sock" --ws-host 127.0.0.1 --ws-port 0 >"$RUN/daemon.log" 2>&1 & pids+=("$!")
node "$HERE/calibrate.mjs" "$RUN" "$CONSUMER" >"$RUN/calibrate.log" 2>&1
mv "$RUN/native-exchanges.json" "$RUN/calibration-native-exchanges.json"
kill -TERM "$app"
wait "$app" || true
for i in "${!pids[@]}"; do [[ "${pids[$i]}" != "$app" ]] || unset 'pids[i]'; done
printf 'Closed original process %s; reopening saved file in a fresh Mousepad process.\n' "$app" >"$RUN/reopen.log"
mousepad --disable-server "$RUN/document.txt" >"$RUN/reopened-app.log" 2>&1 & pids+=("$!")
sleep 1
node "$HERE/calibrate.mjs" "$RUN" "$CONSUMER" --reopened >>"$RUN/calibrate.log" 2>&1
mv "$RUN/native-exchanges.json" "$RUN/reopened-native-exchanges.json"
