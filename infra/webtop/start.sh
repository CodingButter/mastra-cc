#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/common.sh"

"${COMPOSE[@]}" up -d --remove-orphans
container_running() { test "$(docker inspect -f '{{.State.Running}}' "$MASTRA_CC_WEBTOP_CONTAINER" 2>/dev/null)" = true; }
wait_for 'container health' 45 2 container_running
wait_for 'desktop display' 45 2 container_exec test -S /tmp/.X11-unix/X1
wait_for 'AT-SPI accessibility bus' 45 2 container_exec test -S /config/.XDG/at-spi/bus_1
copy_node_if_needed
copy_built_artifacts
container_exec mkdir -p /config/workspace /config/.XDG/mastra-cc
container_exec chown -R 1000:1000 /config/workspace /config/.XDG/mastra-cc
container_exec bash -lc "cat > /config/workspace/protected.html <<'HTML'
<!doctype html><html><body><label>Password <input type=password value='$PROTECTED_VALUE' autofocus></label></body></html>
HTML"
session_exec 'pgrep -x kate >/dev/null || (kate /config/workspace/proof.txt >/tmp/kate.log 2>&1 &)'
session_exec "test -f /tmp/chromium-proof.pid && kill \$(cat /tmp/chromium-proof.pid) 2>/dev/null || true; rm -rf /tmp/chromium-proof; chromium --headless=new --no-sandbox --disable-gpu --force-renderer-accessibility --remote-debugging-address=127.0.0.1 --remote-debugging-port=9744 --user-data-dir=/tmp/chromium-proof file:///config/workspace/protected.html >/tmp/chromium-proof.log 2>&1 & echo \$! >/tmp/chromium-proof.pid"
wait_for 'Kate process' 30 1 container_exec pgrep -x kate
cdp_ready() { container_exec curl -sf http://127.0.0.1:9744/json/version >/dev/null; }
wait_for 'protected browser accessibility endpoint' 50 1 cdp_ready
session_exec "test -f /tmp/mastra-cc.pid && kill \$(cat /tmp/mastra-cc.pid) 2>/dev/null || true; rm -f '$SOCKET'; /usr/local/bin/node '$DEPLOY/daemon/main.mjs' --backend atspi --socket '$SOCKET' --grant kate --allow edit >/tmp/mastra-cc.log 2>&1 & echo \$! >/tmp/mastra-cc.pid"
session_exec "test -f /tmp/mastra-cc-cdp.pid && kill \$(cat /tmp/mastra-cc-cdp.pid) 2>/dev/null || true; rm -f '$CDP_SOCKET'; /usr/local/bin/node '$DEPLOY/daemon/main.mjs' --backend cdp --socket '$CDP_SOCKET' --grant chrome >/tmp/mastra-cc-cdp.log 2>&1 & echo \$! >/tmp/mastra-cc-cdp.pid"
wait_for 'AT-SPI daemon socket' 30 1 container_exec test -S "$SOCKET"
wait_for 'CDP daemon socket' 30 1 container_exec test -S "$CDP_SOCKET"
container_exec env MASTRA_CC_SOCKET="$SOCKET" /usr/local/bin/node "$DEPLOY/scenario-client.mjs" readiness
printf 'WEBTOP: READY http://127.0.0.1:%s\n' "$MASTRA_CC_WEBTOP_PORT"
