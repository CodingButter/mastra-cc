#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../../.."
node protocol/generate.mjs
pnpm turbo run build
pnpm --filter @mastra-cc/daemon exec vitest run src/__tests__/keys-that-went-to-the-other-window-of-the-same-name.test.ts src/__tests__/type-blind-read-back.test.ts src/__tests__/a-key-sent-while-another-application-holds-the-keyboard.test.ts
node tools/freeze-gate.mjs
node scripts/check-docs.mjs
printf '%s\n' 'PROOF: GREEN — scripted native typing is explicitly unverified and emits once; no live desktop claim'
