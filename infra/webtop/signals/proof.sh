#!/usr/bin/env bash
# The desk wakes the agent, proven where a desk actually is.
#
# The three publishable packages are packed into tarballs and installed into a
# scratch project OUTSIDE this workspace (and outside pin B5's scanned roots).
# A daemon inside the webtop container drives a real KDE desktop; the host
# cannot see that container's filesystem, so the websocket is the only door.
#
# The mutation that wakes the agent is made FROM THE DESKTOP with xdotool, not
# by a second protocol client: that is what makes the attribution genuinely
# `external` rather than `self`, and it is why no second dial exists here.
#
#   bash infra/webtop/signals/proof.sh
#
# Requires the webtop container from infra/webtop to be up with Kate running,
# and GOOGLE_API_KEY (or MASTRA_CC_MODEL pointing at a model you can resolve).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
export DOCKER_HOST="${DOCKER_HOST:-unix:///var/run/docker.sock}"
test -S "${DOCKER_HOST#unix://}" || export DOCKER_HOST=unix:///var/run/docker.sock
CONTAINER="${MASTRA_CC_WEBTOP_CONTAINER:-mcc-webtop-spike}"
DEPLOY=/opt/mastra-cc
PORT="${MASTRA_CC_WS_PORT:-9977}"
SOCKET=/config/.XDG/mastra-cc/daemon.sock
AUDIT=/tmp/wake-audit.jsonl
SCRATCH="${MASTRA_CC_SCRATCH:-/tmp/wake-the-agent-proof}"

session_exec() {
  docker exec -u 1000 "$CONTAINER" bash -lc \
    "export DISPLAY=:1 XDG_RUNTIME_DIR=/config/.XDG; export DBUS_SESSION_BUS_ADDRESS=\$(tr '\\0' '\\n' </proc/\$(pgrep -n plasmashell)/environ | sed -n 's/^DBUS_SESSION_BUS_ADDRESS=//p'); $1"
}

echo "== packing the publishable packages =="
rm -rf "$SCRATCH" && mkdir -p "$SCRATCH"
(cd "$ROOT" && pnpm --filter @mastra-cc/transport --filter @mastra-cc/desktop build >/dev/null)
for package in protocol-types transport desktop; do
  (cd "$ROOT/packages/$package" && pnpm pack --pack-destination "$SCRATCH" >/dev/null)
done
ls -1 "$SCRATCH"

echo
echo "== installing into a scratch project outside the workspace =="
(cd "$SCRATCH" && npm init -y >/dev/null && npm install ./*.tgz >/dev/null 2>&1)
(cd "$SCRATCH" && npm install @mastra/core@1.63.2 @mastra/memory @mastra/libsql @libsql/client >/dev/null 2>&1)
cp "$HERE/wake-on-change.mjs" "$SCRATCH/agent.mjs"
node -e "console.log('resolved from:', require.resolve('@mastra-cc/desktop/mastra', { paths: ['$SCRATCH'] }))"

echo
echo "== the daemon, with a receipt of every request it serves =="
session_exec "test -f /tmp/mastra-cc.pid && kill \$(cat /tmp/mastra-cc.pid) 2>/dev/null || true; sleep 1; rm -f '$SOCKET' '$AUDIT'; /usr/local/bin/node '$DEPLOY/daemon/main.mjs' --backend atspi --socket '$SOCKET' --grant kate --allow edit --audit '$AUDIT' --ws-host 0.0.0.0 --ws-port $PORT >/tmp/mastra-cc.log 2>&1 & echo \$! >/tmp/mastra-cc.pid"
sleep 3
docker exec "$CONTAINER" bash -lc "grep websocket /tmp/mastra-cc.log"
IP="$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$CONTAINER")"
echo "container address: $IP"

echo
echo "== the agent asks once, then goes quiet =="
rm -f /tmp/wake-proof.db /tmp/wake-proof.log
(cd "$SCRATCH" && MASTRA_CC_WAKE_DB=file:/tmp/wake-proof.db node agent.mjs "ws://$IP:$PORT" >/tmp/wake-proof.log 2>&1) &
AGENT=$!

for _ in $(seq 1 90); do grep -q '^IDLE:' /tmp/wake-proof.log && break; sleep 1; done
grep -q '^IDLE:' /tmp/wake-proof.log || { cat /tmp/wake-proof.log; echo "PROOF: RED - the agent never reached the idle state"; exit 1; }
AUDIT_AT_IDLE="$(docker exec "$CONTAINER" bash -lc "wc -l < $AUDIT" | tr -d ' ')"
echo "audit entries when the agent went quiet: $AUDIT_AT_IDLE"

echo
echo "== a human types into Kate; nothing here opens a socket =="
MUTATION="EXTERNAL EDIT $(date -u +%Y-%m-%dT%H:%M:%SZ)"
session_exec "xdotool search --name 'proof.txt' | tail -1 | xargs -I{} xdotool windowactivate --sync {}; sleep 1; xdotool type --delay 40 ' $MUTATION'"
echo "typed at the desk: $MUTATION"

echo
echo "== how fast the desk actually talks =="
for _ in $(seq 1 60); do grep -q '^OBSERVING:' /tmp/wake-proof.log && break; sleep 1; done
for i in 1 2 3 4 5; do
  session_exec "xdotool type --delay 30 ' burst-$i'" >/dev/null
  sleep 2
done

set +e
wait $AGENT
STATUS=$?
set -e
cat /tmp/wake-proof.log

AUDIT_AFTER="$(docker exec "$CONTAINER" bash -lc "wc -l < $AUDIT" | tr -d ' ')"
echo "audit entries after the wake: $AUDIT_AFTER (daemon-side requests while the agent was quiet: $((AUDIT_AFTER - AUDIT_AT_IDLE)))"
echo "events the desk pushed: $(docker exec "$CONTAINER" bash -lc "grep -c 'atspi-stream' /tmp/mastra-cc.log || true")"

test "$STATUS" -eq 0 || { echo "PROOF: RED - the agent script exited $STATUS"; exit 1; }
echo "PROOF: GREEN"
