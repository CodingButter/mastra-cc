#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/common.sh"
trap 'status=$?; if ! bash "$WEBTOP_DIR/diagnostics.sh" >/dev/null; then status=1; fi; bash "$WEBTOP_DIR/cleanup.sh" >/dev/null 2>&1 || true; exit "$status"' EXIT

bash "$WEBTOP_DIR/start.sh"
semantic="$(container_exec env MASTRA_CC_SOCKET="$SOCKET" MASTRA_CC_PROOF_SENTENCE="$PROOF_SENTENCE" /usr/local/bin/node "$DEPLOY/scenario-client.mjs" semantic)"
printf '%s\n' "$semantic"
subscription="$(container_exec env MASTRA_CC_SOCKET="$SOCKET" MASTRA_CC_PROOF_SENTENCE="$PROOF_SENTENCE ON WATCH" /usr/local/bin/node "$DEPLOY/scenario-client.mjs" subscribe)"
printf '%s\n' "$subscription"
protected="$(container_exec env MASTRA_CC_SOCKET="$CDP_SOCKET" /usr/local/bin/node "$DEPLOY/scenario-client.mjs" protected)"
printf '%s\n' "$protected"

if printf '%s\n' "$protected" | grep -Fq "$PROTECTED_VALUE"; then
  printf 'PROOF: RED - protected value leaked in response\n' >&2
  exit 1
fi
if container_exec grep -R -Fq "$PROTECTED_VALUE" /tmp/mastra-cc.log /tmp/mastra-cc-cdp.log /config/.local/state/mastra-cc 2>/dev/null; then
  printf 'PROOF: RED - protected value leaked in daemon artifacts\n' >&2
  exit 1
fi
printf 'PROOF: GREEN\n'
