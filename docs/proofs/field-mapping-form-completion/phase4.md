# Final field-mapping proof and limits

## Accepted evidence

Final model batch: **m.SQGqtM**, five consecutive receipt tasks plus one exo-desktop-item-edit launcher metadata task. All six independent machine checks pass and all six recording/checkpoint and actual-value comparisons were reviewed. `m.SQGqtM/outcome.json` is the reviewed result, not pooled successes from earlier batches. Model: google/gemini-2.5-flash, temperature 0, 24 steps, 180-second model deadline. Loaded instructions SHA256: `1bde87fd2c2f10172cf796993565b75982c0250f506b42f869159694af300410`.

The ordinary-app substitution is authorized in the local amendments and ADR-0095: direct-label support in Xfce's launcher editor, **not Mousepad Find/Replace coverage**. The inert launcher is saved and reopened, never executed. This is bounded observed completion, not statistical reliability or proof of inaccessible model reasoning. Deterministic base RED/candidate GREEN is the separate causal label-evidence proof.

## All attempted candidate sessions

| Batch | Attempted | Machine passes | Nonpassing outcome |
| --- | ---: | ---: | --- |
| m.A4VNF3 | 1 | 0 | Receipt verification missing |
| m.mAhpEr | 3 | 2 | t3 actual-value verification missing |
| m.TbkXy3 | 2 | 1 | t2 actual-value verification missing |
| m.3kHuSR | 2 | 1 | t2 screenshot did not satisfy public textual confirmation requirement |
| m.CrBkmf | 6 | 6 | Accepted Phase 3 batch; historical instructions |
| m.2giE49 | 6 | 5 | Ordinary task declined following unsuccessful observations |
| m.Gdighx | 6 | 5 | Ordinary setup-readiness timeout before model; raw runner classified FAIL |
| m.U61s32 | 6 | 5 | Ordinary task exhausted model steps without saving |
| m.OHtaPo | 6 | 5 | Ordinary task declined after window-only search |
| m.SQGqtM | 6 | 6 | Accepted final batch |

Total: **44 candidate sessions, 36 machine passes, seven functional failures and one setup-invalid session** (the last is retained as FAIL in its original runner output, not silently rewritten). The original three prompt-only RED runs remain separately under `../model-desktop-task-2026-09-06/`: 47 retained sessions including those baseline attempts. No provider outage was identified. Partial batches do not satisfy acceptance.

Retry hypotheses and historical instruction hashes remain in `phase4-gates/readiness-hypothesis.md`, `role-hypothesis.md`, and `dialog-hypothesis.md`; the older hashes describe their own failed batches, not the final candidate. The grants were not broadened. Readiness checks are bounded setup queries and convey neither labels nor answers to the model. Empty filtered results do not establish missing authority; actual refusals remain binding. Portable guidance now distinguishes dialog/window, text/textbox, and published editability operations.

## Inspect and reproduce

```sh
node docs/proofs/field-mapping-form-completion/model-batch.mjs --review docs/proofs/field-mapping-form-completion/m.SQGqtM
```

Expected: `PROOF: GREEN — five receipts and one ordinary app, reviewed`. This rechecks retained evidence, **not a new model execution**. For a fresh real run, use `bash docs/proofs/field-mapping-form-completion/demo.sh model`; successful machine completion exits REVIEW_PENDING until a real recording review is recorded, then run `model-batch.mjs --review NEW_BATCH`. A fresh provider run is not guaranteed to pass.

For causal proof, run `bash docs/proofs/field-mapping-form-completion/demo.sh deterministic`; expected base SETUP_OK/BASE_RED followed by candidate SETUP_OK/CANDIDATE_GREEN. `inspect` is non-model calibration and ends PROOF: EVIDENCE.

For each accepted t1–t6, inspect `events.jsonl`, `ledger.json`, `metadata.json`, `review.json`, `screen.mkv`, and `checkpoint-1.png` through `checkpoint-3.png`. Receipt `submission.txt` matches `expected.json` exactly; ordinary `launcher.desktop` plus `reopened-ms.txt` and public readback prove saved state. `review-1-3.png` and `review-4-6.png` are contact sheets, not substitutes for the full recordings. The four failed Phase 4 batches also have actually viewed `publication-review.png` sample sheets: only isolated fixture/editor content was visible; some late receipt frames are blank after closure, never reclassified as confirmation evidence.

## High-risk review paths

- `daemon/src/backends/atspi/labels.ts`: relation direction, ownership-before-name reads, protected-target rejection, target/text limits, shared outstanding-call slot and distinct timeout reasons.
- `daemon/src/backends/atspi/index.ts`: authorized application-root witness and public-operation budget; discovery unchanged.
- `daemon/src/backends/atspi/__tests__/labels.test.ts`: synthetic delayed native replies through real capture/replay wrappers, tape-close-before/after settlement, 100-field budget and concurrency coverage. These are explicitly synthetic tests, not claimed live tapes.
- `model-evidence.mjs`: strict external oracle, pre-action labels, selected IDs, post-submit actual-value observations before final text, unique six-trial declaration and declared-kind agreement.
- `model-driver.mjs` and `model-session.sh`: real public tools, unchanged model settings, isolated display/bus/home, single-app grant, no scripted model task actions.

Artifact hashes are checked separately against final built files; the retained `--review` checker validates hash presence and reviewed capture correspondence, not current build currency. Preserve this distinction. Base artifacts are built in a detached worktree and their hashes captured before cleanup; historical deleted base binaries cannot be rehashed afterward. Mutation and build gates must not run concurrently: `phase4-gates/concurrent-gates-invalid.md` records an invalid overlapping attempt and its serial replacement.

## Final serial gates and publication

The forced workspace build/lint/typecheck/test passed all 19 tasks (existing lint warnings remain); focused native tests passed 36, desktop 66, transport 97, and evidence controls 10. Both explicit TypeScript checks, generation, freeze, digest and documentation-link checks passed. `phase4-gates/serial-mutations.txt` records 228 mutations killed, none surviving. Final live causal proof is `deterministic.60cj4U` (base RED/candidate GREEN); final calibration is `inspect.ZUSSVO` (EVIDENCE, not agent success). The final inspection contact sheet was actually viewed on the private review browser and shows only the isolated receipt and launcher editor. New and failed runs remain retained.

Run `node docs/proofs/field-mapping-form-completion/check-current.mjs` from the repository root to reproduce every accepted runtime/instruction/harness comparison; detailed output is in `phase4-gates/current-artifacts.txt`. The check is read-only and not part of the model's tool set. No `.changeset/` exists. Receipt fixture/oracle, dependency manifests and lockfile compare unchanged to their recorded bases.

`phase4-manifest.json` inventories individual published paths and SHA256s. Logs containing trailing whitespace are published losslessly as `.raw.gz` instead of altering their bytes; the manifest maps original names to compressed paths and original hashes. Read them with `gzip -cd PATH.raw.gz`. Private HOME/runtime caches, local plans/review cache, unrelated artifacts and wallpaper remain excluded. Exact environment-secret scans passed; visual inspection and private-session provenance bound the publication review, not a claim of exhaustive forensic detection.

Final review findings and resolutions are retained unfiltered in the local phase stop report, never committed as review cache. Both final reviewers found no current code/evidence must-fix; their inability to run commands or independently view all recordings remains explicit. Human approval remains required; no PR is authorized by these measurements.
