#!/usr/bin/env bash
set -u

# Keeper-style health report (docs/07-ROADMAP.md:79). Reports the machine's
# mastra-cc state; exits 0 when it produced a report. Installed by infra/apply.sh
# to <prefix>/.local/libexec/mastra-cc/health.sh and executed FROM that path -
# ADR-0001's lesson was a maintenance script in ~/bin that no test could see.

PREFIX="${MASTRA_CC_PREFIX:-$HOME}"
UNIT="$PREFIX/.config/systemd/user/mastra-desktop-daemon.service"

if [ -f "$UNIT" ]; then
  echo "health: unit file installed at $UNIT"
else
  echo "health: unit file NOT installed at $UNIT"
fi

SOCK="${XDG_RUNTIME_DIR:-/nonexistent}/mastra-cc/daemon.sock"
if [ -S "$SOCK" ]; then
  echo "health: daemon socket present at $SOCK"
else
  echo "health: daemon socket not present at $SOCK (no daemon ships until Phase 3)"
fi

if command -v gdbus >/dev/null 2>&1 &&
  gdbus call --session --dest org.a11y.Bus --object-path /org/a11y/bus --method org.a11y.Bus.GetAddress >/dev/null 2>&1; then
  echo "health: accessibility bus reachable"
else
  echo "health: accessibility bus not reachable from this session"
fi

echo "health: report complete"
