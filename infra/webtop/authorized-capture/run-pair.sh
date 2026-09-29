#!/usr/bin/env bash
set -euo pipefail
base= branch_root= proof_dir=
while (($#)); do
  [[ $# -ge 2 ]] || exit 2
  case "$1" in
    --base) base=$2;;
    --branch-root) branch_root=$2;;
    --proof-dir) proof_dir=$2;;
    *) echo "unknown argument: $1" >&2; exit 2;;
  esac
  shift 2
done
[[ "$base" =~ ^[0-9a-f]{40}$ && "$branch_root" == /* && "$proof_dir" == /* ]] || exit 2
[[ -f "$branch_root/infra/webtop/authorized-capture/demo.sh" ]] || exit 2
: "${MASTRA_CC_PLAYWRIGHT_ROOT:?point to an existing Playwright installation}"
export DOCKER_HOST=${DOCKER_HOST:-unix:///var/run/docker.sock}
export NO_COLOR=1
base_root=/tmp/core-webtop-authorized-base
[[ $(git -C "$branch_root" rev-parse "$base^{commit}") == "$base" ]]
# Refuse collisions before creating anything; cleanup will own only these new projects.
for mode in branch base; do
  project=mcc-authorized-capture-$mode
  ! docker inspect "$project" >/dev/null 2>&1 || { echo "existing container: $project" >&2; exit 2; }
  [[ -z $(docker ps -aq --filter "label=com.docker.compose.project=$project") ]] || exit 2
  [[ -z $(docker network ls -q --filter "label=com.docker.compose.project=$project") ]] || exit 2
  for volume in config workspace profile; do
    ! docker volume inspect "$project-$volume" >/dev/null 2>&1 || { echo "existing volume: $project-$volume" >&2; exit 2; }
  done
done
python3 - <<'PY'
import socket
sockets=[]
for port in (13311,13312):
    s=socket.socket(); s.bind(('127.0.0.1',port)); sockets.append(s)
PY
mkdir -p "$proof_dir"
run=$(mktemp -d "$proof_dir/pair-XXXXXXXX")
git -C "$branch_root" status --short >"$run/source-status.txt"
git -C "$branch_root" diff HEAD >"$run/source-diff.patch"
(cd "$branch_root" && find infra/webtop/authorized-capture daemon/native/kwin-capture -type f -print0 | sort -z | xargs -0 sha256sum) >"$run/proof-source-hashes.txt"
owned=()
cleanup() {
  local project
  for project in "${owned[@]}"; do
    MASTRA_CC_WEBTOP_PROJECT=$project MASTRA_CC_WEBTOP_CONTAINER=$project MASTRA_CC_WEBTOP_PORT=13311 \
      timeout -k 5 60 docker compose -p "$project" -f "$branch_root/infra/webtop/compose.yml" -f "$branch_root/infra/webtop/authorized-capture/compose.gpu.yml" down -v >>"$run/cleanup.log" 2>&1 || return 1
  done
}
trap cleanup EXIT
# Build artifacts are installed into containers; neither client imports product sources.
(cd "$branch_root" && node protocol/generate.mjs && pnpm install --frozen-lockfile && pnpm turbo run build) >"$run/branch-setup.log" 2>&1
for mode in branch base; do
  root=$branch_root
  port=13311
  if [[ "$mode" == base ]]; then
    if [[ ! -e "$base_root" ]]; then git -C "$branch_root" worktree add --detach "$base_root" "$base" >"$run/base-worktree.log" 2>&1; fi
    [[ $(git -C "$base_root" rev-parse HEAD) == "$base" && -z $(git -C "$base_root" status --porcelain) ]] || exit 2
    (cd "$base_root" && node protocol/generate.mjs && pnpm install --frozen-lockfile && pnpm turbo run build) >"$run/base-setup.log" 2>&1
    root=$base_root
    port=13312
  fi
  project=mcc-authorized-capture-$mode
  owned+=("$project")
  mkdir "$run/$mode"
  MASTRA_CC_WEBTOP_PROJECT=$project MASTRA_CC_WEBTOP_CONTAINER=$project MASTRA_CC_WEBTOP_PORT=$port MASTRA_CC_RECORD_VIEWER=1 \
    timeout -k 10 900 bash "$branch_root/infra/webtop/authorized-capture/demo.sh" --mode "$mode" --artifact-root "$root" --proof-dir "$run/$mode" >"$run/$mode-setup-and-diagnostics.log" 2>&1
  git -C "$root" rev-parse HEAD >"$run/$mode/source-sha.txt"
done
grep -qx 'PROOF: GREEN' "$run/branch/with.txt"
grep -qx 'PROOF: RED' "$run/base/without.txt"
grep -q BadMatch "$run/base/base-xwd.txt"
for suffix in packages.txt fixture-geometry.json grants.json fixture-hashes.txt; do
  cmp "$run/branch/branch-$suffix" "$run/base/base-$suffix"
done
for mode in branch base; do
  grep -E '^(IMAGE:|KWin version:|Qt Version:|Operation Mode:|Name:|Geometry:|Scale:|Compositing Type:)' "$run/$mode/$mode-environment.txt" >"$run/$mode/layout.txt"
done
cmp "$run/branch/layout.txt" "$run/base/layout.txt"
for video in "$run/branch/viewer.webm" "$run/base/base-viewer.webm"; do
  ffprobe -v error -show_entries stream=codec_name,width,height -show_entries format=duration -of json "$video" >"$video.metadata.json"
done
cleanup
owned=()
cp "$run/branch/with.txt" "$run/base/without.txt" "$run/branch/viewer.webm" "$proof_dir/"
printf 'BASE: %s\nHEAD: %s\nRUN: %s\n' "$base" "$(git -C "$branch_root" rev-parse HEAD)" "$run" >"$proof_dir/pair.txt"
(cd "$proof_dir" && find . -type f ! -name SHA256SUMS ! -name manifest-check.log -print0 | sort -z | xargs -0 sha256sum >SHA256SUMS && sha256sum -c SHA256SUMS >"$run/../manifest-check.log")
cat "$proof_dir/with.txt" "$proof_dir/without.txt"
echo 'PAIR: GREEN (installed branch GREEN; installed base RED)'
