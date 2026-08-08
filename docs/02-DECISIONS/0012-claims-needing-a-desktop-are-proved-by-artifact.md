# ADR-0012 — Claims that need a desktop are proved by artifact

**Status:** accepted
**Date:** 2026-08-08
**Carried forward from the prototype. This is one of the things it got most right.**

## Context

Some of this system's most important claims cannot be checked by a unit test, because they are claims about a real desktop with a real person at it:

- *Keystrokes reach a field that has no other way in.*
- *A deletion is reported as a deletion, not merely as "a value changed".*
- *An unpermitted application is invisible, not blocked.*
- *The voice lane accepts this credential and refuses that one.*
- *Doing the task semantically costs fewer tokens than doing it from screenshots.*

The prototype's answer was a **proof artifact**: a script in `tools/` that runs against a live desktop and writes a markdown file into `docs/proofs/`. The artifact is committed; the claim is then a document with a procedure behind it rather than a sentence in a README.

Three details of how it was done make the difference between a proof and a reassuring file:

**A proof script that cannot prove writes nothing.** The token-cost proof exits with a distinct non-zero code and produces no artifact when it cannot complete. There is no partial artifact, no "estimated" number.

**Measurement is taken out of band from the thing being measured.** The deletion proof reads success from the desktop's own state rather than from the agent's report of its own success, because an agent reporting on itself is a claim, not evidence. The token-cost proof sums usage per step from a streaming log rather than from a summary field, having found that the summary field reported only the last step.

**The comparison leg can be refused.** The token-cost proof explicitly declines to produce a "roughly N times cheaper" figure it cannot defend, and there is a test that greps the output to make sure that phrasing cannot appear. A proof that overclaims is worse than no proof.

The cost of this discipline is real: two proof issues (#224, #232) sat open at the pivot precisely because they need a machine with a display and a person, and the honest thing to do was leave them open rather than fabricate the artifact. That is the system working.

## Decision

**Any claim that requires a live desktop is proved by a committed artifact, produced by a script in `tools/` that fails loudly rather than writing a weak result.**

Rules for a proof script:

1. **It edits nothing it does not have to.** The deletion proof finds an element, primes a watch, and waits for a human. The human types.
2. **It reads its result out of band** — from the desktop, the log, or the audit trail. Never from the agent's own account of what it did.
3. **It refuses to guess.** No estimated numbers, no comparison it cannot substantiate. Distinct exit codes for distinct failures, and no artifact on any of them.
4. **It states its own limits in the artifact.** What was exercised, what was not, on what hardware, on what date.
5. **It is re-runnable by a stranger.** The artifact names the command.

Rules for the repository:

- Proof artifacts live in `docs/proofs/` and are committed.
- A proof artifact is **invalidated by a dependency bump** where the proof depends on that dependency's behaviour. The prototype's `docs/proofs/README.md` names the packages whose bump requires the proof to be re-run — that convention stays.
- An issue whose acceptance criterion is a proof stays open until the artifact exists. It is not closed on the strength of an implementation that looks right.

## Consequences

**Good.** The claims that would otherwise be marketing become checkable. A reviewer can read the artifact and re-run the command. A dependency bump that silently changes behaviour is caught by re-running the proof rather than by a user noticing.

**Cost.** Proofs need a desktop and often a human, so they cannot be a CI gate. They are a release gate instead — see [07-ROADMAP.md](../07-ROADMAP.md), where each milestone's verification includes its proofs.

**Cost.** Some issues stay open for days waiting for someone to sit at a machine. The prototype had two such issues at pivot and one that needed about a minute of a human's time. Accepted: an open issue is honest; a closed one without its artifact is not.

## Evidence

| Claim | Source |
|---|---|
| existing artifacts | `docs/proofs/`: unpermitted-application, keystrokes-reach-a-field, which-credential-the-voice-lane-accepts |
| proof scripts | `scripts/prove-deletion-live.py`, `prove-keystrokes-live.py`, `prove-browser-visibility-live.py`, `prove-permissions-live.mjs`, `prove-token-cost.py`, `prove-voice-credential.mjs`, `prove-settings-seam.mjs` |
| token-cost proof: per-step usage from streaming log, not the summary field | PR #218 (closes issue #18) |
| exit codes 3/4 write no artifact; comparison leg refused; test greps for the forbidden phrasing | PR #218 |
| deletion proof reads success out of band, waits for a human | `scripts/prove-deletion-live.py`, issue #26 |
| earlier passive watch described all four value changes identically | issue #26 background — the reason the delta call is used instead |
| proofs invalidated by dependency bump | `docs/proofs/README.md`, added in PR #229 |
| proof issues left open for want of a desktop | issues #224, #232, open at pivot |
