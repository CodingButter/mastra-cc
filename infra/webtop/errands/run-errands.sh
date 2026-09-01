#!/usr/bin/env bash
# What the desk does not teach: six errands, three runs each, against a real desktop.
#
# This harness exists to produce a BASELINE RED. A real model is given a real
# errand with the shipped INSTRUCTIONS and nothing else, and the eighteen
# transcripts it leaves behind are the evidence that says which prose is missing.
# Nothing here asserts an errand succeeded - the failures ARE the artifact.
#
#   bash infra/webtop/errands/run-errands.sh              # all six errands
#   bash infra/webtop/errands/run-errands.sh E2 E6        # a subset
#   MASTRA_CC_ERRAND_INVENTORY=1 bash .../run-errands.sh  # inventory only
#
# Phase 2 re-runs this IDENTICAL file with MASTRA_CC_ERRAND_INSTRUCTIONS pointed at
# the new prose and MASTRA_CC_ERRAND_OUT pointed at a different directory. Freezing
# the harness is what makes the before/after comparison mean anything, so think hard
# before editing anything below that an errand's outcome could depend on.
#
# THIS FILE IS THE ERRAND HARNESS'S ONE HUMAN STAND-IN (pin B8). Every xdotool call
# in the whole harness lives here, because B8 scans .mjs as well as .sh under infra/
# and a second exemption would be the tempting fix. The driver asks the shell for a
# desk in a given state; it never reaches for the keyboard itself. The stand-in is
# used for exactly one thing: putting the desk into the state a person would have
# left it in BEFORE an errand starts. It never performs any step of an errand.
#
# Requires the webtop container from infra/webtop to be up, and GOOGLE_API_KEY (or
# MASTRA_CC_MODEL pointing at a model you can resolve).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
. "$ROOT/infra/webtop/common.sh"
CONTAINER="$MASTRA_CC_WEBTOP_CONTAINER"
PORT="${MASTRA_CC_ERRAND_PORT:-9983}"
CDP_PORT="${MASTRA_CC_ERRAND_CDP_PORT:-9984}"
ERRAND_SOCKET=/config/.XDG/mastra-cc/errands.sock
ERRAND_CDP_SOCKET=/config/.XDG/mastra-cc/errands-cdp.sock
SCRATCH="${MASTRA_CC_SCRATCH:-/tmp/errands-scratch}"
WORK=/config/errands
RUNS="${MASTRA_CC_ERRAND_RUNS:-3}"
export NO_COLOR=1

# An absolute MASTRA_CC_ERRAND_OUT is used as given; a relative one is repo-relative.
OUT="${MASTRA_CC_ERRAND_OUT:-docs/proofs/errands/baseline}"
case "$OUT" in /*) ;; *) OUT="$ROOT/$OUT" ;; esac
mkdir -p "$OUT"

ERRANDS=("$@")
test ${#ERRANDS[@]} -gt 0 || ERRANDS=(E1 E2 E3 E4 E5 E6)

# `session_exec` comes from common.sh: everything here runs inside the desktop
# session's own D-Bus, because a command without it cannot see the accessibility
# bus and reports an empty desk that looks exactly like a broken daemon.

# Exact process names only. A loose pattern once matched the daemon's own argv,
# because the argv carries the application names as grants. SIGKILL, because an
# editor holding an unsaved buffer answers SIGTERM by putting up a save dialog and
# staying exactly where it is - which is the state E6 is supposed to CREATE, not
# the state every other errand should inherit.
close_the_desk() {
  session_exec "pkill -KILL -x kate; pkill -KILL -x dolphin; pkill -KILL -x mousepad; pkill -KILL -x systemsettings; true" >/dev/null 2>&1 || true
  sleep 2
  # SIGKILL leaves the editor believing it crashed, and the NEXT launch then opens
  # a session-chooser dialog instead of the document. That poisons the errand
  # silently: the fixture process is alive, so a liveness check passes, but the
  # document the errand talks about is not on screen. Clearing the saved session
  # is what makes each run start from the same desk as the one before it.
  session_exec "rm -rf /config/.local/share/kate/sessions /config/.local/share/kate/anonymous.katesession; true" >/dev/null 2>&1 || true
}

# ---- fixtures ---------------------------------------------------------------
# Every errand's starting state is CREATED here, never hoped for. E2 renames a file
# that must exist; E5 reads a total that must be in the document. A fixture that
# drifted between the baseline and the Phase 2 re-run would make the comparison
# meaningless, so this runs before every single run, not once per sweep.
reset_fixtures() {
  session_exec "mkdir -p $WORK && rm -f $WORK/proof.txt $WORK/receipt.txt $WORK/list.txt && printf 'the desk remembers this line\\n' > $WORK/proof.txt"
  session_exec "cat > $WORK/receipt.txt <<'RECEIPT'
CORNER SHOP RECEIPT
oat milk        3.40
rye bread       2.85
coffee beans    7.15
TOTAL          13.40
RECEIPT"
  session_exec "cat > $WORK/form.html <<'FORM'
<!doctype html>
<html><head><title>Contact us</title></head>
<body>
  <h1>Contact us</h1>
  <form id=\"contact\" onsubmit=\"document.getElementById('done').textContent='SUBMITTED';return false;\">
    <label for=\"name\">Full name</label>
    <input id=\"name\" name=\"name\" type=\"text\">
    <label for=\"email\">Email address</label>
    <input id=\"email\" name=\"email\" type=\"email\">
    <button id=\"send\" type=\"submit\">Send message</button>
  </form>
  <p id=\"done\">not submitted</p>
</body></html>
FORM"
}

# ---- per-errand desk state --------------------------------------------------
# The rule each of these obeys: put the desk where a PERSON would have left it, then
# stop. Opening the application an errand names is only done where the errand's own
# sentence presupposes it is already open ("the receipt open in Kate"). E1 and E4
# name no open application, so nothing is opened for them - the agent launches.
# A fixture application is started and then CHECKED FOR LIFE, up to three times,
# and the sweep dies rather than proceeding without it. This is not defensiveness
# for its own sake: a run whose precondition never existed - "close the editor"
# with no editor open, "type it into the empty document" with no document - reads
# in the transcript exactly like the agent failing, and it would be filed as
# evidence about the instructions. It cost me a prose change I nearly wrote from
# a dead fixture. A void run must be impossible to mistake for a result.
start_fixture() { # $1 = process name, $2 = command
  for attempt in 1 2 3; do
    session_exec "pgrep -x $1 >/dev/null || ($2 >/dev/null 2>&1 &); sleep 5"
    session_exec "pgrep -x $1 >/dev/null" >/dev/null 2>&1 && return 0
  done
  echo "ERRANDS: RED - the fixture application \"$1\" would not start" >&2
  exit 1
}

prepare_desk() { # $1 = errand id
  close_the_desk
  reset_fixtures
  case "$1" in
    E1|E4) : ;;                                     # the agent opens what it needs
    E2) start_fixture dolphin "dolphin '$WORK'" ;;
    E3) start_page_browser ;;
    E5) start_fixture kate "kate --startanon '$WORK/receipt.txt'"
        start_fixture mousepad "mousepad" ;;
    E6) # The one errand whose starting state cannot be reached by opening a file:
        # the editor has to hold UNSAVED work, or "close without saving" has no
        # confirmation dialog to recognise and the errand tests nothing. This is
        # the human stand-in doing exactly what a person did before walking away.
        start_fixture kate "kate --startanon '$WORK/proof.txt'"
        session_exec "xdotool search --onlyvisible --name 'proof.txt' | tail -1 | xargs -I{} xdotool windowactivate --sync {}; sleep 1; xdotool type --delay 40 ' an unsaved thought'"
        sleep 2
        # The unsaved edit is the precondition, so it is verified too: Kate marks a
        # modified document with a trailing asterisk in the window title. Without
        # the asterisk there is no confirmation dialog to close, and E6 would be
        # asking about something that is not there.
        session_exec "xdotool search --onlyvisible --name 'proof.txt \\*' >/dev/null" >/dev/null 2>&1 ||
          { echo "ERRANDS: RED - the E6 editor never became dirty, so there is nothing to confirm" >&2; exit 1; } ;;
  esac
}

start_page_browser() {
  # E3's browser is Chrome reached over the debugging port, NOT a generically
  # launched Chromium: generic launch leaves a browser unreadable (ADR-0062), so an
  # E3 run against the accessibility bus would measure that limitation instead of
  # measuring the prose. There is no navigate method in the fourteen, so the page is
  # a LAUNCH-TIME fixture - the browser reads whatever it was started on.
  session_exec "pkill -KILL -x chromium; true" >/dev/null 2>&1 || true
  sleep 2
  session_exec "rm -f /config/.errand-browser/Singleton*; chromium --headless=new --no-sandbox --disable-gpu --force-renderer-accessibility --remote-debugging-address=127.0.0.1 --remote-debugging-port=9744 --user-data-dir=/config/.errand-browser file://$WORK/form.html >/tmp/errand-browser.log 2>&1 & echo \$! >/tmp/errand-browser.pid"
  for _ in $(seq 1 40); do
    container_exec curl -sf http://127.0.0.1:9744/json/version >/dev/null 2>&1 && return 0
    sleep 1
  done
  echo "ERRANDS: RED - the page browser never opened its debugging port" >&2
  return 1
}

start_daemon() {
  session_exec "test -f /tmp/errands.pid && kill \$(cat /tmp/errands.pid) 2>/dev/null || true; rm -f '$ERRAND_SOCKET'; true" >/dev/null 2>&1 || true
  # Permits carry launch authority; on this branch a permit implies the runtime tree
  # name through the derived recipe's appearsAs, but the grants are named anyway so
  # the harness reads the same whichever daemon it is pointed at.
  session_exec "/usr/local/bin/node '$DEPLOY/daemon-errands/main.mjs' --backend atspi --socket '$ERRAND_SOCKET' --permit org.kde.kate --permit org.kde.dolphin --permit org.xfce.mousepad --permit systemsettings --grant kate --grant dolphin --grant mousepad --grant systemsettings --allow edit --allow activate --allow submit --ws-host 0.0.0.0 --ws-port $PORT >/tmp/errands.log 2>&1 & echo \$! >/tmp/errands.pid"
  for _ in $(seq 1 60); do
    container_exec bash -lc "grep -q websocket /tmp/errands.log" 2>/dev/null && break
    sleep 0.5
  done
  container_exec bash -lc "grep websocket /tmp/errands.log"
}

start_cdp_daemon() {
  session_exec "test -f /tmp/errands-cdp.pid && kill \$(cat /tmp/errands-cdp.pid) 2>/dev/null || true; rm -f '$ERRAND_CDP_SOCKET'; true" >/dev/null 2>&1 || true
  session_exec "/usr/local/bin/node '$DEPLOY/daemon-errands/main.mjs' --backend cdp --socket '$ERRAND_CDP_SOCKET' --grant chrome --allow edit --allow activate --allow submit --ws-host 0.0.0.0 --ws-port $CDP_PORT >/tmp/errands-cdp.log 2>&1 & echo \$! >/tmp/errands-cdp.pid"
  for _ in $(seq 1 60); do
    container_exec bash -lc "grep -q websocket /tmp/errands-cdp.log" 2>/dev/null && break
    sleep 0.5
  done
  container_exec bash -lc "grep websocket /tmp/errands-cdp.log"
}

echo "== packing the publishable packages =="
rm -rf "$SCRATCH" && mkdir -p "$SCRATCH"
(cd "$ROOT" && pnpm --filter @mastra-cc/transport --filter @mastra-cc/desktop build >/dev/null)
for package in protocol-types transport desktop; do
  (cd "$ROOT/packages/$package" && pnpm pack --pack-destination "$SCRATCH" >/dev/null)
done
(cd "$SCRATCH" && npm init -y >/dev/null && npm install ./*.tgz >/dev/null 2>&1)
(cd "$SCRATCH" && npm install @mastra/core@1.63.2 >/dev/null 2>&1)
cp "$HERE/drive-errands.mjs" "$SCRATCH/agent.mjs"
node -e "console.log('resolved from:', require.resolve('@mastra-cc/desktop/mastra', { paths: ['$SCRATCH'] }))"

echo
echo "== deploying this branch's daemon =="
(cd "$ROOT" && pnpm --filter @mastra-cc/daemon build >/dev/null)
container_exec rm -rf "$DEPLOY/daemon-errands"
docker cp "$ROOT/daemon/dist/." "$CONTAINER:$DEPLOY/daemon-errands"

IP="$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$CONTAINER")"
echo "container address: $IP"

close_the_desk
reset_fixtures
start_daemon

# The inventory is confirmed against the RUNNING container before any errand is
# chosen, because an errand that needs software the desk does not have is not an
# errand - it is a different plan.
echo
echo "== what this desk actually has =="
(cd "$SCRATCH" && node -e '
import("@mastra-cc/desktop").then(async ({ connect }) => {
  const client = await connect({ url: process.argv[1] });
  const answer = await client.listApplications({});
  const apps = answer.applications ?? [];
  console.log(`entries: ${apps.length}`);
  console.log(`launchable: ${apps.filter((a) => a.launchable).length}`);
  for (const name of ["org.kde.kate", "org.kde.dolphin", "org.xfce.mousepad", "systemsettings", "chromium"]) {
    const found = apps.find((a) => a.name === name);
    console.log(`  ${name}: ${found ? `present, launchable=${found.launchable}` : "ABSENT"}`);
  }
  await client.close();
});' "ws://$IP:$PORT")

if [ -n "${MASTRA_CC_ERRAND_INVENTORY:-}" ]; then
  echo "ERRANDS: inventory only, stopping here"
  exit 0
fi

echo
echo "== the errands =="
for errand in "${ERRANDS[@]}"; do
  for run in $(seq 1 "$RUNS"); do
    transcript="$OUT/$errand-run$run.txt"
    echo "-- $errand run $run -> $transcript"
    prepare_desk "$errand"
    if [ "$errand" = "E3" ]; then
      start_cdp_daemon >/dev/null
      target="ws://$IP:$CDP_PORT"
    else
      target="ws://$IP:$PORT"
    fi
    (cd "$SCRATCH" && node agent.mjs "$target" "$errand" "$run" 2>&1) > "$transcript" || true
    tail -3 "$transcript" | sed 's/^/     /'
  done
done

close_the_desk
session_exec "test -f /tmp/errands.pid && kill \$(cat /tmp/errands.pid) 2>/dev/null || true; test -f /tmp/errands-cdp.pid && kill \$(cat /tmp/errands-cdp.pid) 2>/dev/null || true; true" >/dev/null 2>&1 || true

echo
echo "transcripts written: $(ls -1 "$OUT"/*.txt 2>/dev/null | wc -l | tr -d ' ')"
echo "ERRANDS: DONE"
