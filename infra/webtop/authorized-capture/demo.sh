#!/usr/bin/env bash
set -euo pipefail
mode= artifact_root= proof_dir=
while (($#)); do
  case "$1" in
    --mode|--artifact-root|--proof-dir)
      (($# >= 2)) || exit 2
      case "$1" in --mode) mode=$2;; --artifact-root) artifact_root=$2;; --proof-dir) proof_dir=$2;; esac
      shift 2;;
    *) echo 'unknown argument' >&2; exit 2;;
  esac
done
[[ "$mode" == branch || "$mode" == base ]] || exit 2
[[ "$artifact_root" == /* && "$proof_dir" == /* ]] || exit 2
[[ "$mode" == branch ]] || { echo 'base mode awaits paired-proof phase' >&2; exit 2; }
[[ -f "$artifact_root/daemon/dist/main.mjs" ]] || exit 2
export MASTRA_CC_WEBTOP_PROJECT=${MASTRA_CC_WEBTOP_PROJECT:-mcc-authorized-capture}
export MASTRA_CC_WEBTOP_PORT=${MASTRA_CC_WEBTOP_PORT:-13310}
[[ "$MASTRA_CC_WEBTOP_PROJECT" == mcc-authorized-capture ]] || exit 2
source "$(dirname "$0")/../common.sh"
[[ "$MASTRA_CC_WEBTOP_CONTAINER" == "$MASTRA_CC_WEBTOP_PROJECT" ]] || exit 2
mkdir -p "$proof_dir"
timeout -k 5 600 bash "$WEBTOP_DIR/authorized-capture/helper-proof.sh" >"$proof_dir/integration-helper.txt" 2>&1
copy_node_if_needed
ROOT=$artifact_root
copy_built_artifacts
container_exec mkdir -p "$DEPLOY/node_modules/@mastra-cc"
ws_dir=$(cd "$artifact_root" && node --input-type=module -e 'import {createRequire} from "node:module"; import {dirname} from "node:path"; import {realpathSync} from "node:fs"; console.log(dirname(realpathSync(createRequire(process.cwd()+"/packages/transport/package.json").resolve("ws/package.json"))))')
docker cp "$ws_dir" "$MASTRA_CC_WEBTOP_CONTAINER:$DEPLOY/node_modules/ws"
docker cp "$artifact_root/packages/protocol-types" "$MASTRA_CC_WEBTOP_CONTAINER:$DEPLOY/node_modules/@mastra-cc/protocol-types"
docker cp "$WEBTOP_DIR/authorized-capture/client.mjs" "$MASTRA_CC_WEBTOP_CONTAINER:$DEPLOY/capture-client.mjs"
installer=/opt/authorized-source/infra/webtop/authorized-capture/install.sh
container_exec bash "$installer" /opt/authorized-source authorize
session_exec 'kbuildsycoca6 --noincremental >/dev/null 2>&1; python3 /opt/authorized-source/infra/webtop/authorized-capture/fixtures/check-helper.py authorized'
run_dir=$(container_exec mktemp -d /tmp/authorized-demo.XXXXXX)
container_exec chown 1000:1000 "$run_dir"
cleanup() {
  session_exec "for file in '$run_dir/daemon.pid' '$run_dir/fixture.pid'; do if test -f \"\$file\"; then kill \$(cat \"\$file\") 2>/dev/null || true; fi; done"
  container_exec bash "$installer" /opt/authorized-source revoke
  session_exec 'kbuildsycoca6 --noincremental >/dev/null 2>&1'
}
trap cleanup EXIT
container_exec python3 -c 'import json,os,sys; json.dump({"applications":[{"name":"authorized-capture-fixture","executable":os.path.realpath(sys.executable)}]},open(sys.argv[1],"w"))' "$run_dir/grants.json"
session_exec "rm -f /tmp/authorized-fixture-geometry.json; QT_LINUX_ACCESSIBILITY_ALWAYS_ON=1 python3 /opt/authorized-source/infra/webtop/authorized-capture/fixtures/desktop.py >'$run_dir/fixture.log' 2>&1 & echo \$! >'$run_dir/fixture.pid'"
wait_for 'synthetic fixture geometry' 30 1 container_exec test -f /tmp/authorized-fixture-geometry.json
session_exec "MASTRA_CC_ATSPI_CAPTURE=kwin /usr/local/bin/node '$DEPLOY/daemon/main.mjs' --backend atspi --socket '$run_dir/daemon.sock' --grants '$run_dir/grants.json' >'$run_dir/daemon.log' 2>&1 & echo \$! >'$run_dir/daemon.pid'"
wait_for 'installed daemon' 30 1 container_exec test -S "$run_dir/daemon.sock"
session_exec "MASTRA_CC_SOCKET='$run_dir/daemon.sock' timeout -k 2 45 /usr/local/bin/node '$DEPLOY/capture-client.mjs'" | tee "$proof_dir/with.txt"
