#!/usr/bin/env bash
set -euo pipefail

# Installs this machine's mastra-cc configuration from the repository (ADR-0001:
# machine configuration lives in infra/ and is applied by a checked-in script,
# never by hand). Idempotent: prints what it would change before changing it,
# reports "no changes" when there is nothing to do.
#
# M1 installs two things:
# - the daemon's user systemd unit, NOT enabled by default (docs/07-ROADMAP.md M1);
# - the keeper-style health script, installed to <prefix>/.local/libexec/mastra-cc/,
#   because docs/07-ROADMAP.md:79 requires the INSTALLED copy to execute from its
#   installed path - running the repository copy proves nothing about what was
#   installed.
#
# MASTRA_CC_PREFIX overrides the install prefix (default: $HOME) so a fresh empty
# directory can stand in for a machine that has never run this.

PREFIX="${MASTRA_CC_PREFIX:-$HOME}"
DRY=0
if [ "${1:-}" = "--dry-run" ]; then DRY=1; fi

# Preconditions: fail loudly rather than continue.
command -v node >/dev/null 2>&1 || { echo "apply: node is not on PATH" >&2; exit 1; }
[ -n "${XDG_RUNTIME_DIR:-}" ] || { echo "apply: XDG_RUNTIME_DIR is not set" >&2; exit 1; }

HERE="$(cd "$(dirname "$0")" && pwd)"
UNIT_SRC="$HERE/units/mastra-desktop-daemon.service"
KEEPER_SRC="$HERE/keeper/health.sh"
UNIT_DST="$PREFIX/.config/systemd/user/mastra-desktop-daemon.service"
KEEPER_DST="$PREFIX/.local/libexec/mastra-cc/health.sh"

CHANGES=0

install_file() {
  src="$1"
  dst="$2"
  mode="$3"
  if [ -f "$dst" ] && cmp -s "$src" "$dst"; then
    echo "apply: $dst is current"
    return 0
  fi
  echo "apply: would install $src -> $dst (mode $mode)"
  CHANGES=$((CHANGES + 1))
  if [ "$DRY" -eq 0 ]; then
    mkdir -p "$(dirname "$dst")"
    install -m "$mode" "$src" "$dst"
    echo "apply: installed $dst"
  fi
}

install_file "$UNIT_SRC" "$UNIT_DST" 644
install_file "$KEEPER_SRC" "$KEEPER_DST" 755

if [ "$CHANGES" -eq 0 ]; then
  echo "apply: no changes"
elif [ "$DRY" -eq 1 ]; then
  echo "apply: dry run - $CHANGES change(s) pending"
else
  echo "apply: $CHANGES change(s) applied"
fi
echo "apply: the daemon unit is installed but not enabled - enabling is not part of M1"
