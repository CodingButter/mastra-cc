#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/common.sh"
MARKER="semantic-persistence-${MASTRA_CC_PERSISTENCE_ID:-20260828}"
trap 'bash "$WEBTOP_DIR/cleanup.sh" >/dev/null 2>&1 || true' EXIT

bash "$WEBTOP_DIR/start.sh"
container_exec bash -lc "printf '%s\\n' '$MARKER' > /config/workspace/persistence-marker.txt"
container_exec env MASTRA_CC_SOCKET="$SOCKET" MASTRA_CC_PROOF_SENTENCE="$PROOF_SENTENCE" node /opt/mastra-cc/scenario-client.mjs persistence >/dev/null
container_exec grep -Fxq "$PROOF_SENTENCE" /config/workspace/persistence-state.txt
"${COMPOSE[@]}" down --remove-orphans
bash "$WEBTOP_DIR/start.sh"
container_exec grep -Fx "$MARKER" /config/workspace/persistence-marker.txt >/dev/null
container_exec env MASTRA_CC_SOCKET="$SOCKET" MASTRA_CC_PROOF_SENTENCE="$PROOF_SENTENCE" node /opt/mastra-cc/scenario-client.mjs verify-persistence >/dev/null
printf 'PERSISTENCE: GREEN\n'
