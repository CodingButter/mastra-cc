#!/usr/bin/env bash
set -euo pipefail
mode= artifact_root= proof_dir= scenario=default
while (($#)); do
  case "$1" in
    --mode|--artifact-root|--proof-dir|--scenario)
      (($# >= 2)) || exit 2
      case "$1" in --mode) mode=$2;; --artifact-root) artifact_root=$2;; --proof-dir) proof_dir=$2;; --scenario) scenario=$2;; esac
      shift 2;;
    *) echo 'unknown argument' >&2; exit 2;;
  esac
done
[[ "$mode" == branch || "$mode" == base ]] || exit 2
[[ "$scenario" == default || "$scenario" == geometry || "$scenario" == cleanup ]] || exit 2
[[ "$artifact_root" == /* && "$proof_dir" == /* ]] || exit 2
[[ "$mode" == branch || "$scenario" == default ]] || exit 2
[[ -f "$artifact_root/daemon/dist/main.mjs" ]] || exit 2
export MASTRA_CC_WEBTOP_PROJECT=${MASTRA_CC_WEBTOP_PROJECT:-mcc-authorized-capture}
export MASTRA_CC_WEBTOP_PORT=${MASTRA_CC_WEBTOP_PORT:-13310}
[[ "$MASTRA_CC_WEBTOP_PORT" =~ ^[0-9]{4,5}$ ]] && ((10#$MASTRA_CC_WEBTOP_PORT > 1024 && 10#$MASTRA_CC_WEBTOP_PORT < 65536)) || exit 2
[[ "$mode" != base || "$MASTRA_CC_WEBTOP_PROJECT" == mcc-authorized-capture-base ]] || exit 2
[[ "$MASTRA_CC_WEBTOP_PROJECT" == mcc-authorized-capture || "$MASTRA_CC_WEBTOP_PROJECT" == "mcc-authorized-capture-$mode" ]] || exit 2
source "$(dirname "$0")/../common.sh"
[[ "$MASTRA_CC_WEBTOP_CONTAINER" == "$MASTRA_CC_WEBTOP_PROJECT" ]] || exit 2
mkdir -p "$proof_dir"
if [[ "$mode" == branch ]]; then
  timeout -k 5 600 bash "$WEBTOP_DIR/authorized-capture/helper-proof.sh" >"$proof_dir/integration-helper.txt" 2>&1
else
  COMPOSE+=(-f "$WEBTOP_DIR/authorized-capture/compose.gpu.yml")
  timeout -k 5 180 "${COMPOSE[@]}" up -d desktop
  wait_for 'Plasma session' 60 1 session_exec 'test -n "$DBUS_SESSION_BUS_ADDRESS"'
  container_exec mkdir -p /opt/authorized-source/infra/webtop
  docker cp "$WEBTOP_DIR/authorized-capture" "$MASTRA_CC_WEBTOP_CONTAINER:/opt/authorized-source/infra/webtop/"
  container_exec test ! -e /usr/local/libexec/mastra-cc-kwin-capture
  container_exec timeout -k 5 300 apt-get update
  container_exec timeout -k 5 300 apt-get install -y --no-install-recommends g++ pkg-config qt6-base-dev
fi
copy_node_if_needed
ROOT=$artifact_root
copy_built_artifacts
container_exec mkdir -p "$DEPLOY/node_modules/@mastra-cc"
ws_dir=$(cd "$artifact_root" && node --input-type=module -e 'import {createRequire} from "node:module"; import {dirname} from "node:path"; import {realpathSync} from "node:fs"; console.log(dirname(realpathSync(createRequire(process.cwd()+"/packages/transport/package.json").resolve("ws/package.json"))))')
docker cp "$ws_dir" "$MASTRA_CC_WEBTOP_CONTAINER:$DEPLOY/node_modules/ws"
docker cp "$artifact_root/packages/protocol-types" "$MASTRA_CC_WEBTOP_CONTAINER:$DEPLOY/node_modules/@mastra-cc/protocol-types"
docker cp "$WEBTOP_DIR/authorized-capture/client.mjs" "$MASTRA_CC_WEBTOP_CONTAINER:$DEPLOY/capture-client.mjs"
docker cp "$WEBTOP_DIR/authorized-capture/geometry-client.mjs" "$MASTRA_CC_WEBTOP_CONTAINER:$DEPLOY/geometry-client.mjs"
installer=/opt/authorized-source/infra/webtop/authorized-capture/install.sh
if [[ "$mode" == branch ]]; then
  container_exec bash "$installer" /opt/authorized-source authorize
  session_exec 'kbuildsycoca6 --noincremental >/dev/null 2>&1; python3 /opt/authorized-source/infra/webtop/authorized-capture/fixtures/check-helper.py authorized'
fi
run_dir=$(container_exec mktemp -d /tmp/authorized-demo.XXXXXX)
container_exec chown 1000:1000 "$run_dir"
cleanup() {
  container_exec sh -c "if test -f '$run_dir/real-helper'; then cp '$run_dir/real-helper' /usr/local/libexec/mastra-cc-kwin-capture.restore; chmod 755 /usr/local/libexec/mastra-cc-kwin-capture.restore; mv /usr/local/libexec/mastra-cc-kwin-capture.restore /usr/local/libexec/mastra-cc-kwin-capture; fi"
  session_exec "for file in '$run_dir/daemon.pid' '$run_dir/fixture.pid'; do if test -f \"\$file\"; then kill \$(cat \"\$file\") 2>/dev/null || true; fi; done"
  docker cp "$MASTRA_CC_WEBTOP_CONTAINER:$run_dir/daemon.log" "$proof_dir/$mode-daemon.log" || true
  docker cp "$MASTRA_CC_WEBTOP_CONTAINER:$run_dir/fixture.log" "$proof_dir/$mode-fixture.log" || true
  if [[ "$mode" == branch ]]; then
    container_exec bash "$installer" /opt/authorized-source revoke
    session_exec 'kbuildsycoca6 --noincremental >/dev/null 2>&1'
  fi
}
trap cleanup EXIT
container_exec python3 -c 'import json,os,sys; json.dump({"applications":[{"name":"authorized-capture-fixture","executable":os.path.realpath(sys.executable)}]},open(sys.argv[1],"w"))' "$run_dir/grants.json"
session_exec "rm -f /tmp/authorized-fixture-geometry.json /tmp/authorized-fixture-command.json /tmp/authorized-fixture-ack.json; QT_LINUX_ACCESSIBILITY_ALWAYS_ON=1 python3 /opt/authorized-source/infra/webtop/authorized-capture/fixtures/desktop.py >'$run_dir/fixture.log' 2>&1 & echo \$! >'$run_dir/fixture.pid'"
wait_for 'synthetic fixture geometry' 30 1 container_exec test -f /tmp/authorized-fixture-geometry.json
selector='env -u MASTRA_CC_ATSPI_CAPTURE'
[[ "$mode" != branch ]] || selector='env MASTRA_CC_ATSPI_CAPTURE=kwin'
session_exec "$selector /usr/local/bin/node '$DEPLOY/daemon/main.mjs' --backend atspi --socket '$run_dir/daemon.sock' --grants '$run_dir/grants.json' >'$run_dir/daemon.log' 2>&1 & echo \$! >'$run_dir/daemon.pid'"
wait_for 'installed daemon' 30 1 container_exec test -S "$run_dir/daemon.sock"
if [[ -n "${MASTRA_CC_RECORD_VIEWER:-}" ]]; then
  node "$WEBTOP_DIR/authorized-capture/record-viewer.mjs" "$MASTRA_CC_WEBTOP_PORT" "$proof_dir" "$mode"
fi
verdict=with
[[ "$mode" != base ]] || verdict=without
session_exec "MASTRA_CC_SOCKET='$run_dir/daemon.sock' timeout -k 2 45 /usr/local/bin/node '$DEPLOY/capture-client.mjs' '$mode'" | tee "$proof_dir/$verdict.txt"
if [[ "$mode" == base ]]; then
  session_exec 'timeout -k 2 10 xwd -root -silent >/tmp/base-xwd.bin 2>/tmp/base-xwd.err; result=$?; cat /tmp/base-xwd.err; test "$result" -ne 0 && test ! -s /tmp/base-xwd.bin && grep -q BadMatch /tmp/base-xwd.err' >"$proof_dir/base-xwd.txt"
fi
docker inspect -f 'IMAGE: {{.Config.Image}} {{.Image}}' "$MASTRA_CC_WEBTOP_CONTAINER" >"$proof_dir/$mode-environment.txt"
session_exec 'qdbus6 org.kde.KWin /KWin supportInformation' >>"$proof_dir/$mode-environment.txt"
container_exec cat "$run_dir/grants.json" >>"$proof_dir/$mode-environment.txt"
container_exec sha256sum "$DEPLOY/daemon/main.mjs" "$DEPLOY/transport/index.mjs" >"$proof_dir/$mode-artifacts.txt"
container_exec dpkg-query -W g++ pkg-config qt6-base-dev libqt6core6t64 libqt6dbus6 libqt6gui6 >"$proof_dir/$mode-packages.txt"
container_exec cat /tmp/authorized-fixture-geometry.json >"$proof_dir/$mode-fixture-geometry.json"
container_exec cat "$run_dir/grants.json" >"$proof_dir/$mode-grants.json"
container_exec sha256sum /opt/authorized-source/infra/webtop/authorized-capture/fixtures/desktop.py "$DEPLOY/capture-client.mjs" >"$proof_dir/$mode-fixture-hashes.txt"
if [[ "$scenario" == geometry ]]; then
  session_exec "MASTRA_CC_SOCKET='$run_dir/daemon.sock' timeout -k 3 45 python3 /opt/authorized-source/infra/webtop/authorized-capture/fixtures/scale-proof.py" | tee "$proof_dir/geometry-scale.txt"
  session_exec "MASTRA_CC_SOCKET='$run_dir/daemon.sock' timeout -k 2 45 /usr/local/bin/node '$DEPLOY/capture-client.mjs'" | tee "$proof_dir/geometry-recovery.txt"
  session_exec "MASTRA_CC_SOCKET='$run_dir/daemon.sock' timeout -k 2 90 /usr/local/bin/node '$DEPLOY/geometry-client.mjs'" | tee "$proof_dir/geometry-cases.txt"
  echo 'GEOMETRY: GREEN'
elif [[ "$scenario" == cleanup ]]; then
  docker cp "$WEBTOP_DIR/authorized-capture/cleanup-client.mjs" "$MASTRA_CC_WEBTOP_CONTAINER:$DEPLOY/cleanup-client.mjs"
  container_exec g++ -std=c++20 -Wall -Wextra -Werror /opt/authorized-source/daemon/native/kwin-capture/failure.cpp -o "$run_dir/failure-helper"
  container_exec cp /usr/local/libexec/mastra-cc-kwin-capture "$run_dir/real-helper"
  container_exec install -m 755 "$run_dir/failure-helper" /usr/local/libexec/mastra-cc-kwin-capture
  session_exec "MASTRA_CC_SOCKET='$run_dir/daemon.sock' timeout -k 3 60 /usr/local/bin/node '$DEPLOY/cleanup-client.mjs'" | tee "$proof_dir/cleanup-cases.txt"
  container_exec cp "$run_dir/real-helper" /usr/local/libexec/mastra-cc-kwin-capture
  session_exec "MASTRA_CC_SOCKET='$run_dir/daemon.sock' timeout -k 2 45 /usr/local/bin/node '$DEPLOY/capture-client.mjs'" | tee "$proof_dir/cleanup-recovery.txt"
  echo 'CLEANUP: GREEN'
fi
