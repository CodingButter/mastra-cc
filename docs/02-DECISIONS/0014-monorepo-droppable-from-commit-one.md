# ADR-0014 — The repository is monorepo-droppable from commit one

**Status:** accepted
**Date:** 2026-08-08

## Context

The intended destination for this work is the Mastra monorepo. The prototype knew that and still grew a layout that could not be dropped in: a top-level `client/` that was actually the hub, a `plugin/` that was actually a client, a `service/` that was actually the core, and no shared package until day seven.

Fixing it took PR #227 — 179 files, 135 pure renames — on day seven, executed while five agents were actively working inside the directories being renamed. Every one of those branches hit file-location conflicts on its next pull. The rename also broke a sandbox setup command stored outside the repository, which made the fleet unable to provision new work while appearing healthy ([ADR-0001](0001-machine-config-lives-in-the-repo.md)).

The reshape itself was well executed — 135 of the changes were pure `git mv`, so history follows, and the protocol schema digest came through unchanged. That is the good version of a bad situation. The point is that the good version of a bad situation still cost a day and broke production.

The layout the reshape arrived at was correct, and it is essentially the layout in [01-ARCHITECTURE.md §3](../01-ARCHITECTURE.md). We are simply starting there.

## Decision

**The repository is laid out so that it can be dropped into the Mastra monorepo without a rename, from the first commit.**

Concretely:

1. **`apps/` and `packages/` conventions**, which is what the destination monorepo uses. Nothing at the top level is a product-specific noun that would collide.
2. **Every package has a scoped name** and its own `package.json`, `tsconfig.json`, test config, and typecheck script. A package that only builds as part of a bespoke root script is not droppable.
3. **No dependency on repository-root position.** No script resolves paths relative to a hard-coded top-level directory name. This is the same class of bug as the keeper shim that computed its root through a symlink and landed in `$HOME`.
4. **The Python daemon is a sibling, not a nested oddity.** It has its own environment, its own test lanes, and a documented reason it cannot be a workspace package.
5. **The full integration story is written before the code**, not derived after it — see [04-INTEGRATION-PLAN.md](../04-INTEGRATION-PLAN.md).

**And the corollary rule, which is the one that actually saves the day:** if a rename ever *is* necessary, it happens when no parallel work is in flight, it greps out-of-tree configuration for old paths first, and it proves itself by provisioning one fresh environment afterwards.

## Consequences

**Good.** The integration is a move, not a rewrite. Contributors learn one layout. There is no day-seven reshape competing with feature work.

**Cost.** More structure than a three-file prototype needs on day one, and a temptation to put things in a flat directory "for now". The prototype demonstrates what "for now" costs: 179 files, one production outage, and five branches broken mid-flight.

**Risk.** The destination monorepo's conventions can change. Mitigation: the integration plan is a document that gets re-checked, and the cost of adapting a correctly-layered repository to a new convention is small compared to the cost of untangling one that never had layers.

## Evidence

| Claim | Source |
|---|---|
| reshape scope: 179 files, 135 pure renames | PR #227 |
| history follows through the renames; schema digest unchanged | reshape verification, 2026-08-07 18:34 |
| five agents were working inside the renamed directories | branch probe, 2026-08-07 18:27 |
| conflicts hit on next pull | keeper test files landed into a renamed directory; resolved by moving them |
| rename broke an out-of-tree setup command | 2026-08-07 18:38, `cd: can't cd to plugin` |
| a script computed its root through a symlink and got `$HOME` | `bash -x` trace, 2026-08-07 21:16 |
| the reshaped layout is the right one | PR #227 final layout, adopted in [01-ARCHITECTURE.md](../01-ARCHITECTURE.md) |
