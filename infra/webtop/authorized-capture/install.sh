#!/usr/bin/env bash
set -euo pipefail
# Operator-only entrypoint, executed inside the disposable Webtop container.
[[ $(id -u) == 0 && $# == 2 ]] || { echo 'usage (root): install.sh /absolute/source-root build|authorize|revoke' >&2; exit 2; }
root=$1
[[ "$root" == /* && -f "$root/daemon/native/kwin-capture/build.sh" ]] || exit 2
native="$root/daemon/native/kwin-capture"
case "$2" in
  build)
    timeout -k 5 300 apt-get update
    timeout -k 5 300 apt-get install -y --no-install-recommends g++ pkg-config qt6-base-dev
    output=$(mktemp)
    trap 'rm -f "$output"' EXIT
    bash "$native/build.sh" "$output"
    install -d -o root -g root -m 755 /usr/local/libexec
    install -o root -g root -m 755 "$output" /usr/local/libexec/mastra-cc-kwin-capture
    ;;
  authorize)
    test -x /usr/local/libexec/mastra-cc-kwin-capture
    install -o root -g root -m 644 "$native/mastra-cc-kwin-capture.desktop" /usr/share/applications/mastra-cc-kwin-capture.desktop
    ;;
  revoke)
    rm -f /usr/share/applications/mastra-cc-kwin-capture.desktop
    ;;
  *) exit 2 ;;
esac
