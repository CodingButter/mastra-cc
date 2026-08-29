#!/usr/bin/env bash
set -euo pipefail

# CI step 9 (docs/05-TEST-STRATEGY.md:136): the integration dry run against the
# destination monorepo. M1's scope is the catalog-divergence check - the
# workspace's toolchain pins compared against the destination's live catalog
# (docs/07-ROADMAP.md:78). The full pristine-checkout rehearsal grows here in
# later milestones as packages gain destination consumers.

cd "$(dirname "$0")/.."
node tools/catalog-check.mjs
echo "dry-run-integration: ok - catalog aligned with the destination"
