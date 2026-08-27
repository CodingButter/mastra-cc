#!/usr/bin/env bash
set -euo pipefail

# Installs this machine's mastra-cc configuration from the repository (ADR-0001:
# machine configuration lives in infra/ and is applied by a checked-in script,
# never by hand). Idempotent: prints what it would change before changing it,
# reports "no changes" when there is nothing to do.
#
# Installs repository-owned runtime artifacts and seeds missing operator-owned
# configuration. Repository artifacts are replaced when the checked-in version
# changes; operator files are never overwritten after their first installation.
# The daemon user unit is installed but NOT enabled by default.
#
# MASTRA_CC_PREFIX overrides the install prefix (default: $HOME) so a fresh empty
# directory can stand in for a machine that has never run this.

PREFIX="${MASTRA_CC_PREFIX:-$HOME}"
DRY=0
if [ "${1:-}" = "--dry-run" ]; then DRY=1; fi

# --headless-check: prove the headless session recipe by obtaining a real
# element with no monitor attached - a virtual display (Xvfb), a private
# session bus (dbus-run-session), the accessibility bus launched into it
# (at-spi-bus-launcher lives in /usr/libexec, not on PATH), a GTK application
# started into the virtual display, and the built daemon reading it off the
# bus. This is the lane that gives a machine with no desktop live capture.
#
# The dialog is yad (GTK3), not zenity: zenity 4.x is GTK4, and a GTK4
# application inside a bare Xvfb session was observed never registering on the
# private accessibility bus (its pid never appears among the bus connections),
# while GTK3 applications in the same sandbox register immediately. The lane
# needs an app that provably joins the bus, so GTK3 it is.
if [ "${1:-}" = "--headless-check" ]; then
  REPO="$(cd "$(dirname "$0")/.." && pwd)"
  for cmd in Xvfb dbus-run-session yad node; do
    command -v "$cmd" >/dev/null 2>&1 || { echo "headless: $cmd is not installed - install it and re-run" >&2; exit 1; }
  done
  [ -x /usr/libexec/at-spi-bus-launcher ] || { echo "headless: /usr/libexec/at-spi-bus-launcher is missing" >&2; exit 1; }
  [ -f "$REPO/daemon/dist/main.mjs" ] || { echo "headless: daemon is not built - run pnpm turbo run build first" >&2; exit 1; }

  HEADLESS_DISPLAY=":97"
  Xvfb "$HEADLESS_DISPLAY" -screen 0 1024x768x24 -nolisten tcp 2>/dev/null &
  XVFB_PID=$!
  trap 'kill "$XVFB_PID" 2>/dev/null || true' EXIT
  sleep 1

  # Everything below runs inside a PRIVATE session bus: the a11y bus is
  # launched into it, the GTK app registers there, and the daemon reads from
  # it. The real desktop's buses are never touched. WAYLAND_DISPLAY is
  # stripped so GTK cannot prefer the real compositor over the virtual X
  # display. STATUS is captured with || so set -e cannot swallow the exit code.
  env -u WAYLAND_DISPLAY DISPLAY="$HEADLESS_DISPLAY" dbus-run-session -- bash -c '
    set -euo pipefail
    /usr/libexec/at-spi-bus-launcher --launch-immediately --a11y=1 >/dev/null 2>&1 &
    LAUNCHER_PID=$!
    sleep 1.5
    yad --title "M1 demo window" --text "M1 demo window" --button OK >/dev/null 2>&1 &
    YAD_PID=$!
    sleep 3
    STATUS=0
    # --grant yad: this window was started by the script, not launched by the
    # daemon - without a session observe grant, deny-by-default (ADR-0036)
    # answers an EMPTY tree and the query fails. The grant key is the
    # application name on the bus ("yad"), not the window title.
    node "'"$REPO"'/daemon/dist/main.mjs" --backend atspi --grant yad --query "OK" || STATUS=$?
    kill "$YAD_PID" "$LAUNCHER_PID" 2>/dev/null || true
    exit "$STATUS"
  '
  echo "headless: a real element was read with no monitor attached"
  exit 0
fi

# Preconditions: fail loudly rather than continue.
command -v node >/dev/null 2>&1 || { echo "apply: node is not on PATH" >&2; exit 1; }
[ -n "${XDG_RUNTIME_DIR:-}" ] || { echo "apply: XDG_RUNTIME_DIR is not set" >&2; exit 1; }

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
UNIT_SRC="$HERE/units/mastra-desktop-daemon.service"
KEEPER_SRC="$HERE/keeper/health.sh"
GRANTS_SRC="$HERE/config/gmail-grants.json"
CAPABILITIES_SRC="$HERE/config/gmail-capabilities.json"
DAEMON_SRC="$REPO/daemon/dist"
UNIT_DST="$PREFIX/.config/systemd/user/mastra-desktop-daemon.service"
KEEPER_DST="$PREFIX/.local/libexec/mastra-cc/health.sh"
GRANTS_DST="$PREFIX/.config/mastra-cc/gmail-grants.json"
CAPABILITIES_DST="$PREFIX/.config/mastra-cc/gmail-capabilities.json"
DAEMON_DST="$PREFIX/.local/lib/mastra-cc/daemon"
STATE_DST="$PREFIX/.local/state/mastra-cc"

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

seed_file() {
  src="$1"
  dst="$2"
  mode="$3"
  if [ -e "$dst" ]; then
    echo "apply: preserving operator-owned $dst"
    return 0
  fi
  echo "apply: would seed $src -> $dst (mode $mode)"
  CHANGES=$((CHANGES + 1))
  if [ "$DRY" -eq 0 ]; then
    mkdir -p "$(dirname "$dst")"
    chmod 700 "$(dirname "$dst")"
    install -m "$mode" "$src" "$dst"
    echo "apply: seeded $dst"
  fi
}

ensure_directory() {
  dst="$1"
  mode="$2"
  current_mode=""
  if [ -d "$dst" ]; then current_mode="$(stat -c %a "$dst")"; fi
  if [ "$current_mode" = "$mode" ]; then
    echo "apply: $dst is current"
    return 0
  fi
  echo "apply: would ensure directory $dst (mode $mode)"
  CHANGES=$((CHANGES + 1))
  if [ "$DRY" -eq 0 ]; then
    mkdir -p "$dst"
    chmod "$mode" "$dst"
    echo "apply: ensured $dst"
  fi
}

install_tree() {
  src="$1"
  dst="$2"
  if [ ! -f "$src/main.mjs" ]; then
    if [ "$DRY" -eq 1 ]; then
      echo "apply: would install tree $src -> $dst"
      CHANGES=$((CHANGES + 1))
      return 0
    fi
    echo "apply: daemon is not built - run pnpm --filter @mastra-cc/daemon build first" >&2
    exit 1
  fi

  node --input-type=module - "$src/main.mjs" <<'NODE'
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const entry = process.argv[2];
const source = readFileSync(entry, "utf8");
const imports = [...source.matchAll(/(?:from\s*|import\s*)["'](\.\.?\/[^"']+)["']/g)];
for (const [, specifier] of imports) {
  const target = fileURLToPath(new URL(specifier, pathToFileURL(entry)));
  if (!existsSync(target)) {
    console.error(`apply: daemon build is incomplete - ${resolve(dirname(entry), specifier)} is missing; rebuild the daemon`);
    process.exit(1);
  }
}
NODE

  parent="$(dirname "$dst")"
  if [ "$DRY" -eq 1 ]; then
    stage="$(mktemp -d "${TMPDIR:-/tmp}/mastra-cc-daemon.XXXXXX")"
  else
    mkdir -p "$parent"
    stage="$(mktemp -d "$parent/.daemon.XXXXXX")"
  fi
  trap 'rm -rf "${stage:-}"' RETURN
  cp -a "$src/." "$stage/"
  mkdir -p "$stage/tools/pins"
  install -m 644 "$REPO/tools/pins/deny-list.json" "$stage/tools/pins/deny-list.json"
  chmod -R u=rwX,go=rX "$stage"

  if [ -d "$dst" ] && diff -qr "$stage" "$dst" >/dev/null 2>&1; then
    echo "apply: $dst is current"
    rm -rf "$stage"
    stage=""
    trap - RETURN
    return 0
  fi

  echo "apply: would install tree $src -> $dst"
  CHANGES=$((CHANGES + 1))
  if [ "$DRY" -eq 1 ]; then
    rm -rf "$stage"
    stage=""
    trap - RETURN
    return 0
  fi
  rm -rf "$dst"
  mv "$stage" "$dst"
  stage=""
  trap - RETURN
  echo "apply: installed $dst"
}

install_file "$UNIT_SRC" "$UNIT_DST" 644
install_file "$KEEPER_SRC" "$KEEPER_DST" 755
ensure_directory "$PREFIX/.config/mastra-cc" 700
seed_file "$GRANTS_SRC" "$GRANTS_DST" 600
seed_file "$CAPABILITIES_SRC" "$CAPABILITIES_DST" 600
ensure_directory "$STATE_DST" 700
install_tree "$DAEMON_SRC" "$DAEMON_DST"

if [ "$CHANGES" -eq 0 ]; then
  echo "apply: no changes"
elif [ "$DRY" -eq 1 ]; then
  echo "apply: dry run - $CHANGES change(s) pending"
else
  echo "apply: $CHANGES change(s) applied"
fi
echo "apply: the daemon unit is installed but not enabled - startup remains an operator decision"
