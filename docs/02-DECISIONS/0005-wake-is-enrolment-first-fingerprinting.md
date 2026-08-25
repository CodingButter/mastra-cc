# ADR-0005 — Wake is enrolment-first fingerprinting, not transcription

**Status:** superseded for admission by [ADR-0053](0053-phrase-wake-gates-a-client-owned-voice-session.md) on 2026-08-25; the rejection of transcription-as-wake and the historical measurements remain valid
**Date:** 2026-08-08

## Context

The prototype's first wake implementation ran a speech-recognition model on-device and matched the transcript against the wake phrase. It did not work, and it did not fail randomly — it failed *at the source*. The model heard *"hey mastra"* and produced **"He master."** No amount of matching logic downstream can recover a phrase the recogniser never produced. An interim band-aid that also accepted "he" shipped, which is exactly the kind of fix that tells you the approach is wrong.

The model was also 26 MB of weights in the widget, roughly 80 MB installed. Removing it deleted seven files.

The replacement is a fingerprint matcher: score incoming audio against a bank of templates by shape, with no transcript anywhere in the decision. The header of that module states the design in one line — *shape, not a transcript*.

**What the measurements actually said**, and these are the numbers that justify the decision:

| Configuration | Result |
|---|---|
| Default bank only (22 factory templates), zero false accepts | admits **24 of 66** held-out true takes — 36% |
| Default bank only, tuned for 90% recall | 24 false accepts |
| Per-voice enrolment, 10 takes, zero false accepts | admits **82%** of that person's own unseen takes |
| Enrolled speaker's own median score | 16.99 |
| A different speaker against that bank | 0 of 2 |

The conclusion the prototype drew is the right one and should be quoted rather than paraphrased: *the bank gets a person to the enrolment page; their own takes are what makes this work.*

Operating constants as measured: threshold **20**, enrolled-template weight **1.15** (effective bar ≈ 20.7, bought roughly 71% own-voice recall at three false accepts in 1,350 — a trade the user opts into by recording themselves), score floor at twice the threshold, **5** takes per enrolment, at most 16 templates retained.

Two implementation lessons were paid for in live debugging:

- **The fingerprint must be window-invariant.** Scoring drifted with the recording window until enrolment was made a pure function over frames. The rule it produced: *the phrase, not the window it was recorded in.*
- **The template bank must be re-fetched, not snapshotted at boot.** The widget loaded templates once at startup, so a person could record five fresh takes and the live detector would keep scoring against the old bank until the app was restarted. This looked exactly like "enrolment doesn't work."

## Decision

1. **No transcriber ships in any client.** Enforced by boundary test B9: no `transformers`, no worker-based recogniser, no `transcribe`, in any client source. The prototype's version of this test also has to strip comments first, since the file explaining why the transcriber is gone would otherwise fail it.
2. **Wake detection is fingerprint matching on-device**, with a factory bank for cold start and per-user enrolment as the thing that actually makes it work.
3. **Enrolment is a guided walkthrough** — one Start control, an audible cue, a countdown, auto-advance through five takes, per-take re-record. Landed in the prototype as PR #226. The cue must finish before the first kept sample, or the gate learns the beep.
4. **Enrolment produces window-invariant fingerprints** — a pure function over frames.
5. **The live detector re-fetches templates** rather than holding a boot snapshot.
6. **A detector with no templates is deaf, not trigger-happy.** Any failure to load the bank yields a detector that never opens. The prototype's comment on this is the correct default and should survive: *a detector with no templates is deaf — the closed direction.*
7. **Enrolment lives in the dashboard, not the widget.** Recording UI belongs where there is room for it.

## 5. The open sub-decision

**Measured and live disagree, systematically.** On the live microphone, the enrolled speaker scored **20.4 – 21.3** against their *own* templates — just over a threshold of 20 — while template-to-template distances among those same enrolments sat at 12 – 18. That offset is too consistent to be chance.

The suspect is that the enrolment page and the live gate were built as two capture paths. On paper they match (same constraints, same fixed sample rate); in practice they were written at different times, in different packages, and only one of them was ever measured.

**Decision taken, 2026-08-08:** build the capture path **once**, in `packages/voice`, consumed identically by the enrolment page and the live gate, then re-measure the whole table above against the live path. Carry the measurements forward as prior expectations; carry no capture code. Do not port the threshold as a constant until the rig that produced it is the rig that runs.

Do **not** respond to the offset by raising the threshold. That is how the prototype got to 20 in the first place, and the fact that it needed raising twice is the signal that something upstream is inconsistent.

## Consequences

**Good.** 80 MB smaller, no words in a decision that does not need words, and a privacy story that is trivially true: the wake decision is a distance between two shapes, and nothing writes down what was said.

**Cost.** Enrolment is mandatory for good behaviour, so the first-run experience has a recording step in it. The factory bank exists to make step one survivable, not to be the product.

**Known limitation, stated honestly.** Fingerprinting is speaker-specific by design. A household with three people needs three enrolments. That is a feature for arbitration and a chore for onboarding.

## Evidence

| Claim | Source |
|---|---|
| recogniser produced "He master." | live capture, 2026-08-07 13:17; transcription abandoned same timestamp |
| 26 MB model, ~80 MB installed, 7 files deleted | commit `5f389bc`, widget gate cut |
| default bank 24/66 at zero FA; 24 FA at 90% recall | `measure-wake-bank.mjs` run |
| enrolment 82% own unseen takes at zero FA; own p50 16.99; other speaker 0/2 | `measure-wake-enrolled.mjs` run |
| threshold 20 | `fingerprint.ts:64` |
| enrolled weight 1.15, effective bar ≈20.7, 3 FA in 1,350 | enrolment weighting measurement |
| score floor = 2× threshold; 5 takes; max 16 templates | `enrollment.ts:34`, `enrollment.ts:49`, `templates.ts:43` |
| window-invariance fix | `bfe6a84`, enrolment made pure over frames |
| boot-snapshot bug and re-fetch fix | widget `ears.js` `loadWakeWord`, fixed 2026-08-08 02:06 |
| guided walkthrough with cue and countdown | PR #226 (closes issue #222) |
| live scores 20.4–21.3 vs own templates; template-to-template 12–18 | live scoring session, 2026-08-08 02:09 |
| "a detector with no templates is deaf" | widget wake-templates handler comment |
