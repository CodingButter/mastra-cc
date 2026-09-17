# Separate bounded 32-step Mousepad experiment

September 7, 2026. The 24-step experiment repeatedly saved on its last step and could not perform mandatory post-save readback. This explicitly predeclared experiment allows 32 steps. It does not retroactively change a historical declaration or pool trials across batches.

The driver validates only 24/32, forwards the declaration's budget into `agent.generate`, and records that same budget in runtime metadata. Review rejects unapproved values and metadata mismatches. Model deadline remains 180 seconds; session/batch and artifact caps, authority grants, rate policy, exact saved bytes, fresh post-save UI evidence and visual review requirements are unchanged. The increased budget is an experimental change, not a claim that the 24-step acceptance gate passed.

Verification:

```sh
node --test docs/proofs/mousepad-verified-find-replace/evidence.test.mjs
node --test docs/proofs/mousepad-verified-find-replace/budget32/driver-budget.test.mjs
pnpm turbo run build lint typecheck test --force
node tools/mutations.mjs
pnpm check-docs
```

`tests.txt.gz` records 98 passing evidence tests. `driver-red.txt.gz` executes the new forwarding tests against a scratch copy of the previous driver and fails; `driver-green.txt` records three passes with the current driver. This smoke test executes the actual driver body with boundary dependencies stubbed; it is not live SDK or desktop proof. `workspace.txt.gz` records 19/19 forced tasks; `mutations.txt.gz` records 231 caught mutations.

## Live attempts

First complete batch: `/tmp/mousepad-budget32.89as9tuc`. Trials 1 and 2 saved exact bytes, passed fresh-document validation and finished normally. Trial 3 failed after eight calls with `Cannot connect to API: other side closed`; it did not save expected bytes. All cleanup verified. The complete batch remains rejected. The transport failure is not retried inside an already-partially-executed desktop trial.

Second complete batch: `/tmp/mousepad-budget32-retry.dofg5m5x`, separately declared on unchanged artifacts. Trial 1 encountered the same provider connection-closure failure after nine calls. Trials 2 and 3 saved exact bytes and passed fresh-document validation at calls 28 and 25; both finished normally. All cleanup verified. The full batch again remains rejected: successes are not pooled across batches.

`first/` and `retry/` each retain 75 independently hash-verified compressed artifacts, including executed driver/helper copies, summaries, recordings, metadata and journals; credential-pattern scans were clear. Batch logs and actual failing full-review receipts are also retained. No visual approval is inferred from machine passes.

The additional steps removed the observed save/readback cutoff in every normally finished trial, but this small uncontrolled sample is not a reliability estimate. The next bounded investigation is retrying a rejected provider fetch only before any response is returned, within the existing deadline and attempt budget. Do not replay the entire agent generation or desktop tool operation, and do not silently retry errors after streaming has begun. Native end-to-end notification and cancellation measurements remain separate source-verified follow-up work in the reliability worktree.
