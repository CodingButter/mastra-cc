#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
: "${TESTED_HEAD:=$(git rev-parse HEAD)}"
: "${TESTED_TREE:=$(git rev-parse HEAD^{tree})}"
printf 'TESTED_HEAD=%s\nTESTED_TREE=%s\n' "$TESTED_HEAD" "$TESTED_TREE"
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=8192}"
corepack enable
corepack prepare pnpm@10.23.0 --activate
pnpm install --frozen-lockfile
pnpm generate
pnpm --filter @mastra-cc/protocol-types build
pnpm --filter @mastra-cc/daemon build
pnpm --filter @mastra-cc/daemon typecheck
pnpm --filter @mastra-cc/daemon lint
pnpm --filter @mastra-cc/daemon test
pnpm --filter @mastra-cc/tools test
node tools/mutations.mjs
pnpm check-docs
