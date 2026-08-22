#!/usr/bin/env bash
# A two-output X11 desk, on demand: an Xorg server on the dummy driver
# advertising two connected outputs side by side, openbox as the EWMH window
# manager, and a real system tray. This is what the M4 window-model harness
# measures against on a machine whose only physical display is a single Wayland
# panel.
#
# Why the dummy driver and not something lighter: Chromium enumerates RANDR
# OUTPUTS and CRTCs, one layer below the RANDR monitor list and below Xinerama.
# `xrandr --setmonitor` and `Xephyr +xinerama` both produce a desk that says
# "two" to xrandr and "one" to the application, which is a desk that would score
# the monitor exit box on a lie. The dummy driver advertises real outputs, so
# the application sees two displays because there are two.
#
# Usage: x11-desk.sh up|check|down [display-number]
#
# The display may be written either way - `:84` or `84`. A display is spelled
# with its colon everywhere it is used and without one everywhere it is passed,
# and taking only one spelling turned the other into `::84`, which is not a
# display and produces a failure that reads as a broken desk.
set -eu

DISPLAY_NUM="${2:-83}"
DISPLAY_NUM="${DISPLAY_NUM#:}"
case "$DISPLAY_NUM" in
  '' | *[!0-9]*)
    echo "x11-desk: display must be a number, such as :84 or 84 - got ${2:-}" >&2
    exit 1
    ;;
esac
RUN_DIR="/tmp/mastra-cc-x11-desk-${DISPLAY_NUM}"
CONF="$RUN_DIR/xorg.conf"
XORG_PID_FILE="$RUN_DIR/xorg.pid"
WM_PID_FILE="$RUN_DIR/wm.pid"
TRAY_PID_FILE="$RUN_DIR/tray.pid"

# Each output is 1024x768 and they sit side by side, so Virtual must span both.
OUTPUT_W=1024
OUTPUT_H=768
VIRTUAL_W=$((OUTPUT_W * 2))

die() {
  echo "x11-desk: $1" >&2
  exit "${2:-1}"
}

write_conf() {
  mkdir -p "$RUN_DIR"
  cat >"$CONF" <<EOF
Section "Monitor"
    Identifier "MonLeft"
    Option "Enable" "true"
EndSection

Section "Monitor"
    Identifier "MonRight"
    Option "Enable" "true"
    Option "RightOf" "MonLeft"
EndSection

Section "Device"
    Identifier "DummyCard"
    Driver "dummy"
    VideoRam 256000
    Option "Monitor-DUMMY0" "MonLeft"
    Option "Monitor-DUMMY1" "MonRight"
EndSection

Section "Screen"
    Identifier "DummyScreen"
    Device "DummyCard"
    DefaultDepth 24
    SubSection "Display"
        Depth 24
        Modes "${OUTPUT_W}x${OUTPUT_H}"
        Virtual ${VIRTUAL_W} ${OUTPUT_H}
    EndSubSection
EndSection

Section "ServerLayout"
    Identifier "DummyLayout"
    Screen 0 "DummyScreen"
EndSection
EOF
}

# Wait for a condition rather than sleeping and hoping. Every wait here fails
# loudly on exhaustion; a desk that half-came-up must not be handed to a harness
# that will then measure something meaningless.
wait_for() {
  what="$1"
  shift
  i=0
  until "$@" >/dev/null 2>&1; do
    i=$((i + 1))
    [ "$i" -gt 100 ] && die "$what never became true on :$DISPLAY_NUM"
    sleep 0.2
  done
}

connected_outputs() {
  DISPLAY=":$DISPLAY_NUM" xrandr 2>/dev/null | grep -cE '^DUMMY[0-9]+ connected' || true
}

two_outputs() {
  [ "$(connected_outputs)" -ge 2 ]
}

wm_is_up() {
  DISPLAY=":$DISPLAY_NUM" xprop -root _NET_SUPPORTING_WM_CHECK 2>/dev/null |
    grep -q 'window id'
}

# Detecting the tray has produced a false negative twice, each time by asking a
# question that looks right and is not:
#
#   xprop -root _NET_SYSTEM_TRAY_S0  - the tray owns an X SELECTION, not a root
#                                      property; reports "not found" against a
#                                      working tray.
#   xwininfo -root -children | grep  - the window manager REPARENTS the tray, so
#                                      the root's child is an unnamed frame and
#                                      the name is one level down.
#
# Ask for the window by name and let the X server do the searching.
tray_is_up() {
  DISPLAY=":$DISPLAY_NUM" xwininfo -name stalonetray >/dev/null 2>&1
}

up() {
  [ -f "$XORG_PID_FILE" ] && kill -0 "$(cat "$XORG_PID_FILE")" 2>/dev/null &&
    die "a desk is already up on :$DISPLAY_NUM - tear it down first"

  for tool in Xorg openbox stalonetray xrandr xprop xwininfo; do
    command -v "$tool" >/dev/null 2>&1 ||
      [ -x "/usr/lib/xorg/$tool" ] ||
      die "missing required tool: $tool"
  done

  write_conf

  # A desk that half-came-up must not be left running: the next `up` would
  # refuse as already-up, and a harness pointed at it would measure a desk
  # missing the very piece whose absence made this fail.
  trap 'rc=$?; [ "$rc" -eq 0 ] || { down >/dev/null 2>&1 || true; }; exit "$rc"' EXIT

  /usr/lib/xorg/Xorg ":$DISPLAY_NUM" -config "$CONF" \
    -logfile "$RUN_DIR/xorg.log" -noreset >"$RUN_DIR/xorg.out" 2>&1 &
  echo $! >"$XORG_PID_FILE"

  wait_for "the X server" env "DISPLAY=:$DISPLAY_NUM" xdpyinfo
  wait_for "two connected outputs" two_outputs

  DISPLAY=":$DISPLAY_NUM" openbox >"$RUN_DIR/wm.log" 2>&1 &
  echo $! >"$WM_PID_FILE"
  wait_for "the window manager" wm_is_up

  DISPLAY=":$DISPLAY_NUM" stalonetray >"$RUN_DIR/tray.log" 2>&1 &
  echo $! >"$TRAY_PID_FILE"
  wait_for "the system tray" tray_is_up

  echo "x11-desk: up on :$DISPLAY_NUM - $(connected_outputs) connected outputs, a window manager, and a tray"
}

check() {
  DISPLAY=":$DISPLAY_NUM" xdpyinfo >/dev/null 2>&1 ||
    die "no X server on :$DISPLAY_NUM"
  two_outputs || die "only $(connected_outputs) connected output(s) on :$DISPLAY_NUM - a single-headed desk cannot score the monitor box"
  wm_is_up || die "no EWMH window manager on :$DISPLAY_NUM"
  tray_is_up || die "no system tray on :$DISPLAY_NUM"
  echo "x11-desk: ok - :$DISPLAY_NUM has $(connected_outputs) connected outputs, a window manager, and a tray"
}

# Teardown kills by RECORDED PID. `pkill -f <pattern>` matches the launching
# shell itself and kills the process being launched; that happened three times
# during planning, once destroying a file mid-write.
down() {
  for f in "$TRAY_PID_FILE" "$WM_PID_FILE" "$XORG_PID_FILE"; do
    [ -f "$f" ] || continue
    pid="$(cat "$f")"
    kill "$pid" 2>/dev/null || true
    i=0
    while kill -0 "$pid" 2>/dev/null; do
      i=$((i + 1))
      [ "$i" -gt 25 ] && { kill -9 "$pid" 2>/dev/null || true; break; }
      sleep 0.2
    done
    rm -f "$f"
  done
  echo "x11-desk: down on :$DISPLAY_NUM"
}

case "${1:-}" in
up) up ;;
check) check ;;
down) down ;;
*) die "usage: x11-desk.sh up|check|down [display-number]" 2 ;;
esac
