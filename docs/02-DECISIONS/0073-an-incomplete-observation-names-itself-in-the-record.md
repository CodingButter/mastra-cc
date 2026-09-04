# 0073 — An incomplete observation names itself in the record

- Status: accepted
- Date: 2026-09-04
- Supersedes: [0050](0050-the-record-names-the-refusal-not-the-sentence.md) in its rule that every translated backend error uses the server's wire-refusal class
- Relates to: [0042](0042-existence-is-readable-content-is-not.md), [0071](0071-a-deep-application-does-not-silence-the-desk.md), issue #49

## Context

ADR-0050 made audit refusal names a closed vocabulary and said a translated seam error should be recorded under the server's name for the refusal returned to the caller. ADR-0071 later made bounded AT-SPI walks fail with `IncompleteObservationError` when the tree cannot be observed completely. The daemon deliberately translates that error to the existing opaque `BACKEND_UNREADABLE_REFUSAL` on the wire, so callers cannot infer backend details.

That coarse wire sentence covers two materially different audit outcomes. An exhausted observation budget is an expected, named refusal to claim that a partial tree is complete. An arbitrary backend throw is an unclassified failure. Recording both as `failed`, or naming both `BackendUnreadable`, loses the distinction the backend made without improving wire compatibility.

## Decision

1. `IncompleteObservationError` during an observe-class request or launch is recorded as `refused:IncompleteObservation`.
2. The wire remains unchanged: both incomplete observations and residual backend failures return `BACKEND_UNREADABLE_REFUSAL`.
3. Other backend throws remain `failed`. They do not acquire a refusal class merely because the wire catch uses a coarse refusal sentence.
4. `IncompleteObservation` is part of the closed `REFUSAL_CLASSES` vocabulary. No error message, tree content, or budget detail enters the record.
5. This supersedes ADR-0050 only where that decision required the audit class to follow a translated wire refusal. Its seven-field record, closed vocabulary, and no-sentence rules remain in force.

## Consequences

The audit record can now distinguish a bounded observation that truthfully refused completeness from an unexpected backend failure, while clients see no protocol change. Launch and observe use the same classification rule, and arbitrary throws remain visible as failures rather than being laundered into a named refusal.

The cost is that audit vocabulary no longer mirrors wire refusal vocabulary one-for-one. Operators must understand that `refused:IncompleteObservation` and `failed` can both correspond to the same public `backend-unreadable` response. Adding the class also changes the closed audit vocabulary and therefore requires regression and mutation coverage.

## Evidence

- `daemon/src/server.ts` classifies `IncompleteObservationError` at the launch and shared observe audit boundaries while preserving `BACKEND_UNREADABLE_REFUSAL`.
- `daemon/src/audit.ts` includes `IncompleteObservation` in `REFUSAL_CLASSES`.
- `daemon/src/__tests__/a-bad-role-is-a-refusal.test.ts` pins the unchanged wire refusal and named audit outcome.
- `daemon/src/__tests__/the-audit-log-names-what-was-touched.test.ts` pins incomplete launch/read outcomes, the residual failed path, and the closed vocabulary.
- `tools/mutations.json` contains mutants that collapse incomplete launch or read outcomes back to bare failures.
