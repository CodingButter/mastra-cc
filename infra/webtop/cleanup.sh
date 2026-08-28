#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/common.sh"

if docker inspect "$MASTRA_CC_WEBTOP_CONTAINER" >/dev/null 2>&1; then
  container_exec bash -lc 'test -f /tmp/mastra-cc.pid && kill -TERM "$(cat /tmp/mastra-cc.pid)" 2>/dev/null || true; test -f /tmp/mastra-cc-cdp.pid && kill -TERM "$(cat /tmp/mastra-cc-cdp.pid)" 2>/dev/null || true' || true
fi
"${COMPOSE[@]}" down --remove-orphans
printf 'CLEANUP: GREEN\n'
