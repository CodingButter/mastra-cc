# ADR-0073 — An observation that ran out of budget names itself

**Status:** accepted
**Date:** 2026-08-28
**Amends [ADR-0050](0050-the-record-names-the-refusal-not-the-sentence.md) clause 2's set.**

## Context

The AT-SPI backend bounds a tree walk by depth, nodes per application, and total nodes. When one of those bounds is reached it throws `IncompleteObservationError` rather than returning a partial tree as though it were complete (`daemon/src/backend.ts:153`; `daemon/src/backends/atspi/index.ts:299,333,354,508,525`). Deliberate rethrow guards preserve that error until a request route can translate it (`daemon/src/backends/atspi/index.ts:363,532`; `daemon/src/server.ts:942`).

The caller already received the daemon's fixed backstop sentence, so no partial observation crossed the wire and no backend error text leaked. The audit record nevertheless said `failed`. That lost a distinction the daemon itself knew: this was not an unexplained throw, but a named refusal to answer from an incomplete walk.

ADR-0050 requires a translated seam error to be recorded under the server's name for it, not recovered by parsing a sentence. Its closed set contained `BackendUnreadable`, but no route ever assigned that name. Keeping a name no record could carry made the set claim more than the implementation did.

## Decision

`IncompleteObservation` is a server refusal class. When `IncompleteObservationError` reaches either request boundary that translates it — the observe catch in `handleRequest` or the launch catch around `decideOpenApplication` — the audit outcome is `refused:IncompleteObservation` (`daemon/src/server.ts:1064-1065,1287-1288`). The seam's `Error` suffix is not carried because the server hands the caller its own backstop constant; the record uses the server's name for that translation.

All other throws at those boundaries remain `failed`. `FAILED` continues to mean an attempted access that did not finish for a reason the route cannot classify (`daemon/src/audit.ts:200-206`).

`BackendUnreadable` leaves `REFUSAL_CLASSES` and `IncompleteObservation` takes its place (`daemon/src/audit.ts:108-151`). This is a one-for-one replacement: the closed vocabulary remains thirty names, nine classes translated by `performEffect` plus twenty-one server names. The wire does not change. Both incomplete observations and residual backend failures still return `BACKEND_UNREADABLE_REFUSAL`; the finer distinction exists only in the internal audit class, which `withoutInternals` strips before serialization.

## Consequences

**Good.** An auditor can distinguish a bounded walk that honestly refused to pretend completeness from an unexplained backend failure. The same condition has the same outcome whether it occurs during an observe request or while launch searches for an application. The dead set member is gone, so every name in the closed vocabulary is one a route can carry.

**Cost.** A caller still cannot distinguish "the platform could not be read" from "the tree was too large to finish." In particular, the daemon cannot yet tell a client to retry with a narrower query. Adding a distinct wire refusal later remains additive; this decision does not claim that protocol behavior.

**Pressure exposed.** A global traversal budget will make incomplete observations more common. Naming them makes that pressure measurable without putting traversal limits, application names, or backend sentences in the audit file.

## Evidence

- `daemon/src/__tests__/the-audit-log-names-what-was-touched.test.ts` drives the real dispatch and reads the JSONL file back. Tests 7c and 8d pin `refused:IncompleteObservation` for launch and observe; test 8e pins the residual failed path; test 9 restates the complete vocabulary. The suite reports 18 passing tests.
- `tools/mutations.json` entries `the-incomplete-read-recorded-as-a-bare-failure` and `the-incomplete-launch-recorded-as-a-bare-failure` each replace the named outcome with `FAILED`. Each mutation makes two tests red.
- The full mutation table reports `ok - 157 mutation(s), none survived`.
- `node scripts/check-docs.mjs` reports every relative link resolves.
