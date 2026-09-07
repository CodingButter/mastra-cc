#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../../.."
pnpm --filter @mastra-cc/desktop exec vitest run src/__tests__/signal-lifecycle.test.ts src/__tests__/the-desk-speaks-first.test.ts
pnpm --filter @mastra-cc/desktop exec tsc --noEmit
printf '\nPROOF: GREEN — controlled signal lifecycle and real-socket delivery\n'
