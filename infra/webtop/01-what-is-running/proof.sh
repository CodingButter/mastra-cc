#!/usr/bin/env bash
# The desk says whether an application is ALREADY open, proven where a desk is.
#
# The publishable packages are packed into tarballs and installed into scratch
# projects OUTSIDE this workspace - one per side, because this change moves the
# schema (1.6.1 -> 1.7.0) and a client packed from this branch would be refused
# at the base daemon's handshake on the digest. Each side therefore runs the
# client its own commit ships, which is also the honest comparison: what could
# an agent do with the released thing, then and now.
#
# Nothing here plays the human: no xdotool, no wmctrl, no synthetic input. The
# setup is "the editor is not running", which needs no keyboard - the harness
# closes it and gets out of the way, and the AGENT opens it.
#
#   bash infra/webtop/01-what-is-running/proof.sh
#
# Requires the webtop container from infra/webtop to be up, and GOOGLE_API_KEY
# (or MASTRA_CC_MODEL pointing at a model you can resolve).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
. "$ROOT/infra/webtop/common.sh"
CONTAINER="$MASTRA_CC_WEBTOP_CONTAINER"
DEPLOY=/opt/mastra-cc
PORT="${MASTRA_CC_WS_PORT:-9978}"
SOCKET=/config/.XDG/mastra-cc/running-proof.sock
SCRATCH="${MASTRA_CC_SCRATCH:-/tmp/what-is-running-proof}"
BASE_TREE="${MASTRA_CC_BASE_TREE:-/tmp/what-is-running-base}"
BASE_SHA="${MASTRA_CC_BASE_SHA:-f2cf93c}"
WITH="$ROOT/docs/proofs/01-what-is-running-with.txt"
WITHOUT="$ROOT/docs/proofs/01-what-is-running-without.txt"
export NO_COLOR=1

session_exec() {
  docker exec -u 1000 "$CONTAINER" bash -lc \
    "export DISPLAY=:1 XDG_RUNTIME_DIR=/config/.XDG; export DBUS_SESSION_BUS_ADDRESS=\$(tr '\\0' '\\n' </proc/\$(pgrep -n plasmashell)/environ | sed -n 's/^DBUS_SESSION_BUS_ADDRESS=//p'); $1"
}

close_the_desk() {
  # The application the agent is asked about must not be running, or the first
  # answer is true by accident. Exact process name only - a loose pattern once
  # matched the daemon's own argv. SIGKILL, because an editor holding an unsaved
  # buffer answers SIGTERM by putting up a save dialog and staying put.
  docker exec -u 1000 "$CONTAINER" bash -lc "pkill -KILL -x kate; true" >/dev/null 2>&1 || true
  # A killed Kate leaves session state behind and the next launch comes up as a
  # session chooser, which is a different window with a different name.
  docker exec -u 1000 "$CONTAINER" bash -lc "rm -rf /config/.local/share/kate/sessions; true" >/dev/null 2>&1 || true
  sleep 3
  docker exec -u 1000 "$CONTAINER" bash -lc "pgrep -x kate || true"
}

pack_into() { # $1 = tree to pack from, $2 = scratch directory
  rm -rf "$2" && mkdir -p "$2"
  (cd "$1" && pnpm --filter @mastra-cc/transport --filter @mastra-cc/desktop build >/dev/null)
  for package in protocol-types transport desktop; do
    (cd "$1/packages/$package" && pnpm pack --pack-destination "$2" >/dev/null)
  done
  (cd "$2" && npm init -y >/dev/null && npm install ./*.tgz >/dev/null 2>&1)
  (cd "$2" && npm install @mastra/core@1.63.2 >/dev/null 2>&1)
  cp "$HERE/is-it-already-open.mjs" "$2/agent.mjs"
}

start_daemon_from() { # $1 = host path to a built daemon dist
  session_exec "test -f /tmp/running-proof.pid && kill \$(cat /tmp/running-proof.pid) 2>/dev/null || true; rm -f '$SOCKET'; true" >/dev/null 2>&1 || true
  docker exec "$CONTAINER" rm -rf "$DEPLOY/daemon-running-proof"
  docker cp "$1/." "$CONTAINER:$DEPLOY/daemon-running-proof"
  # Equal eyes on both sides: the same grant and the same permit, so the only
  # difference between the two runs is the daemon. Without the grant the branch
  # would answer cannot-tell and the run would measure blindness instead.
  session_exec "/usr/local/bin/node '$DEPLOY/daemon-running-proof/main.mjs' --backend atspi --socket '$SOCKET' --permit org.kde.kate --grant kate --ws-host 0.0.0.0 --ws-port $PORT >/tmp/running-proof.log 2>&1 & echo \$! >/tmp/running-proof.pid"
  for _ in $(seq 1 60); do
    docker exec "$CONTAINER" bash -lc "grep -q websocket /tmp/running-proof.log" 2>/dev/null && break
    sleep 0.5
  done
  docker exec "$CONTAINER" bash -lc "grep websocket /tmp/running-proof.log"
}

echo "== building the base tree, for the red side =="
if [ ! -d "$BASE_TREE" ]; then
  (cd "$ROOT" && git worktree add "$BASE_TREE" "$BASE_SHA" >/dev/null)
fi
# packages/protocol-types is generated, not committed, so a fresh worktree has
# to emit it from its own schema before anything can install or build.
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
echo "== RED: the same errand against the base daemon ($BASE_SHA) =="
close_the_desk
start_daemon_from "$BASE_TREE/daemon/dist" | tee "$WITHOUT"
set +e
(cd "$SCRATCH-base" && node agent.mjs "ws://$IP:$PORT" 2>&1) | tee -a "$WITHOUT"
BASE_STATUS=${PIPESTATUS[0]}
set -e
test "$BASE_STATUS" -ne 0 || { echo "PROOF: RED - the base daemon answered the question; the demo proves nothing"; exit 1; }
echo "base daemon exited $BASE_STATUS, as it must" | tee -a "$WITHOUT"

echo
echo "== GREEN: the same errand against this branch =="
close_the_desk
start_daemon_from "$ROOT/daemon/dist" | tee "$WITH"
set +e
(cd "$SCRATCH" && node agent.mjs "ws://$IP:$PORT" 2>&1) | tee -a "$WITH"
STATUS=${PIPESTATUS[0]}
set -e

session_exec "test -f /tmp/running-proof.pid && kill \$(cat /tmp/running-proof.pid) 2>/dev/null || true; true" >/dev/null 2>&1 || true
echo
echo "transcripts: $WITHOUT (base $BASE_SHA) and $WITH"
test "$STATUS" -eq 0 || { echo "PROOF: RED - the agent script exited $STATUS"; exit 1; }
echo "PROOF: GREEN"
