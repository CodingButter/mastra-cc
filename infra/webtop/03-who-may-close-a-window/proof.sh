#!/usr/bin/env bash
# Who may close a window, proven where a window is.
#
# Two daemons of the same build, differing only in a configuration file the
# OPERATOR wrote: one that configured nothing, and one that chose "graceful".
# The first refuses and names the setting. The second closes an editor that has
# nothing to lose - and is stopped, by an unsaved-work dialog, from closing one
# that does.
#
# Nothing here plays the human: no xdotool, no wmctrl, no synthetic input. The
# unsaved work is created through setElementText, the same semantic verb any
# agent has, and the dialog that appears is read and left alone.
#
#   bash infra/webtop/03-who-may-close-a-window/proof.sh
#
# Requires the webtop container from infra/webtop to be up.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
. "$ROOT/infra/webtop/common.sh"
CONTAINER="$MASTRA_CC_WEBTOP_CONTAINER"
DEPLOY=/opt/mastra-cc
PORT="${MASTRA_CC_WS_PORT:-9978}"
SOCKET=/config/.XDG/mastra-cc/restart-proof.sock
SCRATCH="${MASTRA_CC_SCRATCH:-/tmp/who-may-close-a-window-proof}"
BASE_TREE="${MASTRA_CC_BASE_TREE:-/tmp/who-may-close-a-window-base}"
BASE_SHA="${MASTRA_CC_BASE_SHA:-29c7afc}"
WITH="$ROOT/docs/proofs/03-who-may-close-a-window-with.txt"
WITHOUT="$ROOT/docs/proofs/03-who-may-close-a-window-without.txt"
export NO_COLOR=1

# session_exec comes from common.sh: it carries the session's own bus address,
# which is how the daemon finds the accessibility layer at all.
# Every editor this proof drives is one it opened itself. A leftover copy from a
# previous run would be a process the daemon does not own, and the restart would
# correctly refuse it - a red for a reason that has nothing to do with the code.
clear_the_desk() {
  # Waited for, not merely asked for: a copy still dying when the next daemon
  # starts is a copy that daemon did not open, and the launch would be refused
  # for a reason this proof is not about.
  # KILL, not TERM: the editor this proof leaves behind has unsaved work and will
  # refuse a polite close - which is the whole point of the run, and would leave
  # the desk dirty for the next one. The harness cleaning up after itself is not
  # the daemon deciding to force anything.
  session_exec "pkill -KILL -x kate; pkill -KILL -x dolphin; for _ in 1 2 3 4 5 6 7 8 9 10; do pgrep -x kate >/dev/null || pgrep -x dolphin >/dev/null || break; sleep 1; done; true" >/dev/null 2>&1 || true
  session_exec "rm -rf /config/.local/share/kate; true" >/dev/null 2>&1 || true
  session_exec "test -f /tmp/restart-proof.pid && kill \$(cat /tmp/restart-proof.pid) 2>/dev/null || true; rm -f '$SOCKET'; true" >/dev/null 2>&1 || true
}
trap clear_the_desk EXIT

# A container can end up with TWO accessibility bus launchers - segment 02's
# proof switches the layer off and on, and a second launcher can be started
# behind it. When that happens, newly launched applications bridge to one bus
# while the registry serves the other, every query comes back empty, and this
# proof would go red for a reason that has nothing to do with restart authority.
# Said out loud, before anything is measured.
launchers="$(docker exec -u 1000 "$CONTAINER" bash -lc 'pgrep -c -f at-spi-bus-launcher' || true)"
test "${launchers:-0}" -eq 1 || {
  echo "HARNESS: RED - $launchers accessibility bus launcher(s) in this container; expected exactly 1."
  echo "The desk is split across two buses and nothing will be readable. Kill the extra one and rerun."
  exit 1
}

pack_into() { # $1 = tree to pack from, $2 = scratch directory
  rm -rf "$2" && mkdir -p "$2"
  (cd "$1" && pnpm --filter @mastra-cc/transport --filter @mastra-cc/desktop build >/dev/null)
  for package in protocol-types transport desktop; do
    (cd "$1/packages/$package" && pnpm pack --pack-destination "$2" >/dev/null)
  done
  (cd "$2" && npm init -y >/dev/null && npm install ./*.tgz >/dev/null 2>&1)
  cp "$HERE/who-may-close-a-window.mjs" "$2/agent.mjs"
}

# The only place a level that ACTS can come from. Written to the container by
# this script standing in for the operator; no input the agent sends reaches it.
write_capabilities() { # $1 = json body, or "" for no file at all
  docker exec "$CONTAINER" rm -f "$DEPLOY/restart-proof-capabilities.json"
  if [ -n "$1" ]; then
    printf '%s' "$1" | docker exec -i "$CONTAINER" tee "$DEPLOY/restart-proof-capabilities.json" >/dev/null
  fi
}

start_daemon_from() { # $1 = host path to a built daemon dist, $2 = capabilities json or ""
  clear_the_desk
  docker exec "$CONTAINER" rm -rf "$DEPLOY/daemon-restart-proof"
  docker cp "$1/." "$CONTAINER:$DEPLOY/daemon-restart-proof"
  write_capabilities "$2"
  local capabilities=""
  [ -n "$2" ] && capabilities="--capabilities $DEPLOY/restart-proof-capabilities.json"
  session_exec "/usr/local/bin/node '$DEPLOY/daemon-restart-proof/main.mjs' --backend atspi --socket '$SOCKET' --grant '*' --permit org.kde.kate --permit org.kde.dolphin --allow edit --allow activate --ws-host 0.0.0.0 --ws-port $PORT $capabilities >/tmp/restart-proof.log 2>&1 & echo \$! >/tmp/restart-proof.pid"
  for _ in $(seq 1 60); do
    docker exec "$CONTAINER" bash -lc "grep -q websocket /tmp/restart-proof.log" 2>/dev/null && break
    sleep 0.5
  done
  docker exec "$CONTAINER" bash -lc "grep websocket /tmp/restart-proof.log"
}

GRACEFUL='{"restart":{"default":"refuse","applications":{"org.kde.kate":"graceful","org.kde.dolphin":"graceful"}}}'

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
echo "== RED: the operator's choice against the base daemon ($BASE_SHA) =="
# The base daemon is not given the capabilities file, because it CANNOT BE: it
# rejects the operator's restart block as an unknown key and refuses to start at
# all. That is itself the gap - on this commit there is no way to say who may
# close a window - so the red side runs the only way the base can run, and fails
# for the honest reason that no restart route exists.
echo 'the base daemon rejects the operator restart block outright:' | tee "$WITHOUT"
docker exec "$CONTAINER" rm -rf "$DEPLOY/daemon-restart-base" >/dev/null
docker cp "$BASE_TREE/daemon/dist/." "$CONTAINER:$DEPLOY/daemon-restart-base" >/dev/null
write_capabilities "$GRACEFUL"
session_exec "/usr/local/bin/node '$DEPLOY/daemon-restart-base/main.mjs' --backend atspi --socket /tmp/base-reject.sock --grant '*' --capabilities $DEPLOY/restart-proof-capabilities.json 2>&1 | head -2" 2>&1 | tee -a "$WITHOUT" || true
start_daemon_from "$BASE_TREE/daemon/dist" "" | tee -a "$WITHOUT"
set +e
(cd "$SCRATCH-base" && node agent.mjs "ws://$IP:$PORT" acts 2>&1) | tee -a "$WITHOUT"
BASE_STATUS=${PIPESTATUS[0]}
set -e
test "$BASE_STATUS" -ne 0 || { echo "PROOF: RED - the base daemon restarted an application; the demo proves nothing"; exit 1; }
echo "base daemon exited $BASE_STATUS, as it must" | tee -a "$WITHOUT"

echo
echo "== GREEN, part 1: this branch, with nothing configured =="
start_daemon_from "$ROOT/daemon/dist" "" | tee "$WITH"
set +e
(cd "$SCRATCH" && node agent.mjs "ws://$IP:$PORT" refuses 2>&1) | tee -a "$WITH"
REFUSES_STATUS=${PIPESTATUS[0]}
set -e
test "$REFUSES_STATUS" -eq 0 || { echo "PROOF: RED - the default did not refuse" | tee -a "$WITH"; exit 1; }

echo
echo "== GREEN, part 2: this branch, with the operator's graceful level ==" | tee -a "$WITH"
start_daemon_from "$ROOT/daemon/dist" "$GRACEFUL" | tee -a "$WITH"
set +e
(cd "$SCRATCH" && node agent.mjs "ws://$IP:$PORT" acts 2>&1) | tee -a "$WITH"
STATUS=${PIPESTATUS[0]}
set -e

echo
echo "transcripts: $WITHOUT (base $BASE_SHA) and $WITH"
test "$STATUS" -eq 0 || { echo "PROOF: RED - the configured restart did not behave"; exit 1; }
echo "PROOF: GREEN"
