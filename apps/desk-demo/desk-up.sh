#!/usr/bin/env bash
set -euo pipefail

# Put a daemon on the Webtop desk and point this app at it.
#
# The demo needs three things running: the desktop container (infra/webtop), a
# daemon inside it holding the accessibility bus, and this Next app on the host.
# This script does the middle one and writes .env.local for the third.
#
# The daemon runs INSIDE the container because it is the only accessibility
# consumer and the bus lives there. The app reaches it over the websocket door at
# the container's own address - the same route every proof in this repository
# uses, rather than publishing another port.
#
# NOTHING HERE SYNTHESISES INPUT. The desk is driven by the agent through the
# protocol, and by the person through the noVNC session in their browser. Those
# are the only two actors, which is the whole point of the demo.

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"

# The demo gets its OWN desk, on its own volumes and its own port. The proof
# harness's desktop is a workshop floor - half-open editors, a password page, a
# persistence dialog, whatever the last run left standing - and a demo that
# opens onto someone else's mess cannot show an agent arriving at a machine.
# Compose names volumes after the project, so a different project name is a
# different, empty /config, and nothing here can disturb the harness.
export MASTRA_CC_WEBTOP_PROJECT="${MASTRA_CC_WEBTOP_PROJECT:-mcc-desk-demo}"
export MASTRA_CC_WEBTOP_PORT="${MASTRA_CC_WEBTOP_PORT:-13320}"
. "$ROOT/infra/webtop/common.sh"

CONTAINER="$MASTRA_CC_WEBTOP_CONTAINER"
PORT="${MASTRA_CC_WS_PORT:-9979}"
DEMO_SOCKET=/config/.XDG/mastra-cc/desk-demo.sock

# --fresh throws the desk away and builds a new one: new volumes, no history,
# no saved session. Without it the container is reused and only the WINDOWS are
# cleared, which is the difference between a tidy desk and a new one.
FRESH=no
for arg in "$@"; do
  case "$arg" in
    --fresh) FRESH=yes ;;
    *) echo "unknown argument: $arg (only --fresh)" >&2; exit 2 ;;
  esac
done

echo "== the desk: $CONTAINER on 127.0.0.1:$MASTRA_CC_WEBTOP_PORT =="
if test "$FRESH" = yes; then
  "${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
fi
"${COMPOSE[@]}" up -d --remove-orphans >/dev/null
container_running() { test "$(docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null)" = true; }
wait_for 'container health' 45 2 container_running
wait_for 'desktop display' 60 2 container_exec test -S /tmp/.X11-unix/X1
wait_for 'AT-SPI accessibility bus' 60 2 container_exec test -S /config/.XDG/at-spi/bus_1

# A clean slate on EVERY start, fresh volumes or not. KDE restores the session
# it was killed in, and an agent that arrives to find three windows already
# open is being handed someone else's context. Only windowed applications go:
# the shell, the panel and the bus are the desk itself.
#
# This closes windows the way a person leaving for the day would - it is the
# operator's own machine, before any agent is connected. Nothing here drives
# the desktop on an agent's behalf, which is the daemon's job and is refused
# unless configured (see the authority list below).
session_exec 'for app in kate dolphin konsole galculator chromium firefox mousepad systemsettings yad; do pkill -x "$app" 2>/dev/null || true; done; sleep 1; for app in kate dolphin galculator; do pkill -9 -x "$app" 2>/dev/null || true; done; rm -rf /config/.local/share/kate/anonymous.katesession /config/.config/session /config/.config/ksmserverrc; true' >/dev/null 2>&1 || true

# What this desk lets the agent do, stated in one place so a viewer can read the
# demo's authority off the screen rather than guessing it. Everything absent from
# these lists is refused by the daemon, and a refusal is part of the demo.
#
# By default this is EVERY application the desktop actually has, derived from the
# machine's own freedesktop entries rather than a list someone typed. That is a
# deliberate demo posture, not a doctrine change: the daemon still denies by
# default and still has no wildcard: each name below is stated to it one at a
# time, and a name the machine does not have is a name the agent cannot use. An
# operator who wants the narrow version sets DESK_DEMO_APPS to a space-separated
# list and gets exactly that.
#
# Two names per entry: the identifier the desktop file is called by, and its last
# dot-segment, which is usually what the application answers to on the
# accessibility bus. plasmashell is added by hand because the desktop shell
# itself ships no launcher entry and is the thing an agent looks at first.
mapfile -t ENTRY_NAMES < <(
  if test -n "${DESK_DEMO_APPS:-}"; then
    printf '%s\n' $DESK_DEMO_APPS
  else
    container_exec bash -lc \
      'ls /usr/share/applications/*.desktop 2>/dev/null | xargs -n1 basename | sed "s/\.desktop$//"'
  fi
)
PERMITS=()
GRANTS=(plasmashell)
for entry in "${ENTRY_NAMES[@]}"; do
  PERMITS+=("$entry")
  GRANTS+=("$entry")
  short="${entry##*.}"
  if test "$short" != "$entry"; then
    PERMITS+=("$short")
    GRANTS+=("$short")
  fi
done
# Effect classes this session may perform. rawInput is DELIBERATELY absent: it is
# off unless a person turns it on, and a demo that armed it by default would be
# demonstrating the opposite of ADR-0046. Add --allow rawInput here on purpose.
ALLOWS=(edit activate submit)

echo "== authority: ${#ENTRY_NAMES[@]} application(s), effects: ${ALLOWS[*]} =="
echo "== building the daemon =="
(cd "$ROOT" && pnpm --filter @mastra-cc/daemon build >/dev/null)

echo "== deploying it into $CONTAINER =="
copy_node_if_needed
session_exec "test -f /tmp/desk-demo.pid && kill \$(cat /tmp/desk-demo.pid) 2>/dev/null || true; rm -f '$DEMO_SOCKET'; true" >/dev/null 2>&1 || true
container_exec rm -rf "$DEPLOY/desk-demo"
container_exec mkdir -p "$DEPLOY"
docker cp "$ROOT/daemon/dist/." "$CONTAINER:$DEPLOY/desk-demo"

ARGS="--backend atspi --socket '$DEMO_SOCKET' --ws-host 0.0.0.0 --ws-port $PORT"
for name in "${PERMITS[@]}"; do ARGS="$ARGS --permit $name"; done
for name in "${GRANTS[@]}"; do ARGS="$ARGS --grant $name"; done
for name in "${ALLOWS[@]}"; do ARGS="$ARGS --allow $name"; done

echo "== starting the daemon =="
session_exec "/usr/local/bin/node '$DEPLOY/desk-demo/main.mjs' $ARGS >/tmp/desk-demo.log 2>&1 & echo \$! >/tmp/desk-demo.pid"
for _ in $(seq 1 60); do
  container_exec bash -lc "grep -q websocket /tmp/desk-demo.log" 2>/dev/null && break
  sleep 0.5
done
container_exec bash -lc "grep websocket /tmp/desk-demo.log" || {
  echo "the daemon did not open its door; its log follows" >&2
  container_exec bash -lc "cat /tmp/desk-demo.log" >&2
  exit 1
}

IP="$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$CONTAINER")"
cat >"$HERE/.env.local" <<ENV
# Written by desk-up.sh. The container's address changes when it is recreated.
MASTRA_CC_URL=ws://$IP:$PORT
NEXT_PUBLIC_DESKTOP_URL=http://127.0.0.1:$MASTRA_CC_WEBTOP_PORT
ENV

echo
echo "desk:    ws://$IP:$PORT"
echo "desktop: http://127.0.0.1:$MASTRA_CC_WEBTOP_PORT"
echo "wrote    apps/desk-demo/.env.local"
echo
echo "now: GOOGLE_API_KEY=... pnpm --filter @mastra-cc/desk-demo dev"
echo "     (--fresh on this script throws the desk away and builds a new one)"
