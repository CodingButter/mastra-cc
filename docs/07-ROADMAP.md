# 07 — Roadmap

**Structure:** milestones, in order, each with an **exit gate that can fail**. A milestone is not complete because the work feels done; it is complete because a named command exits zero or a named artifact exists on disk.

**Why gates:** the prototype closed issues on the strength of implementations that looked right, then discovered a keeper that had never been deployed and a setup command that could not run. A gate that cannot fail is a status update wearing a costume.

**Sequencing principle:** one author until the north star sentence works, then parallelise. → [ADR-0015](02-DECISIONS/0015-one-vertical-slice-before-parallel-agents.md)

---

## M0 — Documents

**Goal:** a fresh session can read this directory cold and build the right thing.

**Deliverables:** the nine documents in `docs/`, the ADR series in `docs/02-DECISIONS/`, `README.md`, and `CONTRIBUTING.md`.

**Exit gate:**
- [ ] Every internal link resolves (`tools/check-links.sh` exits 0).
- [ ] Every document's Receipts table has at least one entry per non-obvious claim.
- [ ] Jamie has reacted to the three open decisions in §"Open decisions" below.

**Status:** in progress.

---

## M1 — Skeleton

**Goal:** the repository shape, the toolchain, and the gates — with no features at all.

**Deliverables:**
- The layout in [01-ARCHITECTURE.md §3](01-ARCHITECTURE.md).
- `infra/apply.sh` and the unit files it installs.
- `protocol/schema.json` at v1.0 with the generator and golden fixtures.
- CI running all nine steps in [05-TEST-STRATEGY.md §7](05-TEST-STRATEGY.md), including the freeze gate and the integration dry run — passing on a nearly-empty tree.
- Catalog-aligned dependency versions per [04-INTEGRATION-PLAN.md §3](04-INTEGRATION-PLAN.md).

**Exit gate:**
- [ ] `turbo run build lint typecheck test` exits 0.
- [ ] `tools/dry-run-integration.sh` exits 0 against a pristine monorepo checkout, **including the catalog-divergence check**.
- [ ] The freeze gate **fails** on a deliberate one-character edit to `schema.json` with no ADR — verified by doing it and watching it go red.
- [ ] The generator determinism check **fails** on a deliberate hand-edit to a generated file — same method.
- [ ] `infra/apply.sh` runs clean on a fresh machine and the installed keeper-style script executes from its installed path.

**Note on the third and fourth items:** a gate is not proven by passing. It is proven by failing when it should. Do both, record both.

---

## M2 — The daemon reads

**Goal:** the accessibility layer, under scope, with attribution.

**Deliverables:**
- Daemon with transport, dispatch, scope enforcement, and one AT-SPI backend as separate modules.
- `observe` scope end to end; `edit`, `activate`, `submit` defined and refused.
- The change stream — the desktop talks first.
- Effect attribution: `external` versus a cause id.
- Deny-by-default application visibility.
- Both test lanes.

**Exit gate:**
- [ ] `--no-live` suite green in CI.
- [ ] Live suite green on bigbeast.
- [ ] Boundary pin B1 passes and **fails** when an accessibility import is added to a non-daemon package.
- [ ] Proof artifact: `an-unpermitted-application-is-invisible.md`, produced on real hardware.
- [ ] A refusal for an out-of-scope operation names the check that produced it.

---

## M3 — The hub thinks

**Goal:** an agent that can drive the daemon, with credentials it never hands out.

**Deliverables:**
- Hub with the transport package as its only daemon client.
- Minted, enumerated, read-only-by-default tool surface.
- Token minting with a short TTL and honest refusals for a missing account.
- Audit log with redaction.
- The four lane events.

**Exit gate:**
- [ ] Boundary pins B2, B3, B5 pass, and each **fails** under its mutation.
- [ ] Digest agreement check passes; **fails** when the transport's embedded digest is altered.
- [ ] A text-only integration test drives a real daemon to read a real element.
- [ ] Proof artifact: `which-credential-the-voice-lane-accepts.md`.
- [ ] The audit log for that run names every element touched and nothing else.

---

## M4 — The face

**Goal:** the tray widget, correct on a real multi-monitor desk.

**Deliverables:** the window model and hiding model in [ADR-0016](02-DECISIONS/0016-the-face-is-a-managed-window-that-hides-when-told.md), in full.

**Exit gate — all verified live on the two-monitor X11 desk, not asserted:**
- [ ] `xwininfo` reports the window managed (not override-redirect).
- [ ] `xprop` shows the always-on-top state and the window present in the stacking list.
- [ ] A raised full-screen window does not bury the face.
- [ ] Dragging moves the face from one monitor to the other; placement survives a restart.
- [ ] A click on the orb sends a gesture; clicks in the transparent region send nothing.
- [ ] Disabling from the tray unmaps the window and removes it from the window list.
- [ ] The face stays visible for the whole of a long `progress` sequence.

---

## M5 — Wake

**Goal:** the wake gate works on Jamie's actual microphone, and the number that says so was measured on the path that ships.

**This is the milestone with a known unsolved problem.** See [ADR-0005 §5](02-DECISIONS/0005-wake-is-enrolment-first-fingerprinting.md).

**Deliverables:**
- One capture path in `packages/voice`, consumed identically by the enrolment page and the live gate.
- Fingerprint matcher; window-invariant enrolment; live template re-fetch.
- Guided enrolment walkthrough with cue, countdown, auto-advance, per-take re-record, and a reset control.
- Factory bank for cold start.

**Exit gate:**
- [ ] The full measurement table from [ADR-0005](02-DECISIONS/0005-wake-is-enrolment-first-fingerprinting.md) **re-derived on the shipping capture path**, committed as `docs/proofs/what-the-wake-gate-admits.md`.
- [ ] Live scores against own templates sit **clearly inside** the threshold, with a stated margin. Not 0.4 outside it, and not fixed by moving the threshold.
- [ ] A fresh enrolment reaches the live detector **without restarting the widget** — demonstrated in the artifact.
- [ ] A second speaker is rejected.
- [ ] Boundary pin B9 passes and **fails** when a transcriber import is added — including one added only to a manifest.

**If the offset survives a single shared capture path, stop and investigate before tuning anything.** Raising the threshold is how the prototype stopped noticing.

---

## M6 — The north star

**Goal:** *"Tell me my most recent email."* Spoken, from across the room, answered aloud.

**Deliverables:** the end-to-end trace in [01-ARCHITECTURE.md §6](01-ARCHITECTURE.md), all nine steps. Voice session dial with a minted token; one semantic action against a real mail client; spoken answer; turn ends on silence or on a decline.

**Exit gate:**
- [ ] Proof artifact: `the-north-star-sentence.md`, produced on bigbeast, recording the phrase, the application, the elements read, and the spoken answer.
- [ ] The hub's audit log for that run shows the mail client and nothing else.
- [ ] A boundary check confirms no audio byte passed through the hub during the run.
- [ ] Saying *"no"* to a follow-up offer ends the turn and closes the microphone immediately.
- [ ] Re-waking starts a new conversation.

**This is the milestone that makes the project real.** Nothing below it is scheduled until it passes.

---

## M7 — Parallel

**Goal:** the factory rejoins, against a settled shape.

**Entry conditions, all required:**
- M6 passed with its artifact on disk.
- Agent platform pinned to a stable release, patches verified present. → [06-OPERATIONS.md §2](06-OPERATIONS.md)
- Board clean before the first dispatch.
- Every queued issue names its dependencies.

**Exit gate:**
- [ ] Ten agents complete work end to end with zero redundant dispatches.
- [ ] Zero merge-repair commits during the first wave.
- [ ] The keeper's live judgment shows requeues only for genuinely stalled rows.

---

## M8 — Ship one package

**Goal:** a stranger installs one `.deb` and reaches M6 in one sitting.

**Exit gate:**
- [ ] A clean Ubuntu VM installs the package and completes the six steps in [00-PRODUCT.md §10](00-PRODUCT.md).
- [ ] Performed by someone who did not build it.
- [ ] Every proof artifact re-run on the packaged build, not on a development tree.

---

## Deliberately not scheduled

Named so they are not mistaken for oversights, and so nobody re-derives them as new ideas.

| Item | When |
|---|---|
| Orb visual design beyond a legible face | after M6 |
| Phone client | after M6 |
| Node-based skill editor (prototype issue #189) | after M7; needs the dashboard's React Flow surface |
| Windows port (prototype issue #16) | after M8 |
| App-native integration, compositor access, vision, raw input | deferred tiers; [01-ARCHITECTURE.md §8](01-ARCHITECTURE.md) |
| Launch-an-application tool (prototype issue #183) | needs its own decision; the protocol method exists, the minted tool does not |

**The orb line is deliberate.** Four consecutive commits refined the prototype's orb — glass, wisps, smoke, reflection — in a single night, before the north star sentence worked. Visual work is scheduled after M6, on purpose.

---

## Open decisions

Three things Jamie needs to weigh in on. The stated position is the current recommendation, not a decision already taken.

1. **Wake capture.** Recommendation: port the *measurements*, rebuild the *capture path* once in one place, re-measure before trusting any constant. The alternative — porting the code as-is — inherits an unexplained offset.
2. **Vite plus the Mastra component library from commit one.** Recommendation: yes. This was the direction on 2026-08-07 that never landed because the migration became a gate on itself. → [ADR-0011](02-DECISIONS/0011-dashboard-is-vite-with-playground-ui.md)
3. **Carry versus retype.** Recommendation: carry the protocol schema, the proof artifacts, and the substantive prototype documents; retype everything else. Copying code copies the assumptions that made it wrong, and the prototype's four best documents — the generated tool API, the security model, the architecture notes, and the prototype notes — are worth migrating rather than re-deriving.

---

## Receipts

| Claim | Source |
|---|---|
| issues closed on implementations that looked right | keeper merged and never deployed; PR #225 vs cron state |
| the prototype's own gate printed a failure and exited 0 | widget gate behaviour |
| live window verification method | PR #228 live run on a 3840×1080 two-monitor X11 desk |
| wake measurement table and constants | [ADR-0005](02-DECISIONS/0005-wake-is-enrolment-first-fingerprinting.md) |
| live scores 20.4–21.3 vs a threshold of 20 | live session, 2026-08-08 02:09 |
| threshold was raised twice | 18 → 20, `fingerprint.ts:64` |
| boot-snapshot bug meant a fresh enrolment never reached the detector | widget `ears.js`, fixed 2026-08-08 02:06 |
| four orb visual commits in one night | 2026-08-04 |
| factory bumps drop local patches | pnpm patched dependencies keyed to exact versions |
| dispatch-before-cleanup produced redundant work | 2026-08-07 17:56–18:13 |
| existing proof artifacts to re-derive | `docs/proofs/` |
| Vite direction predates the pivot | Jamie, 2026-08-07 17:04 and 17:52 |
