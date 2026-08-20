#!/usr/bin/env bash
# The committed witness for the live accessibility lane (issue #1). CI could
# not see this lane before: the recipe lived in an untracked scratch directory,
# so a CI checkout had nothing to run and the live conformance suite skipped
# itself in silence. This script is that recipe, committed, and it is what CI
# runs.
#
# It builds a desktop out of nothing - a virtual display (Xvfb), a private
# session bus (dbus-run-session), the accessibility bus launched into it, and a
# real GTK3 application (yad) showing a real button - then asks the daemon two
# questions on that bus:
#
#   1. can it read a real element?      (one-shot --query, the readability arm)
#   2. does the at-spi backend conform? (MASTRA_CC_LIVE=1 conformance suite)
#
# Only when both answer yes does the last line print. That line is the lock:
# "a green run must be verified, not inferred from a lack of shouting"
# (docs/05-TEST-STRATEGY.md). Every failure path above it exits non-zero
# without printing it, so an absent PROOF: GREEN is exactly what a broken or
# missing bus looks like.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

for cmd in Xvfb dbus-run-session yad node timeout; do
  command -v "$cmd" >/dev/null 2>&1 || {
    echo "demo: $cmd is not installed - install it and re-run" >&2
    exit 1
  }
done

# The launcher is not on PATH and its home moved between Ubuntu releases:
# /usr/libexec on 24.04, /usr/lib/at-spi2-core on the releases before it. Look
# in both rather than hard-code one and fail confusingly on the other.
LAUNCHER=""
for candidate in \
  /usr/libexec/at-spi-bus-launcher \
  /usr/libexec/at-spi2-core/at-spi-bus-launcher \
  /usr/lib/at-spi2-core/at-spi-bus-launcher; do
  if [ -x "$candidate" ]; then
    LAUNCHER="$candidate"
    break
  fi
done
[ -n "$LAUNCHER" ] || {
  echo "demo: at-spi-bus-launcher is missing - install at-spi2-core" >&2
  exit 1
}

# The lane reads the BUILT daemon, the artefact a machine would run, not the
# sources.
[ -f "$ROOT/daemon/dist/main.mjs" ] || {
  echo "demo: daemon is not built - run pnpm turbo run build first" >&2
  exit 1
}

# :98, one past apply.sh --headless-check's :97, so the two lanes can run at
# the same time on one machine without fighting over a display number.
DEMO_DISPLAY="${MASTRA_CC_DEMO_DISPLAY:-:98}"
Xvfb "$DEMO_DISPLAY" -screen 0 1024x768x24 -nolisten tcp 2>/dev/null &
XVFB_PID=$!
trap 'kill "$XVFB_PID" 2>/dev/null || true' EXIT
sleep 1

# Everything below runs inside a PRIVATE session bus: the a11y bus is launched
# into it, yad registers there, and the daemon reads from it. The developer's
# real desktop buses are never touched. WAYLAND_DISPLAY is stripped so GTK
# cannot prefer a real compositor over the virtual X display. The inner shell
# traps its own exit so the window and the bus launcher die with it - an
# orphaned launcher holds the session open and a CI job that hangs is worse
# than one that fails. timeout is the outer belt: a wedged lane is killed, not
# waited on, and a killed lane prints no lock line.
#
# STATUS is captured with || so set -e cannot swallow the exit code before the
# lock line is decided.
STATUS=0
timeout --kill-after=30s 15m \
  env -u WAYLAND_DISPLAY DISPLAY="$DEMO_DISPLAY" dbus-run-session -- bash -c '
    set -uo pipefail
    ROOT="$1"
    LAUNCHER="$2"
    trap '"'"'kill "${YAD_PID:-}" "${LAUNCHER_PID:-}" 2>/dev/null || true'"'"' EXIT

    "$LAUNCHER" --launch-immediately --a11y=1 >/dev/null 2>&1 &
    LAUNCHER_PID=$!
    sleep 1.5
    yad --title "M1 demo window" --text "M1 demo window" --button OK >/dev/null 2>&1 &
    YAD_PID=$!
    sleep 3

    # --grant yad: this window was started by the script, not launched by the
    # daemon - without a session observe grant, deny-by-default (ADR-0036)
    # answers an EMPTY tree and the query fails. The grant key is the
    # application name on the bus ("yad"), not the window title.
    #
    # Registering on the a11y bus is not instant and a shared CI runner is
    # slower than a desktop, so the read is retried rather than slept at. The
    # attempts are BOUNDED: a lane with no window still runs out of them and
    # still fails - waiting longer for an answer is not the same as accepting
    # no answer.
    QUERY_STATUS=1
    for _ in $(seq 1 20); do
      if node "$ROOT/daemon/dist/main.mjs" --backend atspi --grant yad --query "OK"; then
        QUERY_STATUS=0
        break
      fi
      sleep 1
    done
    [ "$QUERY_STATUS" -eq 0 ] || {
      echo "demo: no element named OK could be read after 20 attempts" >&2
      exit 1
    }

    # The conformance suite proper, on the same bus. It is filtered to the
    # at-spi backend because the other live backend (cdp) needs a Chrome this
    # session has not booted; that one has its own lane, infra/cdp-live.sh.
    # The suite reads with visibility "all", so it needs no grant of its own.
    cd "$ROOT"
    REPORT="$(mktemp)"
    # NO_COLOR: the count below is read by grep, and colour escapes sit between
    # the label and the number.
    NO_COLOR=1 MASTRA_CC_LIVE=1 pnpm --filter @mastra-cc/daemon exec vitest run \
      src/__tests__/backend-conformance.test.ts -t "backend \"atspi\"" --reporter=dot 2>&1 | tee "$REPORT"
    SUITE=${PIPESTATUS[0]}
    [ "$SUITE" -eq 0 ] || exit "$SUITE"

    # A suite that skipped every test exits 0 - the exact silence issue #1 is
    # about. Demand that the reporter counted at least one PASSING test before
    # this lane is allowed to call itself green.
    grep -Eq "Tests +[1-9][0-9]* passed" "$REPORT" || {
      echo "demo: the live conformance suite passed no tests - it skipped itself" >&2
      exit 1
    }
  ' demo "$ROOT" "$LAUNCHER" || STATUS=$?

if [ "$STATUS" -ne 0 ]; then
  echo "demo: the live accessibility lane did not answer (exit $STATUS)" >&2
  exit "$STATUS"
fi

echo "PROOF: GREEN - a real element was read and the at-spi backend conformed on a real accessibility bus"
