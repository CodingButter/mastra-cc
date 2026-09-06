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

Runtime/protocol implementation, real-agent completion, visual review and approval remain outstanding. The known window-close timing flake remains a separate follow-up. No push, PR or merge is authorized.
