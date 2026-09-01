#!/usr/bin/env bash
# An agent starts the applications it needs, proven where a desk actually is.
#
# The publishable packages are packed into tarballs and installed into a scratch
# project OUTSIDE this workspace. A daemon inside the webtop container drives a
# real KDE desktop; the host cannot see that container's filesystem, so the
# websocket is the only door.
#
# Nothing here plays the human: no xdotool, no wmctrl, no synthetic input. The
# whole point is that the AGENT opens the applications, so the harness only
# closes them first and then gets out of the way.
#
#   bash infra/webtop/generic-launch/proof.sh
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
SOCKET=/config/.XDG/mastra-cc/launch-proof.sock
SCRATCH="${MASTRA_CC_SCRATCH:-/tmp/any-app-proof}"
BASE_TREE="${MASTRA_CC_BASE_TREE:-/tmp/generic-launch-base}"
BASE_SHA="${MASTRA_CC_BASE_SHA:-7ae05a681a600b2de4001185e00300f9ebbf1df0}"
WITH=/tmp/any-app-with.txt
WITHOUT=/tmp/any-app-without.txt
export NO_COLOR=1

session_exec() {
  docker exec -u 1000 "$CONTAINER" bash -lc \
    "export DISPLAY=:1 XDG_RUNTIME_DIR=/config/.XDG; export DBUS_SESSION_BUS_ADDRESS=\$(tr '\\0' '\\n' </proc/\$(pgrep -n plasmashell)/environ | sed -n 's/^DBUS_SESSION_BUS_ADDRESS=//p'); $1"
}

close_the_desk() {
  # The applications the agent is asked to open must not be running. Exact
  # process names only - a loose pattern once matched the daemon's own argv.
  # SIGKILL, because an editor holding an unsaved buffer answers SIGTERM by
  # putting up a save dialog and staying exactly where it is.
  docker exec -u 1000 "$CONTAINER" bash -lc \
    "pkill -KILL -x kate; pkill -KILL -x dolphin; pkill -KILL -x chromium; pkill -KILL -x mousepad; true" >/dev/null 2>&1 || true
  sleep 3
  docker exec -u 1000 "$CONTAINER" bash -lc "pgrep -x kate || pgrep -x mousepad || true"
}

start_daemon_from() { # $1 = host path to a built daemon dist
  session_exec "test -f /tmp/launch-proof.pid && kill \$(cat /tmp/launch-proof.pid) 2>/dev/null || true; rm -f '$SOCKET'; true" >/dev/null 2>&1 || true
  docker exec "$CONTAINER" rm -rf "$DEPLOY/daemon-proof"
  docker cp "$1/." "$CONTAINER:$DEPLOY/daemon-proof"
  # The tree names are granted explicitly on BOTH sides. On this branch a permit
  # already implies them through appearsAs; on base it does not, and an empty
  # window list there would then be an artefact of blindness rather than a
  # statement about what is running. Equal eyes, different daemon - that is the
  # only difference the two runs are allowed to have.
  local started
  started="$(date +%s.%N)"
  session_exec "/usr/local/bin/node '$DEPLOY/daemon-proof/main.mjs' --backend atspi --socket '$SOCKET' --permit org.kde.kate --permit org.xfce.mousepad --permit chromium --grant kate --grant mousepad --grant chromium --ws-host 0.0.0.0 --ws-port $PORT >/tmp/launch-proof.log 2>&1 & echo \$! >/tmp/launch-proof.pid"
  for _ in $(seq 1 60); do
    docker exec "$CONTAINER" bash -lc "grep -q websocket /tmp/launch-proof.log" 2>/dev/null && break
    sleep 0.5
  done
  docker exec "$CONTAINER" bash -lc "grep websocket /tmp/launch-proof.log"
  echo "daemon ready after $(echo "$(date +%s.%N) - $started" | bc)s"
}

echo "== packing the publishable packages =="
rm -rf "$SCRATCH" && mkdir -p "$SCRATCH"
(cd "$ROOT" && pnpm --filter @mastra-cc/transport --filter @mastra-cc/desktop build >/dev/null)
for package in protocol-types transport desktop; do
  (cd "$ROOT/packages/$package" && pnpm pack --pack-destination "$SCRATCH" >/dev/null)
done
(cd "$SCRATCH" && npm init -y >/dev/null && npm install ./*.tgz >/dev/null 2>&1)
(cd "$SCRATCH" && npm install @mastra/core@1.63.2 >/dev/null 2>&1)
cp "$HERE/launch-anything.mjs" "$SCRATCH/agent.mjs"
node -e "console.log('resolved from:', require.resolve('@mastra-cc/desktop/mastra', { paths: ['$SCRATCH'] }))"

echo
echo "== building this branch's daemon =="
(cd "$ROOT" && pnpm --filter @mastra-cc/daemon build >/dev/null)

echo
echo "== building the base daemon, for the red side =="
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

IP="$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$CONTAINER")"
echo "container address: $IP"

echo
echo "== RED: the same errand against the base daemon =="
close_the_desk
start_daemon_from "$BASE_TREE/daemon/dist" | tee "$WITHOUT"
set +e
(cd "$SCRATCH" && node agent.mjs "ws://$IP:$PORT" 2>&1) | tee -a "$WITHOUT"
BASE_STATUS=${PIPESTATUS[0]}
set -e
test "$BASE_STATUS" -ne 0 || { echo "PROOF: RED - the base daemon opened the applications; the demo proves nothing"; exit 1; }
echo "base daemon exited $BASE_STATUS, as it must" | tee -a "$WITHOUT"

echo
echo "== GREEN: the same errand against this branch =="
close_the_desk
start_daemon_from "$ROOT/daemon/dist" | tee "$WITH"
set +e
(cd "$SCRATCH" && node agent.mjs "ws://$IP:$PORT" 2>&1) | tee -a "$WITH"
STATUS=${PIPESTATUS[0]}
set -e

session_exec "test -f /tmp/launch-proof.pid && kill \$(cat /tmp/launch-proof.pid) 2>/dev/null || true; true" >/dev/null 2>&1 || true
echo
echo "transcripts: $WITHOUT (base $BASE_SHA) and $WITH"
test "$STATUS" -eq 0 || { echo "PROOF: RED - the agent script exited $STATUS"; exit 1; }
echo "PROOF: GREEN"
