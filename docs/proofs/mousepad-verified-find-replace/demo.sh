#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
trap 'echo "INVALID: inspection/setup failed; not causal RED" >&2' ERR
[[ "${1:-}" == inspect ]] || { echo 'Usage: demo.sh inspect [fresh-install-directory]' >&2; exit 2; }
INSTALL="${2:-$(mktemp -d /tmp/mousepad-install.XXXXXX)/packed}"
node "$HERE/install-consumer.mjs" "$INSTALL"
cp "$HERE/public-inspect.mjs" "$INSTALL/consumer/public-inspect.mjs"
RUN="$(mktemp -d /tmp/mousepad-inspect.XXXXXX)"
printf 'RUN=%s\nINSTALL=%s\n' "$RUN" "$INSTALL"
timeout --kill-after=15s 240s bash "$HERE/inspect-session.sh" --display "$RUN" "$INSTALL/consumer" >"$RUN/setup.log" 2>&1
node "$HERE/inspect-evidence.mjs" "$RUN" "$INSTALL"
