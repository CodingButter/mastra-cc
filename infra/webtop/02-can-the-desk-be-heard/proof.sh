#!/usr/bin/env bash
# The desk says whether it can be heard, proven where a desk is.
#
# The setup deafens a real machine: the container's accessibility layer is
# switched off over its own session bus before either daemon starts. That is a
# state the daemon has to REPORT, and on the base commit it cannot - so the base
# side answers with an empty desktop and no explanation, which is the false
# belief this segment ends.
#
# Nothing here plays the human: no xdotool, no wmctrl, no synthetic input. The
# only setup is a bus property, which is the operator's switch, not a keyboard.
#
#   bash infra/webtop/02-can-the-desk-be-heard/proof.sh
#
# Requires the webtop container from infra/webtop to be up, and GOOGLE_API_KEY
# (or MASTRA_CC_MODEL pointing at a model you can resolve).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
. "$ROOT/infra/webtop/common.sh"
CONTAINER="$MASTRA_CC_WEBTOP_CONTAINER"
DEPLOY=/opt/mastra-cc
PORT="${MASTRA_CC_WS_PORT:-9979}"
SOCKET=/config/.XDG/mastra-cc/deaf-proof.sock
SCRATCH="${MASTRA_CC_SCRATCH:-/tmp/can-the-desk-be-heard-proof}"
BASE_TREE="${MASTRA_CC_BASE_TREE:-/tmp/can-the-desk-be-heard-base}"
BASE_SHA="${MASTRA_CC_BASE_SHA:-6055f1a}"
WITH="$ROOT/docs/proofs/02-can-the-desk-be-heard-with.txt"
WITHOUT="$ROOT/docs/proofs/02-can-the-desk-be-heard-without.txt"
export NO_COLOR=1

session_exec() {
  docker exec -u 1000 "$CONTAINER" bash -lc \
    "export DISPLAY=:1 XDG_RUNTIME_DIR=/config/.XDG; export DBUS_SESSION_BUS_ADDRESS=\$(tr '\\0' '\\n' </proc/\$(pgrep -n plasmashell)/environ | sed -n 's/^DBUS_SESSION_BUS_ADDRESS=//p'); $1"
}

# plasmashell's environ carries no bus address in this image, and this session
# has MORE THAN ONE bus, each with its own accessibility status object. The
# daemon picks whichever bus its own environment points at, so deafening one and
# measuring the other would report a machine that was never switched off - which
# is exactly what the first run of this proof did. Every status object that
# answers is therefore switched together.
a11y_buses() {
  docker exec -u 1000 "$CONTAINER" bash -c '
    for s in /tmp/dbus-*; do
      if DBUS_SESSION_BUS_ADDRESS=unix:path=$s busctl --user get-property \
        org.a11y.Bus /org/a11y/bus org.a11y.Status IsEnabled >/dev/null 2>&1; then echo "unix:path=$s"; fi
    done'
}
BUSES="$(a11y_buses)"
test -n "$BUSES" || { echo "no accessibility status object answered - nothing to switch"; exit 1; }
echo "accessibility status buses:"; echo "$BUSES"

a11y() { # $1 = get | true | false - applied to every bus that answers
  for bus in $BUSES; do
    case "$1" in
      get) docker exec -u 1000 -e DBUS_SESSION_BUS_ADDRESS="$bus" "$CONTAINER" \
             busctl --user get-property org.a11y.Bus /org/a11y/bus org.a11y.Status IsEnabled ;;
      *) docker exec -u 1000 -e DBUS_SESSION_BUS_ADDRESS="$bus" "$CONTAINER" \
           busctl --user set-property org.a11y.Bus /org/a11y/bus org.a11y.Status IsEnabled b "$1" ;;
    esac
  done
}

# The trap installs BEFORE the first switch-off and never after: this proof
# deafens a container that later segments also drive, and a crash between the
# switch-off and a trailing restore would leave the shared harness deaf, failing
# the next segment's proof for a reason that has nothing to do with its code.
restore_the_desk() {
  a11y true >/dev/null 2>&1 || true
  session_exec "test -f /tmp/deaf-proof.pid && kill \$(cat /tmp/deaf-proof.pid) 2>/dev/null || true; true" >/dev/null 2>&1 || true
}
trap restore_the_desk EXIT

deafen() {
  a11y false >/dev/null
  sleep 2
  echo "IsEnabled after the switch-off: $(a11y get | tr '\n' ' ')"
}

pack_into() { # $1 = tree to pack from, $2 = scratch directory
  rm -rf "$2" && mkdir -p "$2"
  (cd "$1" && pnpm --filter @mastra-cc/transport --filter @mastra-cc/desktop build >/dev/null)
  for package in protocol-types transport desktop; do
    (cd "$1/packages/$package" && pnpm pack --pack-destination "$2" >/dev/null)
  done
  (cd "$2" && npm init -y >/dev/null && npm install ./*.tgz >/dev/null 2>&1)
  (cd "$2" && npm install @mastra/core@1.63.2 >/dev/null 2>&1)
  cp "$HERE/is-the-desk-deaf.mjs" "$2/agent.mjs"
}

start_daemon_from() { # $1 = host path to a built daemon dist, $2 = extra flags
  session_exec "test -f /tmp/deaf-proof.pid && kill \$(cat /tmp/deaf-proof.pid) 2>/dev/null || true; rm -f '$SOCKET'; true" >/dev/null 2>&1 || true
  docker exec "$CONTAINER" rm -rf "$DEPLOY/daemon-deaf-proof"
  docker cp "$1/." "$CONTAINER:$DEPLOY/daemon-deaf-proof"
  # Equal eyes on both sides. The acquire flag is the OPERATOR's, given here at
  # the command line; no input the agent can send reaches it.
  session_exec "/usr/local/bin/node '$DEPLOY/daemon-deaf-proof/main.mjs' --backend atspi --socket '$SOCKET' --grant '*' --ws-host 0.0.0.0 --ws-port $PORT ${2:-} >/tmp/deaf-proof.log 2>&1 & echo \$! >/tmp/deaf-proof.pid"
  for _ in $(seq 1 60); do
    docker exec "$CONTAINER" bash -lc "grep -q websocket /tmp/deaf-proof.log" 2>/dev/null && break
    sleep 0.5
  done
  docker exec "$CONTAINER" bash -lc "grep websocket /tmp/deaf-proof.log"
}

echo "== building the base tree, for the red side =="
if [ ! -d "$BASE_TREE" ]; then
  (cd "$ROOT" && git worktree add "$BASE_TREE" "$BASE_SHA" >/dev/null)
fi
(cd "$BASE_TREE" \
  && node protocol/generate.mjs --schema protocol/schema.json --out packages/protocol-types >/dev/null \
  && pnpm install --no-frozen-lockfile >/dev/null 2>&1 \
  && pnpm --filter @mastra-cc/protocol-types build >/dev/null 2>&1 \
  && pnpm --filter @mastra-cc/daemon build >/dev/null)

echo "== packing each side's own published packages =="
pack_into "$BASE_TREE" "$SCRATCH-base"
(cd "$ROOT" && pnpm --filter @mastra-cc/daemon build >/dev/null)
pack_into "$ROOT" "$SCRATCH"

IP="$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$CONTAINER")"
echo "container address: $IP"

echo
echo "== RED: the same deaf desk against the base daemon ($BASE_SHA) =="
deafen | tee "$WITHOUT"
start_daemon_from "$BASE_TREE/daemon/dist" | tee -a "$WITHOUT"
set +e
(cd "$SCRATCH-base" && node agent.mjs "ws://$IP:$PORT" 2>&1) | tee -a "$WITHOUT"
BASE_STATUS=${PIPESTATUS[0]}
set -e
test "$BASE_STATUS" -ne 0 || { echo "PROOF: RED - the base daemon explained the silence; the demo proves nothing"; exit 1; }
echo "base daemon exited $BASE_STATUS, as it must" | tee -a "$WITHOUT"

echo
echo "== GREEN: the same deaf desk against this branch =="
a11y true >/dev/null; sleep 1
deafen | tee "$WITH"
start_daemon_from "$ROOT/daemon/dist" --acquire-accessibility | tee -a "$WITH"
set +e
(cd "$SCRATCH" && node agent.mjs "ws://$IP:$PORT" 2>&1) | tee -a "$WITH"
STATUS=${PIPESTATUS[0]}
set -e

echo
echo "transcripts: $WITHOUT (base $BASE_SHA) and $WITH"
# Into the transcript, not just this terminal: a reader checking that the
# shared harness was handed back hearing should not have to trust a scrollback
# that is gone by the time they read the committed file.
echo "IsEnabled after the run, before the restoring trap: $(a11y get | tr '\n' ' ')" | tee -a "$WITH"
test "$STATUS" -eq 0 || { echo "PROOF: RED - the branch did not report the deaf desk"; exit 1; }
echo "PROOF: GREEN"
