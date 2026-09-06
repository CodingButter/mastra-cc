#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
if [[ "${1:-}" == --session ]]; then
  RUN="$2"; ARTIFACT_ROOT="$3"; SIDE="$4"
  pids=()
  cleanup() { for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done; for pid in "${pids[@]}"; do wait "$pid" 2>/dev/null || true; done; }
  trap cleanup EXIT
  export FIELD_PROOF_ISOLATED=1 GDK_BACKEND=x11 GTK_MODULES=gail:atk-bridge NO_AT_BRIDGE=0
  /usr/libexec/at-spi-bus-launcher --launch-immediately --a11y=1 >"$RUN/a11y.log" 2>&1 & pids+=("$!")
  openbox >"$RUN/openbox.log" 2>&1 & pids+=("$!")
  sleep 1
  bash "$ROOT/docs/proofs/model-desktop-task-2026-09-06/fixture.sh" "$RUN/receipt" >"$RUN/fixture.log" 2>&1 & pids+=("$!")
  sleep 2
  node "$HERE/probe.mjs" yad "$RUN/native.json" >"$RUN/native-fields.txt"
  printf '{"Receipt number":"CALIBRATION-7F29","Total paid":"123.45"}\n' >"$RUN/calibration-values.json"
  node "$HERE/calibrate.mjs" "$RUN/native.json" "$RUN/calibration-values.json" >"$RUN/calibration.json"
  node "$ARTIFACT_ROOT/daemon/dist/main.mjs" --backend atspi --grant yad --socket "$RUN/s" >"$RUN/daemon.log" 2>&1 & pids+=("$!")
  node "$HERE/deterministic.mjs" "$ARTIFACT_ROOT" "$RUN" "$SIDE"
  exit
fi
RUN="$(mktemp -d "$HERE/deterministic.XXXXXX")"
echo "RUN=$RUN"
BASE_PARENT="$(mktemp -d /tmp/field-label-base.XXXXXX)"; BASE="$BASE_PARENT/worktree"
xvfb=""
cleanup() {
  if [[ -n "$xvfb" ]]; then kill "$xvfb" 2>/dev/null || true; wait "$xvfb" 2>/dev/null || true; fi
  git -C "$ROOT" worktree remove "$BASE" 2>/dev/null || true
}
trap cleanup EXIT
for cmd in Xvfb dbus-run-session yad openbox node pnpm timeout; do command -v "$cmd" >/dev/null; done
git -C "$ROOT" worktree add --detach "$BASE" ab8329678060524858ce6fc20d3c5c4bd68db13a >"$RUN/base-worktree.log" 2>&1
(cd "$BASE" && node protocol/generate.mjs && pnpm install --frozen-lockfile && pnpm turbo run build --force) >"$RUN/base-build.log" 2>&1
(cd "$ROOT" && node protocol/generate.mjs && pnpm turbo run build --force) >"$RUN/candidate-build.log" 2>&1
for side in base candidate; do
  sideRun="$RUN/$side"; mkdir -p "$sideRun"; mkdir -m 700 "$sideRun/home" "$sideRun/runtime"
  artifactRoot="$ROOT"; [[ "$side" != base ]] || artifactRoot="$BASE"
  Xvfb -displayfd 3 -screen 0 1024x768x24 -nolisten tcp 3>"$sideRun/display" >"$sideRun/xvfb.log" 2>&1 & xvfb=$!
  for ((i=0;i<50;i++)); do [[ -s "$sideRun/display" ]] && break; sleep 0.1; done
  [[ -s "$sideRun/display" ]]
  timeout --kill-after=15s 90s env -u WAYLAND_DISPLAY -u DBUS_SESSION_BUS_ADDRESS -u AT_SPI_BUS_ADDRESS -u XAUTHORITY \
    DISPLAY=":$(<"$sideRun/display")" XDG_RUNTIME_DIR="$sideRun/runtime" HOME="$sideRun/home" XDG_CONFIG_HOME="$sideRun/home/config" \
    dbus-run-session -- bash "$HERE/deterministic.sh" --session "$sideRun" "$artifactRoot" "$side" 2>&1 | tee "$sideRun/transcript.txt"
  kill "$xvfb"; wait "$xvfb" || true; xvfb=""
done
node --input-type=module - "$RUN" <<'NODE'
import fs from 'node:fs';
import assert from 'node:assert/strict';
const run = process.argv[2];
const read = side => JSON.parse(fs.readFileSync(`${run}/${side}/metadata.json`));
const base = read('base'), candidate = read('candidate');
assert.notEqual(base.schemaSha256, candidate.schemaSha256);
assert.notEqual(base.artifacts[0].sha256, candidate.artifacts[0].sha256);
assert.match(fs.readFileSync(`${run}/base/transcript.txt`, 'utf8'), /SETUP_OK[\s\S]*BASE_RED/);
assert.match(fs.readFileSync(`${run}/candidate/transcript.txt`, 'utf8'), /SETUP_OK[\s\S]*CANDIDATE_GREEN/);
console.log('PROOF: GREEN (base RED and candidate GREEN; no model trials)');
NODE
