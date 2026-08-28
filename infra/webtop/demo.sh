#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/common.sh"
trap 'bash "$WEBTOP_DIR/diagnostics.sh" >/dev/null 2>&1 || true; bash "$WEBTOP_DIR/cleanup.sh" >/dev/null 2>&1 || true' EXIT

bash "$WEBTOP_DIR/start.sh"
semantic="$(container_exec env MASTRA_CC_SOCKET="$SOCKET" MASTRA_CC_PROOF_SENTENCE="$PROOF_SENTENCE" /usr/local/bin/node "$DEPLOY/scenario-client.mjs" semantic)"
printf '%s\n' "$semantic"
protected="$(container_exec env MASTRA_CC_SOCKET="$CDP_SOCKET" /usr/local/bin/node "$DEPLOY/scenario-client.mjs" protected)"
printf '%s\n' "$protected"

if printf '%s\n' "$protected" | grep -F "$PROTECTED_VALUE"; then
  printf 'PROOF: RED - protected value leaked in response\n' >&2
  exit 1
fi
if container_exec grep -R -F "$PROTECTED_VALUE" /tmp/mastra-cc.log /tmp/mastra-cc-cdp.log /config/.local/state/mastra-cc 2>/dev/null; then
  printf 'PROOF: RED - protected value leaked in daemon artifacts\n' >&2
  exit 1
fi
printf 'PROOF: GREEN\n'
