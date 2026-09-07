# Original 24-step acceptance retry — REJECTED

This is a separate predeclared Anthropic batch with the bounded provider-recovery implementation and the original 24-step budget. It does not replace or weaken the successful 32-step experiment. The 180-second model deadline and exact saved-file/fresh public readback oracles are unchanged.

`model-batch.mjs` accepts only `MOUSEPAD_MAX_STEPS=24` or `32` (default 32), and records that choice in the declaration before running any trial. The driver and review already accept and enforce those two declared budgets. `budget.test.mjs` exercises the actual CLI for invalid budgets, including an empty value, and requires failure before installation or evidence-directory creation. Together with the existing budget32 driver tests, 9 tests pass.

The fresh batch `/tmp/mousepad-original24.48fm9nei` exited 1:

| Trial | Category | Saved bytes | Public calls | Cleanup |
|---|---|---|---|---|
| t1 | functional-failure | mismatch | 24 | verified |
| t2 | functional-failure | mismatch | 24 | verified |
| t3 | verification-pending | match | 24 | verified |

This is not a passing original-budget batch and no visual acceptance is claimed. The rejected-batch inventory retains 74 independently hash-verified artifacts, including declarations, model journals, recordings, attempts, and executed helper copies; credential-pattern scanning passed. Installation dependencies and trial home/runtime directories are excluded explicitly in the inventory. The private original saved files are retained as test fixture evidence, not substituted for public verification.

Run the regression with `node --test docs/proofs/mousepad-verified-find-replace/original24/budget.test.mjs docs/proofs/mousepad-verified-find-replace/budget32/driver-budget.test.mjs`. A new live retry uses `MOUSEPAD_MODEL=anthropic/claude-sonnet-4-5-20250929 MOUSEPAD_MAX_STEPS=24` and a securely supplied `ANTHROPIC_API_KEY`, then the normal batch runner with a fresh directory. Never reuse an attempt or join successes across batches.
