# ADR-0022 — Failure to act is harm we caused

**Status:** accepted
**Date:** 2026-08-08
**Normative for the whole product. Read with [ADR-0021](0021-standing-authority-is-armable-attestation-is-not-waivable.md).**
**Forward decision. It corrects an asymmetry in the existing documents rather than adding a feature.**

## Context

Every safety mechanism in this repository, before this record, treats harm as one thing: *the assistant did something it should not have*. Scopes, attestation, deny-by-default invisibility, ownership, the emergency stop — all of them are brakes.

That model is incomplete, and the gap is not academic. Jamie's example, 2026-08-08: a person sends the assistant off with a long task and goes shopping. It stops partway — a permission it lacks, an application that closed, a wall of any kind. It stops *quietly*. They come home to their employer asking why the clients never received their messages.

Read that failure carefully, because the obvious lesson is the wrong one. The damage was not that it stopped. Sometimes stopping is right. **The damage was that nobody found out.** The person had a phone in their pocket the entire time.

This reframes the whole safety model. If someone delegates a task and we accept it, then not completing it is an outcome we caused, and it can be more costly than the action we declined to take. A brake that engages silently is not a safety feature — it is a failure with good manners.

The existing documents already contain the correct instinct in a narrower form. [ADR-0008](0008-scopes-operation-classes-and-honest-refusals.md) requires that a refusal name the check that produced it and say what would change the answer. That is an *honesty* requirement. It quietly assumes a person is standing there to read it. Once standing authority exists ([ADR-0021](0021-standing-authority-is-armable-attestation-is-not-waivable.md)), that assumption is false by design — the entire point is that they walked away. **A refusal nobody receives is not an honest refusal.** It is the same failure family as [03-LESSONS.md](../03-LESSONS.md) §1, where the keeper was "fixed" in code and false in production for six hours because nothing that could see the difference was watching.

## Decision

**The normative statement, and it belongs in [00-PRODUCT.md](../00-PRODUCT.md):**

> Failure to act is also harm, and it is harm we caused. Every protective mechanism must fail toward informing the person, not toward stopping quietly. When uncertain, complete the stated task and be loud about it.

The rules that follow from it:

1. **Every wall is reportable.** A refusal, a missing permission, a capability that vanished, a divergence from the declared plan, an application that closed mid-task — each reaches the person wherever they are, not only the screen they are not looking at.
2. **Delivery is part of the refusal, not a nicety.** A mechanism that can block work must state how the person finds out. One with no answer is not finished.
3. **Unreachable is not permission to stop.** If the person cannot be reached, the default is to continue the task they asked for and record the whole thing. Failing to reach someone is itself reportable, and it is reported when contact is restored.
4. **Ask when a decision is genuinely theirs; do not ask to transfer responsibility.** A wall the person can clear — a permission they can grant, a direction they can correct — is worth an ask. A wall they cannot clear is worth a report.
5. **In-flight work is visible without being asked about.** A person who looks at any surface can see that a task is running, what it has done, and when it last made progress. Loudness only works if there is somewhere to be loud.
6. **The audit log records what was *not* finished, and whether anyone was told.** It answers two questions, not one: what did it touch, and what did it fail to complete.

**This promotes two things out of the deferred bucket.** The phone client and the notification path were scheduled after M6 as conveniences ([07-ROADMAP.md](../07-ROADMAP.md)). They are load-bearing for safety under this ADR, and M6 must stub them rather than assume them. See [ADR-0023](0023-the-phone-is-a-consent-surface.md).

## Consequences

**Good.** It closes the loop opened by [ADR-0021](0021-standing-authority-is-armable-attestation-is-not-waivable.md). Standing authority is only defensible if walking away is safe, and walking away is only safe if the system can find you.

**Good.** It gives a decision procedure for the arguments this design keeps generating. Every one of them — budgets, prompts, ceilings, confirmations — reduces to: *does this fail toward telling them, or toward stopping?* The answers stop being a matter of taste.

**Cost, and it is the dangerous one.** "When uncertain, continue" is a bias toward action in a system that drives someone's desktop. It is chosen deliberately over a bias toward halting, on the grounds that a halted assistant someone was depending on is a harm we caused rather than a harm we avoided. It is only survivable alongside [ADR-0021](0021-standing-authority-is-armable-attestation-is-not-waivable.md)'s controls — attestation, divergence reporting, ambient visibility, emergency stop — and it must be revisited if any of those turn out weak in practice.

**Cost.** A system that is loud becomes a system people mute, and a muted channel is worse than none because it looks like coverage. Notification volume is a first-class design problem from the day the channel exists, not a polish item.

**Cost.** Reaching a person off their network requires infrastructure the product does not otherwise need, and it interacts with the unresolved question of where the phone client's transport terminates ([01-ARCHITECTURE.md §9](../01-ARCHITECTURE.md)). This ADR raises the priority of that question from open to blocking.

## Evidence

| Claim | Source |
|---|---|
| the grocery-store failure and its framing | Jamie, 2026-08-08, rebuild design conversation |
| refusals must name the check and what would change the answer | [ADR-0008](0008-scopes-operation-classes-and-honest-refusals.md) rules 4–5; PR #220 |
| standing authority means the person is deliberately absent | [ADR-0021](0021-standing-authority-is-armable-attestation-is-not-waivable.md) |
| a fix that is true in code and false in production, unnoticed for hours | [03-LESSONS.md](../03-LESSONS.md) §1; prototype PR #225 vs cron state |
| phone client and orb scheduled after M6 | [07-ROADMAP.md](../07-ROADMAP.md) "Deliberately not scheduled" |
| phone transport termination is unresolved | [01-ARCHITECTURE.md §9](../01-ARCHITECTURE.md) |
| the audit log names every element touched and nothing else | [07-ROADMAP.md](../07-ROADMAP.md) M3, M6 exit gates |
