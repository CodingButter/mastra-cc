#!/usr/bin/env bash
set -euo pipefail

IMAGE='lscr.io/linuxserver/webtop:ubuntu-kde@sha256:d91fb284794d554d89b4b210ebe56a538c755dfb2054a3741ed7471363cd5369'
CONTAINER="${MASTRA_CC_WEBTOP_CONTAINER:-mcc-webtop-portability}"
if test -n "${DOCKER_HOST:-}" && test ! -S "${DOCKER_HOST#unix://}" && test -S /var/run/docker.sock; then
  DOCKER_HOST='unix:///var/run/docker.sock'
else
  DOCKER_HOST="${DOCKER_HOST:-unix:///var/run/docker.sock}"
fi
SOCKET='/config/.XDG/mastra-cc/portability.sock'
DEPLOY='/opt/mastra-cc'
DAEMON_LOG='/tmp/mastra-cc-portability.log'
PID_FILE='/tmp/mastra-cc-portability.pid'
CONFIG_VOLUME='mcc-webtop-portability-config'
OWN_CONTAINER=0
export DOCKER_HOST

fail() {
  printf 'PORTABILITY: RED - %s\n' "$*" >&2
  exit 1
}

container_exec() {
  docker exec "$CONTAINER" bash -lc "$1"
}

session_exec() {
  docker exec -u 1000 "$CONTAINER" bash -lc "export DISPLAY=:1 XDG_RUNTIME_DIR=/config/.XDG; export DBUS_SESSION_BUS_ADDRESS=\$(tr '\\0' '\\n' </proc/\$(pgrep -n plasmashell)/environ | sed -n 's/^DBUS_SESSION_BUS_ADDRESS=//p'); $1"
}

stop_daemon() {
  container_exec "if test -f '$PID_FILE'; then kill -TERM \$(cat '$PID_FILE') 2>/dev/null || true; fi; rm -f '$SOCKET' '$PID_FILE' '$DAEMON_LOG'" >/dev/null 2>&1 || true
}

cleanup() {
  stop_daemon
  if test "$OWN_CONTAINER" = 1; then
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

expected_image="$(docker image inspect --format '{{.Id}}' "$IMAGE")"
if ! docker inspect "$CONTAINER" >/dev/null 2>&1; then
  docker run -d --name "$CONTAINER" --shm-size=1g --security-opt seccomp=unconfined \
    -e PUID=1000 -e PGID=1000 -e TZ=Etc/UTC \
    -e QT_ACCESSIBILITY=1 -e QT_LINUX_ACCESSIBILITY_ALWAYS_ON=1 -e GTK_MODULES=gail:atk-bridge \
    -v "$CONFIG_VOLUME:/config" "$IMAGE" >/dev/null
  OWN_CONTAINER=1
fi
actual_image="$(docker inspect --format '{{.Image}}' "$CONTAINER")"
test "$actual_image" = "$expected_image" || fail "container $CONTAINER is not running the pinned image"

atspi_ready=0
for _ in $(seq 1 90); do
  if container_exec 'test -S /config/.XDG/at-spi/bus_1'; then atspi_ready=1; break; fi
  sleep 1
done
test "$atspi_ready" = 1 || fail 'the KDE session accessibility bus did not become ready'
if ! container_exec "test -x /usr/local/bin/node"; then
  docker cp "$(command -v node)" "$CONTAINER:/usr/local/bin/node"
fi
container_exec "/usr/local/bin/node --version >/dev/null" || fail 'the deployed Node runtime cannot execute'
container_exec "printf '#!/bin/sh\\necho \\\$\\\$ > /tmp/mastra-cc-owned.pid\\nexec sleep 300\\n' > /usr/local/bin/qt6ct && chmod +x /usr/local/bin/qt6ct"
session_exec "pgrep -x kate >/dev/null || (nohup kate >/tmp/mastra-cc-kate.log 2>&1 &)"

kate_ready=0
for _ in $(seq 1 30); do
  if container_exec 'pgrep -x kate >/dev/null'; then kate_ready=1; break; fi
  sleep 1
done
test "$kate_ready" = 1 || fail 'the unrelated Kate process did not start'

docker exec "$CONTAINER" mkdir -p "$DEPLOY/daemon/dist" "$DEPLOY/transport/dist"
docker cp daemon/dist/. "$CONTAINER:$DEPLOY/daemon/dist/"
docker cp packages/transport/dist/. "$CONTAINER:$DEPLOY/transport/dist/"
docker cp infra/webtop/portability-client.mjs "$CONTAINER:$DEPLOY/portability-client.mjs"

stop_daemon
session_exec "cd /tmp && /usr/local/bin/node '$DEPLOY/daemon/dist/main.mjs' --backend atspi --socket '$SOCKET' --grant kate >'$DAEMON_LOG' 2>&1 & echo \$! >'$PID_FILE'"

ready=0
for _ in $(seq 1 30); do
  if container_exec "test -S '$SOCKET'"; then
    ready=1
    break
  fi
  sleep 1
done
test "$ready" = 1 || { container_exec "cat '$DAEMON_LOG'" >&2 || true; fail 'daemon socket did not become ready'; }

container_exec "cd / && MASTRA_CC_SOCKET='$SOCKET' /usr/local/bin/node '$DEPLOY/portability-client.mjs' observe"
container_exec "cd / && MASTRA_CC_SOCKET='$SOCKET' /usr/local/bin/node '$DEPLOY/portability-client.mjs' refusal"

unrelated_kate_pid="$(container_exec "pgrep -o kate")"
container_exec "kill -TERM \$(cat '$PID_FILE')"
for _ in $(seq 1 10); do
  container_exec "! kill -0 \$(cat '$PID_FILE') 2>/dev/null" && break
  sleep 1
done
container_exec "kill -0 '$unrelated_kate_pid'" || fail 'daemon shutdown killed an unrelated desktop application'

stop_daemon
container_exec "rm -f /tmp/mastra-cc-owned.pid"
session_exec "cd /tmp && /usr/local/bin/node '$DEPLOY/daemon/dist/main.mjs' --backend atspi --socket '$SOCKET' --permit qt6ct --grant qt6ct >'$DAEMON_LOG' 2>&1 & echo \$! >'$PID_FILE'"
ready=0
for _ in $(seq 1 30); do
  if container_exec "test -S '$SOCKET'"; then ready=1; break; fi
  sleep 1
done
test "$ready" = 1 || fail 'launch daemon socket did not become ready'
container_exec "cd / && MASTRA_CC_SOCKET='$SOCKET' /usr/local/bin/node '$DEPLOY/portability-client.mjs' launch"
owned_pid="$(container_exec "cat /tmp/mastra-cc-owned.pid")"
test -n "$owned_pid" || fail 'permitted application was not spawned'
container_exec "kill -TERM \$(cat '$PID_FILE')"
for _ in $(seq 1 10); do
  if container_exec "! kill -0 '$owned_pid' 2>/dev/null"; then break; fi
  sleep 1
done
container_exec "! kill -0 '$owned_pid' 2>/dev/null" || fail 'daemon-owned application survived daemon shutdown'
container_exec "kill -0 '$unrelated_kate_pid'" || fail 'scoped shutdown killed unrelated Kate'

printf 'PORTABILITY: GREEN\n'
