#!/usr/bin/env bash
# A key, addressed to one element - proven on the errand that needed it.
#
# The desktop-literacy sweep left one errand at 0/3 both before and after the
# instructions were rewritten: rename a file in the file manager. The rename
# commits on Enter, and there was no Enter. This runs that errand against three
# daemons:
#
#   base    - segment 03's tip. No key route at all; the driver reports the
#             route absent and exits non-zero.
#   denied  - this branch, started WITHOUT --allow rawInput. The key is refused
#             and names the flag that would change it. Off by default is not
#             read off the source here; it is asked of a running daemon.
#   armed   - this branch, started WITH it. The key is refused a second time and
#             for a different reason: this machine's accessibility interface
#             accepts a key and delivers nothing, measured against a control
#             keystroke, so the daemon reports no route rather than pressing
#             into the void. The file is untouched either way, and the proof
#             believes the FILESYSTEM rather than any return value.
#
# Nothing here plays the human. No xdotool, no wmctrl, no synthetic input from
# this harness - what is being proven is what the daemon will and will not do
# when asked for a key, and a harness that pressed one itself would be proving
# something about itself.
#
#   bash infra/webtop/04-a-key-addressed-to-one-element/proof.sh
#
# Requires the webtop container from infra/webtop to be up.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
. "$ROOT/infra/webtop/common.sh"
CONTAINER="$MASTRA_CC_WEBTOP_CONTAINER"
DEPLOY=/opt/mastra-cc
PORT="${MASTRA_CC_WS_PORT:-9979}"
SOCKET=/config/.XDG/mastra-cc/key-proof.sock
SCRATCH="${MASTRA_CC_SCRATCH:-/tmp/a-key-proof}"
BASE_TREE="${MASTRA_CC_BASE_TREE:-/tmp/a-key-base}"
BASE_SHA="${MASTRA_CC_BASE_SHA:-2593e80}"
WITH="$ROOT/docs/proofs/04-a-key-addressed-to-one-element-with.txt"
WITHOUT="$ROOT/docs/proofs/04-a-key-addressed-to-one-element-without.txt"
# The file manager opens on the home directory and this proof does not tell it
# where to look: opening an application at a path is a launch argument, and a
# proof that needed one would be proving something about launching rather than
# about a key. So the errand lives where the file manager already is.
ERRAND=/config
export NO_COLOR=1

clear_the_desk() {
  session_exec "pkill -KILL -x dolphin; for _ in 1 2 3 4 5; do pgrep -x dolphin >/dev/null || break; sleep 1; done; true" >/dev/null 2>&1 || true
  session_exec "test -f /tmp/key-proof.pid && kill \$(cat /tmp/key-proof.pid) 2>/dev/null || true; rm -f '$SOCKET'; true" >/dev/null 2>&1 || true
}
trap clear_the_desk EXIT

# The errand's own directory, rebuilt before every run. A leftover file from a
# previous run named what this run is about to rename to would let a red look
# green, which is the one way this proof could lie to itself.
reset_the_errand() {
  # Only the two files this errand owns are touched. The directory is the
  # container's home and everything else in it belongs to somebody else.
  session_exec "rm -f '$ERRAND/notes.txt' '$ERRAND/renamed-by-a-key.txt' && printf 'a shopping list\n' > '$ERRAND/notes.txt'" >/dev/null
}

# Asked of the filesystem, not of the application. The application's answer is
# in the transcript too, and the two agreeing is what makes it a fact rather
# than a claim (ADR-0047).
what_the_directory_holds() {
  session_exec "ls -1 '$ERRAND' | grep -E 'notes.txt|renamed-by-a-key.txt' || echo '(neither file is there)'" 2>/dev/null || true
}

# Two accessibility bus launchers means the registry serves one bus while new
# applications bridge to the other, and every query comes back empty. Said out
# loud before anything is measured, so a split desk cannot be mistaken for a
# missing key.
launchers="$(docker exec -u 1000 "$CONTAINER" bash -lc 'pgrep -c -f at-spi-bus-launcher' || true)"
test "${launchers:-0}" -eq 1 || {
  echo "HARNESS: RED - $launchers accessibility bus launcher(s); expected exactly 1. The desk is split across two buses."
  exit 1
}

pack_into() { # $1 = tree to pack from, $2 = scratch directory
  rm -rf "$2" && mkdir -p "$2"
  (cd "$1" && pnpm --filter @mastra-cc/transport --filter @mastra-cc/desktop build >/dev/null)
  for package in protocol-types transport desktop; do
    (cd "$1/packages/$package" && pnpm pack --pack-destination "$2" >/dev/null)
  done
  (cd "$2" && npm init -y >/dev/null && npm install ./*.tgz >/dev/null 2>&1)
  cp "$HERE/a-key-addressed-to-one-element.mjs" "$2/agent.mjs"
}

start_daemon_from() { # $1 = host path to a built daemon dist, $2 = extra flags
  clear_the_desk
  reset_the_errand
  docker exec "$CONTAINER" rm -rf "$DEPLOY/daemon-key-proof"
  docker cp "$1/." "$CONTAINER:$DEPLOY/daemon-key-proof"
  session_exec "/usr/local/bin/node '$DEPLOY/daemon-key-proof/main.mjs' --backend atspi --socket '$SOCKET' --grant '*' --permit org.kde.dolphin --allow edit --allow activate ${2} --ws-host 0.0.0.0 --ws-port $PORT >/tmp/key-proof.log 2>&1 & echo \$! >/tmp/key-proof.pid"
  for _ in $(seq 1 60); do
    docker exec "$CONTAINER" bash -lc "grep -q websocket /tmp/key-proof.log" 2>/dev/null && break
    sleep 0.5
  done
  docker exec "$CONTAINER" bash -lc "grep websocket /tmp/key-proof.log"
}

echo "== building the base tree, for the red side =="
if [ ! -d "$BASE_TREE" ]; then
  (cd "$ROOT" && git worktree add "$BASE_TREE" "$BASE_SHA" >/dev/null)
fi
(cd "$BASE_TREE" \
  && node protocol/generate.mjs --schema protocol/schema.json --out packages/protocol-types >/dev/null \
  && pnpm install --no-frozen-lockfile >/dev/null 2>&1 \
  && pnpm --filter @mastra-cc/protocol-types build >/dev/null 2>&1 \
  && pnpm --filter @mastra-cc/daemon build >/dev/null)

echo "== packing each side's own published packages =="
pack_into "$BASE_TREE" "$SCRATCH-base"
(cd "$ROOT" && pnpm --filter @mastra-cc/daemon build >/dev/null)
pack_into "$ROOT" "$SCRATCH"

IP="$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$CONTAINER")"
echo "container address: $IP"

echo
echo "== RED: the errand against the base daemon ($BASE_SHA) =="
start_daemon_from "$BASE_TREE/daemon/dist" "" | tee "$WITHOUT"
set +e
(cd "$SCRATCH-base" && node agent.mjs "ws://$IP:$PORT" armed 2>&1) | tee -a "$WITHOUT"
BASE_STATUS=${PIPESTATUS[0]}
set -e
echo "the directory afterwards:" | tee -a "$WITHOUT"
what_the_directory_holds | tee -a "$WITHOUT"
test "$BASE_STATUS" -ne 0 || { echo "PROOF: RED - the base daemon finished the errand; the demo proves nothing"; exit 1; }
echo "base daemon exited $BASE_STATUS, as it must" | tee -a "$WITHOUT"

echo
echo "== GREEN, part 1: this branch, with nobody having armed it ==" | tee "$WITH"
start_daemon_from "$ROOT/daemon/dist" "" | tee -a "$WITH"
set +e
(cd "$SCRATCH" && node agent.mjs "ws://$IP:$PORT" denied 2>&1) | tee -a "$WITH"
DENIED_STATUS=${PIPESTATUS[0]}
set -e
echo "the directory afterwards:" | tee -a "$WITH"
DENIED_LISTING="$(what_the_directory_holds)"
echo "$DENIED_LISTING" | tee -a "$WITH"
test "$DENIED_STATUS" -eq 0 || { echo "PROOF: RED - the unarmed daemon did not refuse the key" | tee -a "$WITH"; exit 1; }
case "$DENIED_LISTING" in
  *renamed-by-a-key*) echo "PROOF: RED - an unarmed daemon renamed the file" | tee -a "$WITH"; exit 1 ;;
esac

echo
echo "== GREEN, part 2: this branch, armed - and refusing for a different reason ==" | tee -a "$WITH"
start_daemon_from "$ROOT/daemon/dist" "--allow rawInput" | tee -a "$WITH"
set +e
(cd "$SCRATCH" && node agent.mjs "ws://$IP:$PORT" armed 2>&1) | tee -a "$WITH"
STATUS=${PIPESTATUS[0]}
set -e
echo "the directory afterwards, which is the verdict:" | tee -a "$WITH"
ARMED_LISTING="$(what_the_directory_holds)"
echo "$ARMED_LISTING" | tee -a "$WITH"

echo
echo "transcripts: $WITHOUT (base $BASE_SHA) and $WITH"
test "$STATUS" -eq 0 || { echo "PROOF: RED - the armed daemon did not refuse honestly"; exit 1; }
case "$ARMED_LISTING" in
  *renamed-by-a-key*) echo "PROOF: RED - a daemon that said it could not press a key renamed the file"; exit 1 ;;
esac
echo "PROOF: GREEN"
