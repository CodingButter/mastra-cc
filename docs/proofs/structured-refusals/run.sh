#!/bin/sh
# usage: run.sh <worktree> <digest>   — prints the three refusal responses
set -e
W=$1; S=/tmp/sr/d-$$.sock
node $W/daemon/dist/main.mjs --backend replay --fixture $W/daemon/src/__tests__/fixtures/gtk-dialog --socket $S >/tmp/sr/d-$$.log 2>&1 &
P=$!; for i in 1 2 3 4 5 6 7 8 9 10; do [ -S $S ] && break; sleep 0.3; done
node /tmp/sr/probe.mjs $S $2
kill $P
