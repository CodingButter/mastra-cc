#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
trap 'echo "INVALID: inspection/setup failed; not causal RED" >&2' ERR
if [[ "${1:-}" == deterministic ]]; then
  ROOT="$(cd "$HERE/../../.." && pwd)"
  BASE="${2:?Usage: demo.sh deterministic immutable-base-worktree}"
  [[ "$(git -C "$BASE" rev-parse HEAD)" == 4dbd8153d16405b3c84f36fafb8aeec677edf4fc ]]
  [[ -z "$(git -C "$BASE" status --porcelain --untracked-files=no)" ]]
  for SIDE in base candidate; do
    SOURCE="$ROOT"; [[ "$SIDE" != base ]] || SOURCE="$BASE"
    (cd "$SOURCE" && node protocol/generate.mjs && pnpm exec turbo run build --force)
    INSTALL="$(mktemp -d /tmp/mousepad-deterministic-install.XXXXXX)/packed"
    RUN="$(mktemp -d /tmp/mousepad-deterministic-$SIDE.XXXXXX)"
    printf 'SIDE=%s RUN=%s INSTALL=%s\n' "$SIDE" "$RUN" "$INSTALL"
    node "$HERE/install-consumer.mjs" "$INSTALL" "$SOURCE"
    cp "$HERE/public-inspect.mjs" "$INSTALL/consumer/public-inspect.mjs"
    MOUSEPAD_PROOF_DAEMON="$SOURCE/daemon/dist/main.mjs" timeout --kill-after=15s 240s bash "$HERE/inspect-session.sh" --display "$RUN" "$INSTALL/consumer" >"$RUN/setup.log" 2>&1
    node "$HERE/deterministic.mjs" "$RUN" "$INSTALL" "$SIDE"
  done
  exit 0
fi
[[ "${1:-}" == inspect ]] || { echo 'Usage: demo.sh inspect [fresh-install-directory] | deterministic immutable-base-worktree' >&2; exit 2; }
INSTALL="${2:-$(mktemp -d /tmp/mousepad-install.XXXXXX)/packed}"
node "$HERE/install-consumer.mjs" "$INSTALL"
cp "$HERE/public-inspect.mjs" "$INSTALL/consumer/public-inspect.mjs"
RUN="$(mktemp -d /tmp/mousepad-inspect.XXXXXX)"
printf 'RUN=%s\nINSTALL=%s\n' "$RUN" "$INSTALL"
timeout --kill-after=15s 240s bash "$HERE/inspect-session.sh" --display "$RUN" "$INSTALL/consumer" >"$RUN/setup.log" 2>&1
node "$HERE/inspect-evidence.mjs" "$RUN" "$INSTALL"
