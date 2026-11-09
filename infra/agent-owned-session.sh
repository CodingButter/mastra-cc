#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE="${MASTRA_CC_NODE:-node}"
SOCKET="${MASTRA_CC_SOCKET:-${XDG_RUNTIME_DIR:-/tmp}/mastra-cc/daemon.sock}"
DAEMON_MAIN="${MASTRA_CC_DAEMON_MAIN:-$SCRIPT_DIR/../daemon/dist/main.mjs}"
OPEN_MAIN_APPS="${MASTRA_CC_OPEN_MAIN_APPS:-$SCRIPT_DIR/open-main-apps.mjs}"
AUDIT="${MASTRA_CC_AUDIT:-${XDG_RUNTIME_DIR:-/tmp}/mastra-cc/audit.jsonl}"
DAEMON_LOG="${MASTRA_CC_DAEMON_LOG:-${XDG_RUNTIME_DIR:-/tmp}/mastra-cc/daemon.log}"
DAEMON_PID_FILE="${MASTRA_CC_DAEMON_PID_FILE:-${XDG_RUNTIME_DIR:-/tmp}/mastra-cc/daemon.pid}"

for name in kate dolphin konsole chromium; do pkill -TERM -x "$name" || true; done
deadline=$((SECONDS + 5))
while ((SECONDS < deadline)); do
  alive=0
  for name in kate dolphin konsole chromium; do pgrep -x "$name" >/dev/null && alive=1; done
  ((alive == 0)) && break
  sleep 0.25
done
for name in kate dolphin konsole chromium; do
  pgrep -x "$name" >/dev/null && pkill -KILL -x "$name" || true
done
for name in kate dolphin konsole chromium; do
  if pgrep -x "$name" >/dev/null; then
    printf 'agent-owned-session: %s is still running after TERM and KILL\n' "$name" >&2
    exit 1
  fi
done

mkdir -p "$(dirname "$SOCKET")" "$(dirname "$AUDIT")" "$(dirname "$DAEMON_LOG")" "$(dirname "$DAEMON_PID_FILE")"
if test -f "$DAEMON_PID_FILE"; then kill "$(cat "$DAEMON_PID_FILE")" 2>/dev/null || true; fi
rm -f "$SOCKET"
daemon_args=(--backend atspi --socket "$SOCKET" --audit "$AUDIT")
if test -n "${MASTRA_CC_WS_PORT:-}"; then
  daemon_args+=(--ws-port "$MASTRA_CC_WS_PORT" --ws-host "${MASTRA_CC_WS_HOST:-127.0.0.1}")
fi
setsid nohup "$NODE" "$DAEMON_MAIN" "${daemon_args[@]}" </dev/null >"$DAEMON_LOG" 2>&1 &
daemon_pid=$!
printf '%s\n' "$daemon_pid" >"$DAEMON_PID_FILE"
cleanup_failed_start() {
  status=$?
  if ((status != 0)); then
    kill "$daemon_pid" 2>/dev/null || true
    wait "$daemon_pid" 2>/dev/null || true
  fi
  exit "$status"
}
trap cleanup_failed_start EXIT
for ((attempt=0; attempt<300; attempt++)); do
  test -S "$SOCKET" && break
  kill -0 "$daemon_pid" 2>/dev/null || { cat "$DAEMON_LOG" >&2; exit 1; }
  sleep 0.1
done
test -S "$SOCKET" || { printf 'agent-owned-session: daemon socket did not become ready\n' >&2; exit 1; }
MASTRA_CC_SOCKET="$SOCKET" "$NODE" "$OPEN_MAIN_APPS"
trap - EXIT
