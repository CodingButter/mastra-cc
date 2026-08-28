#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/common.sh"
MARKER="semantic-persistence-${MASTRA_CC_PERSISTENCE_ID:-20260827}"
trap 'bash "$WEBTOP_DIR/cleanup.sh" >/dev/null 2>&1 || true' EXIT

bash "$WEBTOP_DIR/start.sh"
container_exec bash -lc "printf '%s\\n' '$MARKER' > /config/workspace/persistence-marker.txt; mkdir -p /config/.chromium-proof/Default; printf '%s\\n' '$MARKER' > /config/.chromium-proof/Default/persistence-state.txt"
"${COMPOSE[@]}" down --remove-orphans
"${COMPOSE[@]}" up -d --remove-orphans
container_running() { test "$(docker inspect -f '{{.State.Running}}' "$MASTRA_CC_WEBTOP_CONTAINER" 2>/dev/null)" = true; }
wait_for 'recreated container' 45 2 container_running
container_exec grep -Fx "$MARKER" /config/workspace/persistence-marker.txt >/dev/null
container_exec grep -Fx "$MARKER" /config/.chromium-proof/Default/persistence-state.txt >/dev/null
printf 'PERSISTENCE: GREEN\n'
