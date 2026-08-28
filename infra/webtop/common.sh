#!/usr/bin/env bash
set -euo pipefail

WEBTOP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$WEBTOP_DIR/../.." && pwd)"
export MASTRA_CC_WEBTOP_PROJECT="${MASTRA_CC_WEBTOP_PROJECT:-mcc-webtop-harness}"
export MASTRA_CC_WEBTOP_CONTAINER="${MASTRA_CC_WEBTOP_CONTAINER:-$MASTRA_CC_WEBTOP_PROJECT}"
export MASTRA_CC_WEBTOP_PORT="${MASTRA_CC_WEBTOP_PORT:-13300}"
if test -n "${DOCKER_HOST:-}" && test ! -S "${DOCKER_HOST#unix://}" && test -S /var/run/docker.sock; then
  export DOCKER_HOST=unix:///var/run/docker.sock
else
  export DOCKER_HOST="${DOCKER_HOST:-unix:///var/run/docker.sock}"
fi
COMPOSE=(docker compose -p "$MASTRA_CC_WEBTOP_PROJECT" -f "$WEBTOP_DIR/compose.yml")
SOCKET=/config/.XDG/mastra-cc/daemon.sock
CDP_SOCKET=/config/.XDG/mastra-cc/cdp.sock
DEPLOY=/opt/mastra-cc
PROOF_SENTENCE="${MASTRA_CC_PROOF_SENTENCE:-MASTRA CC SEMANTIC PROOF 2026-08-27}"
PROTECTED_VALUE="${MASTRA_CC_PROTECTED_VALUE:-protected-proof-value}"

container_exec() {
  docker exec "$MASTRA_CC_WEBTOP_CONTAINER" "$@"
}

session_exec() {
  docker exec -u 1000 "$MASTRA_CC_WEBTOP_CONTAINER" bash -lc "export DISPLAY=:1 XDG_RUNTIME_DIR=/config/.XDG; export DBUS_SESSION_BUS_ADDRESS=\$(tr '\\0' '\\n' </proc/\$(pgrep -n plasmashell)/environ | sed -n 's/^DBUS_SESSION_BUS_ADDRESS=//p'); $1"
}

wait_for() {
  local description="$1" attempts="$2" delay="$3"
  shift 3
  for ((i=1; i<=attempts; i++)); do
    if "$@"; then
      printf 'READY: %s (%d/%d)\n' "$description" "$i" "$attempts"
      return 0
    fi
    sleep "$delay"
  done
  printf 'HARNESS: RED - timed out waiting for %s\n' "$description" >&2
  return 1
}

copy_node_if_needed() {
  if container_exec bash -lc 'command -v node >/dev/null'; then return; fi
  local host_node
  host_node="$(command -v node)"
  docker cp "$host_node" "$MASTRA_CC_WEBTOP_CONTAINER:/usr/local/bin/node"
}

copy_built_artifacts() {
  container_exec rm -rf "$DEPLOY"
  container_exec mkdir -p "$DEPLOY/daemon" "$DEPLOY/transport"
  docker cp "$ROOT/daemon/dist/." "$MASTRA_CC_WEBTOP_CONTAINER:$DEPLOY/daemon/"
  docker cp "$ROOT/packages/transport/dist/." "$MASTRA_CC_WEBTOP_CONTAINER:$DEPLOY/transport/"
  docker cp "$WEBTOP_DIR/scenario-client.mjs" "$MASTRA_CC_WEBTOP_CONTAINER:$DEPLOY/scenario-client.mjs"
}
