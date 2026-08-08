# ADR-0011 — The dashboard is Vite + Mastra playground UI, from commit one

**Status:** accepted
**Date:** 2026-08-08

## Context

The prototype's dashboard was Next.js 16 with a static export. It worked. It was also the wrong stack for what the dashboard is: a local configuration surface for a locally-running hub, which is a single-page application with no server rendering requirement and no deployment story.

Two things made this a real cost rather than a stylistic quibble.

**First, it did not look like the rest of the ecosystem.** Jamie's direction on 2026-08-07 was explicit: the UI must reuse Factory and Studio components and styles, specifically including the React Flow dynamic-workflow surface, which is the intended basis for the node-based skill editor (issue #189). A dashboard built on a different stack cannot borrow those components; it can only imitate them.

**Second, the migration became a gate on other work.** Once the rebuild was queued as issue #188, every UI change had to wait for it — PR #219 sat open, held, for the rest of the project, and issue #202 stayed open behind it. A stack decision deferred to day seven became a blocker on day seven.

The migration research (issue #188 triage) established what the move actually requires, and it is not trivial:

- `@mastra/playground-ui@47.0.0` (npm, Apache-2.0) transplants **only onto Vite**. It exports `./components/*`, `./primitives/*`, `./domains/*`, `./tokens`, `./theme.css`, `./style.css`.
- Factory's own sidebar is thin composition over that package, so adopting it is mostly deletion.
- The blocking cost is the **peer graph**: the package peers on React Query, the react-router-era routing stack, `@mastra/client-js`, `@mastra/react`, `@mastra/core`, Tailwind 4, and `lucide-react ^0.474.0`. The prototype's dashboard had none of the first four, and carried `lucide-react 1.28.0` — a different major line, meaning every icon import is a migration item and the version must be pinned *down*.

None of that gets cheaper by waiting. It gets more expensive with every component written against the old stack.

## Decision

**The dashboard is Vite + React from the first commit, built on `@mastra/playground-ui`, with the peer graph pinned before any dashboard feature is written.**

Specifically:

1. **Vite**, not Next.js. There is no server-rendering requirement; there is a strong requirement to consume a package that only works under Vite.
2. **The design system arrives by dependency**, not by copying. `@mastra/playground-ui` is a dependency; local components are thin composition over it.
3. **Where the Factory application layer is genuinely unpublished**, copy with the origin pinned in a comment naming the source commit — and record it, so the copy can be re-synced or dropped when it publishes.
4. **The peer graph is pinned in the first dashboard commit**, including `lucide-react` at the 0.474 line. Icon divergence is handled once, at the start, on an empty dashboard, rather than across dozens of files later.
5. **The build is a CI gate, separate from tests and typecheck.** The prototype shipped a dashboard where tests and typecheck were green while the build failed, because the bundler needed alias configuration the test runner did not read. A green suite is not a green build.

**One convention inherited from the prototype and worth keeping:** dashboard tests run in a Node environment with no DOM library. Logic that needs testing is extracted into pure functions and tested directly; rendering is checked by static markup rendering. This forced the prototype's enrolment walkthrough to be a pure state machine rather than sequencing buried in component effects, and that was strictly better code.

## Consequences

**Good.** The dashboard looks like Mastra because it *is* Mastra's component library. The React Flow surface needed for the node-based skill editor is available rather than aspirational. No mid-project migration, therefore no UI gate blocking unrelated work.

**Cost.** The first dashboard commit is heavier: a peer graph to resolve before there is anything on screen. This is the whole point — it is the same work either way, and it is cheapest when the dashboard is empty.

**Risk.** `@mastra/playground-ui` is versioned independently and its peer requirements will move. Mitigation: pinned versions recorded in `infra/` per [ADR-0001](0001-machine-config-lives-in-the-repo.md), and a scheduled job that reports when the pin drifts from what the package now wants.

## Evidence

| Claim | Source |
|---|---|
| prototype dashboard was Next.js 16 static export | `dashboard/package.json`, `next 16.3.0` |
| reuse Factory and Studio components, React Flow for the skill editor | Jamie, 2026-08-07 17:04; issue #189 |
| UI gate held PR #219 and issue #202 open | issue #188 gate; PR #219 open at pivot |
| playground-ui 47.0.0, Apache-2.0, Vite-only, export surface | issue #188 triage verdict |
| Factory sidebar is thin composition over the package | issue #188 triage verdict |
| peer graph and `lucide-react` major-line divergence (1.28.0 vs ^0.474.0) | issue #188 triage verdict; `dashboard/package.json` |
| tests + typecheck green while build broken; Turbopack alias fix | commit `0eade11` |
| dashboard tests run in Node with no DOM library | prototype dashboard vitest configuration |
| pure state machine for enrolment walkthrough | PR #226, `dashboard/src/lib/wake-walkthrough.ts` |
