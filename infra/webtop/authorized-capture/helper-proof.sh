#!/usr/bin/env bash
set -euo pipefail
[[ $# == 0 ]] || exit 2
export MASTRA_CC_WEBTOP_PROJECT=${MASTRA_CC_WEBTOP_PROJECT:-mcc-authorized-capture}
export MASTRA_CC_WEBTOP_PORT=${MASTRA_CC_WEBTOP_PORT:-13310}
[[ "$MASTRA_CC_WEBTOP_PROJECT" == mcc-authorized-capture || "$MASTRA_CC_WEBTOP_PROJECT" == mcc-authorized-capture-branch ]] || { echo 'refusing unrelated project' >&2; exit 2; }
source "$(dirname "$0")/../common.sh"
[[ "$MASTRA_CC_WEBTOP_CONTAINER" == "$MASTRA_CC_WEBTOP_PROJECT" && -c /dev/dri/renderD128 ]] || exit 2
COMPOSE+=(-f "$WEBTOP_DIR/authorized-capture/compose.gpu.yml")
if docker inspect "$MASTRA_CC_WEBTOP_CONTAINER" >/dev/null 2>&1; then
  [[ $(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$MASTRA_CC_WEBTOP_CONTAINER") == "$MASTRA_CC_WEBTOP_PROJECT" ]] || exit 2
fi
timeout -k 5 180 "${COMPOSE[@]}" up -d desktop
wait_for 'Plasma session' 60 1 session_exec 'test -n "$DBUS_SESSION_BUS_ADDRESS"'
docker inspect -f 'IMAGE: {{.Config.Image}} {{.Image}}' "$MASTRA_CC_WEBTOP_CONTAINER"
container_exec mkdir -p /opt/authorized-source/daemon/native /opt/authorized-source/infra/webtop
 docker cp "$ROOT/daemon/native/kwin-capture" "$MASTRA_CC_WEBTOP_CONTAINER:/opt/authorized-source/daemon/native/"
 docker cp "$WEBTOP_DIR/authorized-capture" "$MASTRA_CC_WEBTOP_CONTAINER:/opt/authorized-source/infra/webtop/"
installer=/opt/authorized-source/infra/webtop/authorized-capture/install.sh
fixture=/opt/authorized-source/infra/webtop/authorized-capture/fixtures/check-helper.py
revoke() {
  container_exec bash "$installer" /opt/authorized-source revoke
  session_exec 'kbuildsycoca6 --noincremental >/dev/null 2>&1'
}
trap revoke EXIT
container_exec bash "$installer" /opt/authorized-source build
container_exec bash /opt/authorized-source/daemon/native/kwin-capture/test.sh
container_exec stat -c 'INSTALL: %U %G %a %n' /usr/local/libexec/mastra-cc-kwin-capture
revoke
session_exec "python3 $fixture denied"
container_exec bash "$installer" /opt/authorized-source authorize
session_exec "kbuildsycoca6 --noincremental >/dev/null 2>&1; python3 $fixture authorized"
session_exec "python3 $fixture cleanup"
revoke
session_exec "python3 $fixture denied"
trap - EXIT
echo 'HELPER: GREEN'
