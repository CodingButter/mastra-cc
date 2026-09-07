# CC-04 — bounded signal retention, core correction

## Runnable library demonstration

From the repository root after `pnpm turbo run build`:

```sh
node docs/proofs/reliability-remediation/cc04/demo.mjs .
```

`demo.mjs` imports the built public desktop/Mastra entry point. The source emits
synthetic events; the notification sink counts actual calls from the real provider.
It marks an observation boundary between first and last changes, then emits 1000 unique watches; it does not claim an actual agent observation.
A proxy records unexpected desktop reads. No native desktop, model, notification
persistence, or packed-install claim is made. There is no visual surface to record.

The same command with a second argument selecting a built pre-fix `00a9ad1`
worktree produces RED. Only the consumed build differs; the script is identical.

- `without.txt`: base, one notification (final change lost), 1000 leading attempts.
- `with.txt`: candidate, two notifications, 32 leading attempts and broad overflow
  invalidation. Both have zero desktop reads.
- `tests-without.txt.gz`: initial seven provider regressions against the original
  provider before edits: four failed, three passed. This is test evidence, not the demo.
- `final-provider-without.txt.gz`: all eight final provider regressions replayed in
  the pre-fix worktree: five failed, three passed.
- `fairness-without.txt.gz`: review-found starvation reproduced before queue rotation.
- `tests-with.txt.gz`: 38 passing focused provider/lifecycle/retention tests.
- `mutations.txt.gz`: initial 15 signal deletion mutations killed; superseded by
  the final full-sweep transcript when checking artifact currency.
- `full-mutations.txt.gz`: final sweep, all 240 mutations killed, including fair
  queue rotation (no starved pending work).
- `workspace.txt.gz`: forced build, lint, TypeScript checks, and tests: 19/19 tasks.
- Final priority-matrix expansion: `priority-matrix-without.txt.gz` replays all
  13 final provider cases on the base (10 failed, 3 passed).
  `final-tests-with.txt.gz`, `final-workspace.txt.gz`, and `final-mutations.txt.gz`
  are the final 43-test, 19-task and 240-mutation gates after this expansion.
- `review-priority-retraction.txt.gz`: the reviewer's incorrect low-to-medium
  promotion finding was withdrawn after source inspection and six passing
  priority permutations. Both reviewers found no remaining must-fix issue.

Hard retained-state bounds are established by deterministic unit inspection, not
RSS estimation: 10000 insertions each retain at most 256 keys plus one overflow
pointer. Idle expiry removes all state and the sole timer. Throttle disable keeps
no entries or timers. Retained pending values contain only copied protocol pointers.

## Limit

This slice does not claim immediate watch-end cleanup. The provider has no shared
watch-lifecycle callback; expiry bounds stale state, but unsubscribe may be followed
by an extra queued notification. The remaining lifecycle integration and real
framework final-observation semantics are explicit follow-ups in
[ADR-0099](../../../02-DECISIONS/0099-signal-throttling-retains-bounded-dirty-pointers.md).

## Artifact production

```sh
node docs/proofs/reliability-remediation/cc04/demo.mjs . > with.txt
node docs/proofs/reliability-remediation/cc04/demo.mjs /tmp/mastra-cc-cc04-base > without.txt 2>&1
pnpm --filter @mastra-cc/desktop exec vitest run src/__tests__/signal-throttle.test.ts src/__tests__/signal-retention.test.ts src/__tests__/signal-lifecycle.test.ts src/__tests__/the-desk-speaks-first.test.ts
node tools/mutations.mjs --table /tmp/cc04-mutations.json
pnpm turbo run build lint typecheck test --force
```

The focused mutation table is `tools/mutations.json` filtered to names beginning
with `signals-`. Compressed transcripts use `gzip -n` (no timestamp in headers).
