# Runtime discovery repair — live acceptance BLOCKED

September 7, 2026. Installed inventory omitted directly granted runtime scope names when no installed/recipe identity matched. The server now appends only directly visible census names without inserting them into the launch permission index. Installed entries and grant sets are unchanged. Ambiguous native instances can still refuse; discovery is not unique-instance identification.

## Verification

- RED, before production edit: `pnpm --filter @mastra-cc/daemon exec vitest run src/__tests__/what-is-running.test.ts` — one regression failed, 27 passed; `regression-red.txt` is the retained earlier execution.
- GREEN, fresh final source: `pnpm --filter @mastra-cc/daemon exec vitest run src/__tests__/runtime-discovery-scopes.test.ts src/__tests__/what-is-running.test.ts` — 29 passed; `regression-green.txt`. Native backend replay is scripted accessibility evidence, not a live model task.
- `pnpm turbo run build lint typecheck test --force` — 19/19 tasks, zero cached; `workspace.txt`.
- `node --test docs/proofs/mousepad-verified-find-replace/evidence.test.mjs docs/proofs/mousepad-verified-find-replace/model-supervisor.test.mjs docs/proofs/mousepad-verified-find-replace/model-lifecycle.test.mjs` — 91 passed; `evidence-tests.txt`.
- `pnpm check-docs` and `git diff --check` — final results in `final-docs.txt` and `final-diff-check.txt`. The earlier `docs.txt` preserves a failed invocation using the wrong script path, not a passing gate.
- Independent discovery source review: two reviewers reported no must-fix defects. Reports retained in `reviews/`; source-only review is not execution proof. Suggestions remain optional coverage improvements for conflicting catalog aliases and normalized collisions.

## Rejected live attempt

Command: `MOUSEPAD_HYPOTHESIS='Directly granted runtime census names are discoverable without guessing catalog aliases or acquiring launch authority' node docs/proofs/mousepad-verified-find-replace/model-batch.mjs --run /tmp/mousepad-handoff.5Wd48F`.

All three trials failed; each driver log confirms HTTP 429 input-token quota exhaustion. No saved-file oracle passed. No visual acceptance is claimed. All attempt records report cleanup verified. The batch exited 1 and its declared runtime/instruction/harness hashes stayed unchanged. Build/mutation activity did not overlap this batch.

`rejected-quota-batch/` retains 72 original regular files (recordings, public journals, attempts, before/expected/actual documents, metadata and logs) plus SHA256 inventory. Private HOME/runtime directories and installed dependency trees are deliberately excluded. Paths embedded in original evidence remain original, so this is a retained rejected record, not a portable accepted review. Original full directory remains available at the path above.

The harness allocates a private Xvfb display, clears ambient desktop/bus/socket addresses, enters a new session bus, and uses private HOME/XDG state and a run-owned daemon socket. No shared desktop was driven. This is not a two-lane simultaneous-isolation proof. A post-run process listing found no process whose command contained the batch path, supplementary to supervisor cleanup evidence.

## Remaining gate

Restore approved-model quota and repeat a full predeclared batch, including genuine recording/checkpoint review. Then complete final acceptance review and the final-candidate mutation sweep. Unit tests do not waive these gates. See [follow-ups](../FOLLOWUPS.md).
