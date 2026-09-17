# Original 24-step acceptance — repaired batch GREEN, human approval pending

**Current status (September 7, 2026, 21:40 EDT).** After the first 24-step batch below was rejected, the journals showed the real cause: trials 1 and 2 spent their 24 interactions on redundant search-field readbacks and an unrequested menu and never reached Save; the scope and case checkboxes had started unchecked in every trial and were checked correctly. (An earlier hypothesis that already-checked boxes were being toggled off was wrong; the retained `filled.png` checkpoints show both boxes unchecked before activation.) The repair is an instruction change in `AGENT-INSTRUCTIONS.md`: activate a checkbox only when its observed state differs from what the task needs, and spend no interactions on menus or options the task did not ask for because the budget must still cover Save and post-save readback. `the-prose-keeps-what-a-desk-taught-it.test.ts` pins both sentences (RED when reverted, GREEN restored).

A fresh predeclared batch `/tmp/mousepad-original24-fix.om1tV6` (`MOUSEPAD_MODEL=anthropic/claude-sonnet-4-5-20250929 MOUSEPAD_MAX_STEPS=24`, bounded provider recovery, no pooling) passed:

| Trial | Machine | Saved bytes | Fresh readback | Public calls | Visual | Human |
|---|---|---|---|---|---|---|
| t1 | GREEN | exact | call 23 | 23 | COMPLETE | PENDING |
| t2 | GREEN | exact | call 21 | 21 | COMPLETE | PENDING |
| t3 | GREEN | exact | call 22 | 22 | COMPLETE | PENDING |

`model-batch.mjs --review` reports `GREEN`. Visual inspection is frame-sampled, not native video: `visual-inspect.py` cuts the four checkpoints from the actual MKV at journal times and sends them with a 1 fps contact sheet of the whole recording to Claude Sonnet 4.5 (a valid Gemini credential was not available); `assemble-reviews.py` copies every inspector limitation verbatim into `resolvedObservations` with the oracle that owns it, and Wren viewed the full-resolution checkpoints directly (the inspector's "asterisk at verified stage" claim for t1 is contradicted by the retained image). `accepted-batch/inventory.json` indexes 104 independently hash-verified artifacts; credential-pattern scan clear. Human approval remains pending.

---

# First original 24-step attempt — REJECTED (retained for the diagnosis above)

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
