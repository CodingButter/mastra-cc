# ADR-0021 — Standing authority is armable; attestation is never waivable

**Status:** accepted; **superseded in part 2026-08-09 by [ADR-0028](0028-trust-is-a-mode-and-the-default-asks-almost-nothing.md)**.
**Date:** 2026-08-08
**Extends [ADR-0008](0008-scopes-operation-classes-and-honest-refusals.md). Read with [ADR-0022](0022-failure-to-act-is-harm-we-caused.md).**

> **Which part.** "Standing authority is armable" is superseded by something broader: the
> user may switch off the asking entirely. **Attestation is not waivable is unchanged**,
> and its reason is now stronger than when it was written — attestation is a local daemon
> call rather than a model round trip, so it costs nothing to keep, and the record it
> produces is the instrument the improvement measurement is counted from
> ([does the second run cost less](../proofs/does-the-second-run-cost-less.md)). Switching
> off the asking is a user's choice; switching off the record would break the product.
**Forward decision, driven by a product argument rather than by prototype evidence.**

## Context

[ADR-0008](0008-scopes-operation-classes-and-honest-refusals.md) establishes five operation classes ordered by consequence, and requires an attestation for `submit`. It does not say how a person expresses their grant, and the obvious reading — prompt at the moment of each consequential action — is wrong. Jamie's argument, 2026-08-08, and it is correct:

> Every harness started by prompting the user every time a write or a command was needed. The ones that never added automatic approval are no longer popular. People want to give an assistant a long-running task and go have coffee. Without it, this goes from a life-changing desktop assistant to a cool tool to babysit.

There is a second reason, and it is stronger than the ergonomic one. **Approval fatigue does not merely annoy, it manufactures the appearance of consent.** After the fortieth dialog a person is clicking yes without reading. The system then holds a record of forty approvals and the person made roughly one decision. That is worse than not asking, because it produces a defensible-looking audit trail behind an undefended action. A single deliberate grant made while the person is actually paying attention is *more* honest than forty reflexive ones, not less.

**Attestation is not a prompt, and the two must not be confused.** [ADR-0008](0008-scopes-operation-classes-and-honest-refusals.md) rule 2 exists so that the service can describe what it is about to commit — *a commit the service cannot describe is a commit nobody can review*. That is protection against the agent submitting into a dialog that re-rendered, a focus that moved, or a race it did not notice. It is a machine verifying its own understanding. A human being present is not part of it, and it costs no human time.

**A rejected mechanism, recorded because the reasoning matters.** A per-application submit budget with a fixed ceiling was proposed and rejected in the same conversation. Jamie's counter-example: a person legitimately needs four hundred messages sent while they are out, depends on it, and comes home to their employer asking why the clients never heard from them. A ceiling we invented would have caused that. It is also the exact species of error [03-LESSONS.md](../03-LESSONS.md) §6 names — a constant nobody measured, quietly deciding what is allowed, in this case wearing a safety badge. **Volume was never the signal. Intent is.** The agent restates the scale it derived from the task before starting; the anomaly worth acting on is *divergence from that declared plan*, not magnitude, and no invented constant is required to detect it.

## Decision

1. **Permission is expressed per application as a two-position control — View or Interact — with the underlying scope mapping fixed here:**

   | Control | Grants |
   |---|---|
   | **View** | `observe` |
   | **Interact** | `observe`, `edit`, `activate` |
   | *(neither)* | `submit` and `destructive` — see rules 2 and 3 |

   The obvious wrong implementation is Interact meaning all five classes. It does not.
2. **`submit` is armable as standing authority, per application, off by default.** When armed, the agent may submit in that application without a per-action prompt.
3. **`destructive` is armable separately, never by the same gesture as `submit`,** and carries the strongest proof-of-human available on the surface being used. It is the top of a ladder ordered by consequence and it does not inherit a rung below it.
4. **Arming is the one place we deliberately interrupt.** A real warning, once, naming the application and what it may now do unattended, in the person's language rather than the scope vocabulary. After that, never again for that application.
5. **Attestation is never waived.** Arming standing authority removes the *human* from the loop. It never removes the *proof*. A submit that cannot be described is refused with `ATTESTATION_FAILED` whether a person is watching or not.
6. **Scale comes from the task, not from policy.** The agent states the scale it derived before it begins. Acting materially beyond that declared plan is the anomaly, and it is reported under [ADR-0022](0022-failure-to-act-is-harm-we-caused.md). No fixed ceiling is invented anywhere in the system.
7. **Standing authority is visible while it is armed.** The face shows it ambiently. A glance at the screen tells a person that something is currently allowed to act on their behalf — the honest replacement for the awareness a prompt used to provide.
8. **Nothing here weakens the person's override.** Ownership, human-outranks-agent, and a non-advisory `emergencyStop` are unchanged and become more load-bearing, not less ([ADR-0008](0008-scopes-operation-classes-and-honest-refusals.md) rule 7).

## Consequences

**Good.** The product is usable for the thing it exists to do — a long task, unattended — which no amount of correctness elsewhere substitutes for.

**Good.** Consent becomes one deliberate decision rather than many reflexive ones, and the audit log stops recording approvals nobody read.

**Cost, and it is the real one.** An armed application can act unattended, so a confused agent can do real damage without a human in the path. This is accepted knowingly, and the compensating controls are named rather than assumed: attestation on every submit, divergence-from-plan reporting, ambient visibility, reachability under [ADR-0022](0022-failure-to-act-is-harm-we-caused.md), a complete audit log, and an emergency stop. If those are weak, this decision is dangerous — which makes them the highest-value things in the test suite.

**Cost.** Two controls in the interface (View/Interact) and two further arming switches (submit, destructive) is more surface than one toggle, and making that legible without a manual is a real design problem. It is not solved by collapsing the model.

**Cost.** Divergence-from-plan requires the agent to declare a plan with a scale, which is a capability rather than a check — a vaguer signal than a hard number and one that will need tuning against real behaviour. Preferred anyway, because the hard number was wrong in a way that cost a user their job in the hypothetical that killed it.

## Evidence

| Claim | Source |
|---|---|
| approve-every-action harnesses lost; people want to walk away | Jamie, 2026-08-08, rebuild design conversation |
| the four-hundred-message counter-example that killed the fixed ceiling | Jamie, 2026-08-08, same conversation |
| five operation classes ordered by consequence | [ADR-0008](0008-scopes-operation-classes-and-honest-refusals.md). **Not** `protocol/schema.json`, `enums.operationClass` — see the correction note below |
| attestation exists so a commit can be described and reviewed | [ADR-0008](0008-scopes-operation-classes-and-honest-refusals.md) rule 2; protocol methods `attestElement` / `commitElement` |
| approval criteria the agent cannot author | prototype amendment A15, issue #74 |
| never tune a constant to hide an upstream inconsistency | [03-LESSONS.md](../03-LESSONS.md) §6 |
| the person wins; `emergencyStop` is not advisory | [ADR-0008](0008-scopes-operation-classes-and-honest-refusals.md) rule 7; issues #25, #4 |
| security refusals are mutation-tested | [05-TEST-STRATEGY.md](../05-TEST-STRATEGY.md) |

**Correction, 2026-08-21.** The evidence row above cited `protocol/schema.json`
under `enums.operationClass` as a source for the five operation classes. No v1.x
schema has ever carried that object: `protocol/schema.json` contains one
enumeration site — `capabilityNames` at `:29`, a deliberately different five with
`launch` in it — and zero occurrences of `enums`, `operationClass` or
`destructive`. The classes this record reasons about live in
[ADR-0008](0008-scopes-operation-classes-and-honest-refusals.md) as doctrine and
in the daemon's dispatch table as `effectClass` values; the fifth,
`destructive`, is absent from the wire on purpose
([ADR-0037](0037-the-other-three-classes-are-on-the-wire-before-they-are-possible.md)).
Nothing about this record's decision changes — the citation was wrong, not the
reasoning. Corrected in place rather than by rewriting an accepted record.

Found by the third round of M3's whole-feature review. The same stale citation
was corrected at ADR-0008 in round two and here in round three, each time by a
reader noticing one more copy; the standing lesson is that a correction which
stops at the line a reviewer quoted is not a correction, and the search for the
next copy belongs to a check rather than to a reader.
