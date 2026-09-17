# Verified Mousepad Find/Replace — baseline

## Objective and provenance

A real agent must use the packed-and-installed desktop package and an isolated real Mousepad session to replace a literal token, save, and freshly verify the result. Independent checks must establish exact saved bytes, three replacements, and unchanged surrounding text across three predeclared randomized sessions. This is a bounded completion objective, not a general reliability claim; Phase 0 does not establish completion.

- Baseline date: September 6, 2026.
- Immutable DELIVERY_BASE: `4dbd8153d16405b3c84f36fafb8aeec677edf4fc`, verified by fetching `origin master`; identical to the research reference and PR #98 merge.
- Feature branch: `feat/mousepad-verified-find-replace`, in a separate worktree. The occupied original checkout and its unrelated files remain untouched.
- Prior work: [direct-label decision](../../02-DECISIONS/0095-explicit-labels-are-evidence-not-names.md) and [previous proof](../field-mapping-form-completion/phase4.md). That proof covered receipt forms and Xfce launcher editing, not Mousepad Find/Replace.
- Changed-area history identifies `55339eb` as direct-label implementation and `b60d8cd` as its final budget/replay hardening. No runtime or public contract changes belong to this baseline.

## Baseline verification

Fresh focused runs passed: native label tests 32/32; desktop adapter/prose tests 26/26; transport tests 97/97; historical evidence tests 10/10. Daemon and desktop `tsc --noEmit` both exited zero. The documented workspace build/lint/typecheck/test command passed 19/19 tasks, all cached; this is not fresh execution of every underlying test. Generation and installation succeeded without tracked dependency or lockfile changes.

Environment checks found Mousepad 0.6.1, Xvfb, private D-Bus, the executable AT-SPI bus launcher, Openbox, ffmpeg and ffprobe. A Google provider credential is present; provider authentication has not yet been exercised. No `.changeset/` directory exists at this baseline. No desktop interaction or provider request was made in Phase 0.

## Phase 1 — measured evidence, not agent completion

The [proposed composite decision](../../02-DECISIONS/0096-composite-containment-is-not-a-direct-label.md) records outcome (b): a separately named, bounded parent-context observation, awaiting explicit user approval. The product remains unchanged. Native menu-plus-text containment is measurable; it is not a direct label or semantic equivalence. The original single-child hypothesis is preserved and still rejected.

From the repository root, after the documented workspace build:

```bash
node --test docs/proofs/mousepad-verified-find-replace/evidence.test.mjs
bash docs/proofs/mousepad-verified-find-replace/demo.sh inspect
```

`inspect` packs three public packages, installs them outside the workspace, relocates the exact installed Mastra runtime dependency closure, retains its source lock and per-file consumer lock, and imports the public adapter. It then launches a private Xvfb/D-Bus/HOME Mousepad session and real matching daemon. All public observation calls execute through installed generated tools. Native calibration separately performs edits/save/reopen; no model or provider request occurs. Setup failures are INVALID. Success prints INSTALLED_CONSUMER_GREEN before EVIDENCE. This does not run a real-agent acceptance batch.

The full ordered Phase 1 gate transcript is `phase1/gates.txt`: the additional core pack/install/import smoke gate, 34 evidence tests, fresh `demo.sh inspect`, 32 label tests and documentation validation passed. Final live session: `/tmp/mousepad-inspect.yVuiUI`; pinned consumer: `/tmp/mousepad-install.PKLx9B/packed/consumer`. A preceding complete replayable calibration is `/tmp/mousepad-inspect.VLsOvQ`. Neither is agent completion.

`phase1/archives.json` inventories nine retained isolated attempt archives with original top-level filenames and hashes. Extract an archive into an empty directory to read native snapshots, raw exchanges, public calls/results, saved-byte inputs, recording and screenshots. HOME, runtime sockets and caches are excluded. `phase1/installed-provenance.tar.gz` retains all three tarballs, source pnpm lock, consumer file/dependency lock, npm manifest/lock and packing log. The npm lock covers tarball installation; `consumer-lock.json` additionally binds the relocated 151-package Mastra dependency closure and 8,702 installed inventory entries. The live consumer is retained locally for revalidation; the archive is provenance, not a falsely advertised ready-to-run full consumer.

To revalidate the retained live session (does not rerun calibration):

```bash
node docs/proofs/mousepad-verified-find-replace/inspect-evidence.mjs /tmp/mousepad-inspect.yVuiUI /tmp/mousepad-install.PKLx9B/packed
```

### Results and limitations

- Literal independent before/expected bytes contain three occurrences; saved bytes and fresh public readback match exactly. Unsaved disk bytes fail even when in-memory text is correct. Negative controls cover unchanged/partial/wrong-count/extra-byte/altered-surrounding output.
- Reciprocal containment is validated before filling, after filling and after process recreation, including same-application ownership, roles/interfaces, stale/defunct checks and distinct fresh bus identity. Original strict-witness rejection records remain in `evidence.json`.
- PNG signatures, dimensions, hashes and full decoder checks pass; recording frame counts/duration are recorded. **Genuine visual review was not performed**: image viewing returned bytes and the available browser could not start without a display. Media integrity is not visual inspection. No public screenshot-only field mapping is claimed.
- Attempts `inspect.NGN1xR` and `save.p8IorP` failed calibration-action selection assertions (duplicate Find/Replace entry points, then Save name matching). `inspect.k1uXPk` and `save.TdwNPp` are partial measurements. `reopen.YKlngv` is save/reopen calibration with incomplete public text coverage. `public-readback.TqaHNN` is setup-invalid from a shell brace-expansion copy failure; no product claim. `public-readback.UZUl2c` corrects that copy and public query coverage. Two subsequent `mousepad-inspect` archives rerun the completed harness. These are calibration iterations, never pooled model trials.
- During evidence-checker development, the first readback selector encountered query metadata containing document text. Its assertion rejected that as not `readElementContent`; selection now requires exact text content from that method plus preceding public ID provenance. A one-off inspection also used the wrong native snapshot suffix and failed ENOENT before reading evidence; corrected to the observed `.native.json` filenames. Neither failure is causal RED.

At the end of Phase 1, runtime/protocol implementation, real-agent completion, visual review and approval remained outstanding. The known window-close timing flake remains a separate follow-up. No push, PR or merge is authorized.

## Phase 2 — approved composite observation delivery

The accepted [composite decision](../../02-DECISIONS/0096-composite-containment-is-not-a-direct-label.md) is implemented in schema 1.21.0. `compositeObservation` remains separate from direct `labelObservation`. Its provenance literal is `immediate-combo-parent`, as approved to preserve the existing platform-neutral wire rule.

```bash
bash docs/proofs/mousepad-verified-find-replace/demo.sh deterministic /tmp/mastra-cc-mousepad-causal-base
```

The required argument is a clean worktree at the immutable DELIVERY_BASE above, with dependencies installed after protocol generation. The harness validates that commit, force-builds each side, packs independent installed consumers and runs identical calibration/public observation checks. Force builds avoid shared Turbo cache restoration of generated types from the other schema. An initial cached gate failed on a missing generated export; regeneration and a fresh forced workspace gate passed **19/19 tasks, zero cached**. The first base build also needed another frozen installation after creating the generated package. Both failures and successful retries are retained, not counted as RED.

Candidate delivery was verified first, then the base comparison, then both were freshly rerun with the one-paste wrapper. `phase2/mousepad-p2-deterministic.log.gz` (lossless gzip; use `zcat`) contains SETUP_OK on both sides, BASE_RED and CANDIDATE_GREEN. **The causal claim is only delivery of the new explicit bounded observation, not impossibility of completing the task on base.** Both sides independently replace/save/reopen successfully through native calibration. No model participates. Candidate labels identify two public text IDs before filling and after recreation, with subsequent actual content reads; filled readbacks distinguish the search token from its replacement without inventing direct labels.

`phase2/runs.json` records both final run and consumer paths. `phase2/base-run.tar.gz` and `phase2/candidate-run.tar.gz` retain top-level native/public transcripts, screenshots, recordings, exact-byte oracle inputs and verdicts. Matching installed-provenance archives retain tarballs and dependency/inventory locks, not a complete ready-to-run consumer. `phase2/inventory.json` binds these publications and gate logs by SHA256. HOME/runtime directories are excluded, and retained run files passed a scan for runtime credential values.

Verification: 37 composite tests (including complete tape replay and late replies with close before/after settlement), 32 direct-label tests, all workspace tests and both TypeScript checks passed. Seven focused composite/direct-label mutations were killed; this is not the full mutation table. Digest agreement, schema freeze, 34 evidence tests and documentation checks pass. The initial wrong documentation-script path was a command error; the actual `pnpm check-docs` passed.

**Still outstanding:** three predeclared real-agent sessions on final installed artifacts, provider execution, genuine visual review, full mutation/regression ship checks and independent review. No agent-completion or final approval claim is made by Phase 2.

### Offline Phase 3 review gate

`node docs/proofs/mousepad-verified-find-replace/model-batch.mjs --review <existing-batch-directory>` never runs a provider or writes reviews. Exit 1 means INVALID, exit 2 means REVIEW_PENDING, and exit 0 requires machine/oracle and visual checks; human approval remains PENDING separately. Current daemon, schema, instructions, lock and every proof script are independently rehashed against the predeclaration. Changed instruction/harness artifacts require a fresh batch, not edited historical declarations.

After actually inspecting media, a reviewer supplies each trial's `review.json`: `trialId`, nonempty `reviewer`, ISO `inspectedAt`, `batchDeclarationSha256`, `metadataSha256`, `eventsSha256`, `trialSha256`, `savedSha256`, `verificationCall`, and `limitations` (empty for acceptance). `recording` must name `screen.mkv` with `path` and `sha256`. `checkpoints` must contain distinct images in ordered stages `pre-action`, `filled`, `result`, `verified`, each with `path`, `sha256`, a substantive `comparison`, and `matches: true`. The filled checkpoint records `searchValue` and `replacementValue`; verified records `evidenceCall` matching the public trace. `verified` may represent fresh readback without reopening, since reopening is conditional, not a hidden harness action. Review must follow session completion and media creation. Missing/mutated artifacts, incorrect values, out-of-trial paths, premature inspection and unresolved limitations reject acceptance. This validates a recorded attestation; it does not automate or prove a person's act of inspection.

Run offline controls with `node --test docs/proofs/mousepad-verified-find-replace/evidence.test.mjs`. Synthetic fixtures are validator tests only, never live acceptance evidence. Retained batches Gd90kF and wD1xAR are not accepted; instruction changes already invalidated the former, and the latter has logged provider quota failures. No review records have been generated for either batch.
