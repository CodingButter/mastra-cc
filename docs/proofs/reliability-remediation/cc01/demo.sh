#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../../.."
node protocol/generate.mjs
pnpm turbo run build
pnpm --filter @mastra-cc/desktop exec vitest run src/__tests__/the-adapter-is-optional.test.ts src/__tests__/the-prose-keeps-what-a-desk-taught-it.test.ts
pnpm --filter @mastra-cc/daemon exec vitest run src/__tests__/a-picture-of-one-element-and-no-more.test.ts
node tools/freeze-gate.mjs
node scripts/check-docs.mjs
printf '%s\n' 'PROOF: GREEN — generated capture descriptions and deterministic visible-pixel fixtures; no live desktop claim'
