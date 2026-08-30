#!/usr/bin/env bash
# The installable package, proven the way a consumer meets it.
#
# The three publishable packages are packed into tarballs and installed into a
# scratch project OUTSIDE this workspace, so nothing resolves back to source.
# A daemon inside the webtop container drives a real KDE desktop; the host
# cannot see that container's filesystem, so the websocket is the only door.
#
#   bash infra/webtop/installable-package/proof.sh
#
# Requires the webtop container from infra/webtop to be up with Kate running.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
export DOCKER_HOST="${DOCKER_HOST:-unix:///var/run/docker.sock}"
test -S "${DOCKER_HOST#unix://}" || export DOCKER_HOST=unix:///var/run/docker.sock
CONTAINER="${MASTRA_CC_WEBTOP_CONTAINER:-mcc-webtop-spike}"
DEPLOY=/opt/mastra-cc
PORT="${MASTRA_CC_WS_PORT:-9977}"
SOCKET=/config/.XDG/mastra-cc/daemon.sock
SCRATCH="${MASTRA_CC_SCRATCH:-/tmp/installable-package-proof}"

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
echo "== installing the tarballs into a scratch project outside the workspace =="
(cd "$SCRATCH" && npm init -y >/dev/null && npm install ./*.tgz >/dev/null 2>&1)
cp "$HERE/drive-the-desktop.mjs" "$SCRATCH/agent.mjs"
node -e "console.log('resolved from:', require.resolve('@mastra-cc/desktop', { paths: ['$SCRATCH'] }))"

echo
echo "== opening the second door on the container's daemon =="
session_exec "test -f /tmp/mastra-cc.pid && kill \$(cat /tmp/mastra-cc.pid) 2>/dev/null || true; sleep 1; rm -f '$SOCKET'; /usr/local/bin/node '$DEPLOY/daemon/main.mjs' --backend atspi --socket '$SOCKET' --grant kate --allow edit --ws-host 0.0.0.0 --ws-port $PORT >/tmp/mastra-cc.log 2>&1 & echo \$! >/tmp/mastra-cc.pid"
sleep 3
docker exec "$CONTAINER" bash -lc "grep websocket /tmp/mastra-cc.log"
IP="$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$CONTAINER")"
echo "container address: $IP"

echo
echo "== the agent process drives the desktop =="
(cd "$SCRATCH" && node agent.mjs "ws://$IP:$PORT")
