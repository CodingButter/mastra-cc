# Field mapping: native evidence, not model success

Status: Phase 2 implements bounded native label observations with schema 1.20.0. The isolated deterministic base/candidate proof passes; no new model trials have run. Phase 1 recording review used a browser on a separate private Xvfb display, not the personal desktop.

## Run

```sh
bash docs/proofs/field-mapping-form-completion/demo.sh inspect
node --test docs/proofs/field-mapping-form-completion/evidence.test.mjs
```

Requires built daemon/desktop packages, Xvfb, private D-Bus, YAD, exo-utils, openbox, ffmpeg and ffprobe. No API key or model is used. An accepted run ends `PROOF: EVIDENCE`, not GREEN. Calibration is deliberately scripted setup; it is not permitted in the later model runner.

## Measured facts

- Receipt controls are unnamed. Traversal visits Total paid before Receipt number, but direct LABELLED_BY relations identify both without positional guessing.
- Setup calibration on the unchanged fixture produces exactly `CALIBRATION-7F29|123.45|\n`. Neither fixture nor its model oracle was changed.
- Mousepad and Pluma Find/Replace controls do not fit the narrow direct-text-label contract. Their failed feasibility measurements are retained.
- Replacement ordinary app: `exo-desktop-item-edit`, package exo-utils 4.18.0-1build4. Name and Comment are unnamed text controls with direct relations. Saving changes to a private inert launcher is independently checked byte-for-byte; the launcher is never executed or installed. The delegated substitution does not widen native label semantics.
- Public observations are collected through separately scoped real daemons and the built desktop client before and after setup edits.

## Evidence ledger

All `inspect.*` directories are setup/measurement attempts, never model trials. Preserve their outcomes, including early lookup/bound/menu failures and rejected apps; do not erase them when preparing publication. Current source has evolved, so older directories may not contain every artifact required by the final validator.

| Directory | Outcome |
| --- | --- |
| inspect.DrOogA | Pluma launch measured; setup used Mousepad menu name and failed. Measured Pluma menu name is Replace... |
| inspect.ilUOed | Pluma measured; no direct text LABELLED_BY associations for required pair; rejected |
| inspect.r5J5k7 | Exo direct labels measured; calibration/public observations not yet added |
| inspect.0GHLft | Both native measurements, public before/after observations and exact setup calibration pass; retained test fixture |
| inspect.pF79GR | Full current inspect validator passes; seven evidence tests pass; recording checkpoints visually reviewed |

Earlier Mousepad/relation-probe attempts remain in the other `inspect.*` directories. The three original failed model runs remain separately preserved under `../model-desktop-task-2026-09-06/` in checkpoint 0f8a14f.

Current recording: `inspect.pF79GR/screen.mkv` (8.3 seconds). Reviewed the 1fps contact sheet and extracted full-size checkpoints at 0.5s (Receipt number visibly above Total paid), 2.5s (actual calibration confirmation), 4.5s (ordinary launcher editor with initial Name/Comment), and 7.5s (reopened editor displaying both saved calibration values). These are setup-calibration observations, not model success. Checkpoints are retained as `checkpoint-<seconds>.png`; `publication-manifest.json` records their hashes. Native measurements, raw exchanges, field bounds, public results, setup action receipts, application executable hash, PNG captures, output files and visual hashes accompany it. `oracle.json` explicitly states zero model trials.

## Next gates

Phase 3 model trials and final independent review remain outstanding. `publication-manifest.json` inventories Phase 1 published files; `phase2-manifest.json` inventories the Phase 2 delivery. Private session home/runtime caches remain local and uncommitted.

## Phase 2 deterministic proof

Run `bash docs/proofs/field-mapping-form-completion/demo.sh deterministic`. Expected final signal: `PROOF: GREEN (base RED and candidate GREEN; no model trials)`.

| Directory | Outcome |
| --- | --- |
| deterministic.GBmz1F | INVALID: detached base dependency/build setup failed |
| deterministic.g1tuuI | INVALID: client/daemon handshake setup failed |
| deterministic.UbmhQh | INVALID: proof requested the wrong public role; zero matching fields |
| deterministic.iaMI2I | INVALID overall: base RED valid, candidate socket path setup failed |
| deterministic.DaiP2I | Accepted: SETUP_OK then base RED / candidate GREEN |

The accepted run uses unchanged fixture semantics, separately built base/candidate artifacts, and independent native calibration. Its public responses preserve empty names and calibrated content values; only the candidate exposes the matching explicit labels. Per-side metadata and transcripts are retained. Candidate artifact hashes were checked against the current build. Base worktree cleanup follows capture; recorded base hashes are historical build provenance, not a claim that the deleted artifacts can still be rehashed.

`phase2-gates/` retains gate output. The public-stack test uses deliberately synthetic response variants through the real server, transport, and generated tool executor: absent, available/multiple (including duplicate strings), available/empty, and unavailable. The native deterministic run is the separate live causality proof. Neither is model task completion.
