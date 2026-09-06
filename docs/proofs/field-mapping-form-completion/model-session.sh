#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
RUN="$2"; KIND="$3"
if [[ "$1" == --display ]]; then
  mkdir -m 700 "$RUN/home" "$RUN/runtime"
  Xvfb -displayfd 3 -screen 0 1024x768x24 -nolisten tcp 3>"$RUN/display" >"$RUN/xvfb.log" 2>&1 & xvfb=$!
  trap 'kill "$xvfb" 2>/dev/null || true; wait "$xvfb" 2>/dev/null || true' EXIT
  trap 'exit 143' TERM INT
  for ((i=0;i<50;i++)); do [[ -s "$RUN/display" ]] && break; sleep .1; done
  [[ -s "$RUN/display" ]]
  env -u WAYLAND_DISPLAY -u DBUS_SESSION_BUS_ADDRESS -u AT_SPI_BUS_ADDRESS -u XAUTHORITY -u MASTRA_CC_SOCKET -u MASTRA_CC_URL \
    DISPLAY=":$(<"$RUN/display")" HOME="$RUN/home" XDG_CONFIG_HOME="$RUN/home/config" XDG_CACHE_HOME="$RUN/home/cache" XDG_DATA_HOME="$RUN/home/data" XDG_RUNTIME_DIR="$RUN/runtime" \
    dbus-run-session -- bash "$0" --session "$RUN" "$KIND"
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
  for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
  exit "$status"
}
trap cleanup EXIT
trap 'exit 143' INT TERM
export GDK_BACKEND=x11 GTK_MODULES=gail:atk-bridge NO_AT_BRIDGE=0
launcher=""
for f in /usr/libexec/at-spi-bus-launcher /usr/libexec/at-spi2-core/at-spi-bus-launcher /usr/lib/at-spi2-core/at-spi-bus-launcher; do [[ ! -x "$f" ]] || { launcher="$f"; break; }; done
[[ -n "$launcher" ]]
"$launcher" --launch-immediately --a11y=1 >"$RUN/a11y.log" 2>&1 & pids+=("$!")
openbox >"$RUN/openbox.log" 2>&1 & pids+=("$!")
sleep 1
ffmpeg -nostdin -y -loglevel warning -f x11grab -framerate 10 -video_size 1024x768 -i "$DISPLAY" -c:v libx264 -preset ultrafast -crf 18 -pix_fmt yuv420p "$RUN/screen.mkv" >"$RUN/ffmpeg.log" 2>&1 & recorder=$!
date +%s%3N >"$RUN/recording-start-ms.txt"
if [[ "$KIND" == receipt ]]; then
  app=yad
  bash "$ROOT/docs/proofs/model-desktop-task-2026-09-06/fixture.sh" "$RUN" >"$RUN/fixture.log" 2>&1 & pids+=("$!")
else
  app=exo-desktop-item-edit
  printf '[Desktop Entry]\nVersion=1.0\nType=Application\nName=Initial name\nComment=Initial comment\nExec=/usr/bin/true\nTerminal=false\n' >"$RUN/launcher.desktop"
  cp "$RUN/launcher.desktop" "$RUN/launcher-before.desktop"
  dpkg-query -W exo-utils >"$RUN/exo-version.txt"
  sha256sum "$(command -v exo-desktop-item-edit)" >"$RUN/exo-executable.sha256"
  # Reopen only for public saved-state readback. Never write task values here.
  (exo-desktop-item-edit "$RUN/launcher.desktop"; date +%s%3N >"$RUN/reopened-ms.txt"; exec exo-desktop-item-edit "$RUN/launcher.desktop") >"$RUN/app.log" 2>&1 & pids+=("$!")
fi
sleep 1
printf '%s\n' "--backend atspi --grant $app --allow edit --allow activate --allow rawInput" >"$RUN/grant.txt"
node "$ROOT/daemon/dist/main.mjs" --backend atspi --grant "$app" --allow edit --allow activate --allow rawInput --socket "$XDG_RUNTIME_DIR/d.sock" --ws-host 127.0.0.1 --ws-port 0 >"$RUN/daemon.log" 2>&1 & pids+=("$!")
node "$HERE/model-driver.mjs" "$RUN" "$KIND" >"$RUN/driver.log" 2>&1 & driver=$!; pids+=("$driver")
wait "$driver"
