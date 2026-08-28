#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/common.sh"
OUT="${1:-$ROOT/.mastracode/plans/semantic-observation-and-container-tests.proof/diagnostics}"
mkdir -p "$OUT"
docker inspect "$MASTRA_CC_WEBTOP_CONTAINER" >"$OUT/container.json" 2>/dev/null || true
docker logs --tail 200 "$MASTRA_CC_WEBTOP_CONTAINER" >"$OUT/container.log" 2>&1 || true
container_exec ps aux >"$OUT/processes.txt" 2>&1 || true
container_exec bash -lc 'ls -l /config/.XDG/at-spi /config/.XDG/mastra-cc; cat /tmp/mastra-cc.log' >"$OUT/readiness.txt" 2>&1 || true
if grep -R -F "$PROTECTED_VALUE" "$OUT"; then
  printf 'DIAGNOSTICS: RED - protected value leaked\n' >&2
  exit 1
fi
printf 'DIAGNOSTICS: GREEN %s\n' "$OUT"
