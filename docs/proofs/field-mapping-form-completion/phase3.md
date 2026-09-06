# Phase 3: real model task evidence

Acceptance: `m.CrBkmf`, five receipt trials followed by one ordinary `exo-desktop-item-edit` launcher task. Each uses a fresh private desktop and the real model, daemon, and generated tools. The receipt fixture/task/oracle are unchanged. Ordinary-app substitution follows ADR-0095; its inert launcher is never executed.

## All attempted candidate batches

| Batch | Attempted | Machine passes | Failure and changed hypothesis |
| --- | ---: | ---: | --- |
| m.A4VNF3 | 1 | 0 | Correct submission but no fresh confirmation verification after application replacement. Add bounded fresh observation/recovery guidance. |
| m.mAhpEr | 3 | 2 | Third trial used discovery as confirmation evidence; discovery does not satisfy required query/read-content proof. Require actual public value readback. |
| m.TbkXy3 | 2 | 1 | Second trial inferred success from Close-button/window state. Strengthen confirmation-content requirement before dismissal. |
| m.3kHuSR | 2 | 1 | Second trial captured a correct confirmation screenshot but lacked required public text readback. Distinguish screenshot corroboration from text verification; query window contents rather than only window metadata. |
| m.CrBkmf | 6 | 6 | Accepted after recording checkpoints and source-event comparisons were reviewed. |

Total: 14 candidate attempts, 10 machine passes and 4 verification failures; no invalid/provider/resource outcomes. Earlier partial passes are not pooled into acceptance. Three historical pre-goal RED runs remain under `../model-desktop-task-2026-09-06/`; total retained model attempts including those is 17. Each failed batch stopped immediately, and unrun trials are not successes.

## Accepted public evidence

| Trial | Intended values | Label query | Write calls | Submit | Fresh verification |
| --- | --- | ---: | --- | ---: | ---: |
| t1 | RCPT-bef9b6bb / 266.14 | 3 | 4, 5 | 6 | 8 |
| t2 | RCPT-8b0728e9 / 15.88 | 2 | 3, 4 | 5 | 6 |
| t3 | RCPT-86ddedaa / 165.37 | 2 | 3, 4 | 5 | 6 |
| t4 | RCPT-a1778f37 / 173.43 | 3 | 4, 5 | 6 | 8 |
| t5 | RCPT-1dadba50 / 20.23 | 3 | 4, 5 | 6 | 8 |
| t6 | Launcher-6471e7f3d7 / Comment-95a72c46b5 | 9 | 10, 11 | 13 | 15 |

Per-trial `events.jsonl` is the source; `ledger.json` copies publicly observed semantic IDs and links label observations to writes and later actual-value responses. Receipt confirmations contain exact receipt/total bytes and precede final model text. The ordinary saved file matches the independently calibrated complete serialization, including unchanged `/usr/bin/true`; the fresh reopened editor exposes both saved values through queryElements. Reopening is setup/readback, never a scripted task action.

`review.json` hashes the events, recording and three full-frame checkpoints. Visually reviewed `m.CrBkmf/review-1-3.png` and `review-4-6.png` show empty/initial fields, correctly filled fields, then exact confirmations or reopened saved values. Cropped contact sheets aid reading; full original frames and recordings remain. Frame extraction initially used a 100ms pre-action margin and caught an action transition; the final checkpoints use a 1000ms pre-action margin and were actually inspected. This changes no trial behavior.

## Reproduce and review

```sh
bash docs/proofs/field-mapping-form-completion/demo.sh model
# A complete machine batch exits 2 / REVIEW_PENDING, never unreviewed GREEN.
# Inspect all recordings and source-event comparisons, create honest review.json records,
# then validate the retained accepted batch:
node docs/proofs/field-mapping-form-completion/model-batch.mjs --review docs/proofs/field-mapping-form-completion/m.CrBkmf
node --test docs/proofs/field-mapping-form-completion/evidence.test.mjs
```

Review validation emits `PROOF: GREEN — five receipts and one ordinary app, reviewed`. New model execution is not guaranteed to repeat this result. Model remains google/gemini-2.5-flash, temperature 0, 24 steps, 180-second deadline. Batch predeclaration records 240-second trial and 1800-second batch bounds with 15-second kill grace, 256 MiB/trial and 2 GiB/batch caps, and execution-harness hashes. Per-trial metadata records instruction and built artifact hashes. A human-readable proof transcript is in `with.txt`; deterministic base failure is referenced in `without.txt`.

The acceptance review is performed by the execution agent, not final human approval. Phase 4 independent review and human handoff remain required. No general competence or reliability claim is made.
