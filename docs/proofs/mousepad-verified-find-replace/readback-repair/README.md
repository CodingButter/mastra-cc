# Protocol-shaped readback evidence and bounded completion guidance

## Diagnosis

The previous paced batch had two different failures, not one:

- t1's last call was Save (24). No document read followed it: genuinely missing fresh evidence.
- t2 spent calls 16–22 searching for a Replace All button/menu/combobox and capturing the dialog before enabling the observed scope checkbox. It exhausted 24 calls without saving expected bytes.
- t3 saved at call 19 and read the previously observed document text element at call 21. The response contained exact expected text, but `readElementContent` returns `{content: ...}`, not an element wrapper. The old validator recursively searched only objects with `id` and `role`, so discarded this valid response.

`ReadElementContentResult` in packages/protocol-types/src/index.ts exposes content without repeating element identity. The correction binds that content to the preceding public evidence for the requested ID. It still requires a known text/textbox target, a read after Save, exact full text, settled calls and correct independently saved bytes. Unknown IDs, window targets, wrong bytes, text-window partial content and pre-save reads remain rejected. The new positive regression fails before the fix and passes after it.

Retrospective inspection now accepts t3's machine trace at call 21; t1/t2 remain rejected. This does **not** reclassify the old batch: artifacts changed, that batch contains failures and no visual acceptance exists.

Mirrored agent instructions now budget saving/readback and explain the observed Mousepad scope toggle, requiring current public evidence and re-observation rather than invented button identities. Step and time limits, daemon grants, full saved-file oracle and visual requirements are unchanged.

## Verification commands

```sh
node --test docs/proofs/mousepad-verified-find-replace/model-evidence.test.mjs
node --test docs/proofs/mousepad-verified-find-replace/{evidence,model-supervisor,model-lifecycle,model-rate}.test.mjs
pnpm turbo run build lint typecheck test --force
node tools/mutations.mjs
pnpm check-docs
```

Receipts: `red.txt`, `green.txt`, `focused.txt.gz`, `workspace.txt.gz`, `mutations.txt.gz`. All 112 focused tests passed, forced workspace gates passed 19/19, and all 231 full-suite mutations were caught.

## Fresh batch outcome — still REJECTED

The unchanged-artifact batch `/tmp/mousepad-readback.8bxz7huw` made 72 requests without backoff. All three trials saved exact expected bytes and report verified cleanup. However, t1 used call 24 to save and had no post-save read. t2/t3 saved at call 22 and read exact document text at call 24; both machine traces now pass the corrected validator. All reached the 24-step limit. Full-batch review correctly exits 1 because t1 remains incomplete. This is improved behavior, not accepted completion or a controlled efficacy comparison.

`rejected-batch/` retains 73 hash-verified compressed artifacts, the batch log, and the rejected review receipt. No historical success is pooled; no visual approval is fabricated. Remaining Mousepad work is reducing at least one more interaction before final save/readback, plus the still-outstanding recording/checkpoint review and planned reopen requirements. Limits and oracles must not be relaxed to declare success.

As directed, work continued in the separate reliability worktree on CC-09 producer measurements: real-clock delivery latency, retained-pointer counts, event-loop delay and local stop timing. Those synthetic producer measurements do not establish end-to-end native notification latency, native queue bytes or native cancellation responsiveness.
