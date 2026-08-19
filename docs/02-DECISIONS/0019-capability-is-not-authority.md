# ADR-0019 — Capability is not authority

**Status:** accepted; **superseded in part 2026-08-09 by [ADR-0028](0028-trust-is-a-mode-and-the-default-asks-almost-nothing.md)**.
**Date:** 2026-08-08
**Extends [ADR-0008](0008-scopes-operation-classes-and-honest-refusals.md).**

> **Which part.** The core distinction — the operating system's permission is a
> precondition, never consent — is untouched and load-bearing. What is superseded is the
> implication that consent must therefore be *collected per action*. The user may choose a
> trust mode in which it is collected once. The precondition still is not consent.
**Forward decision.** The distinction below was implicit in the prototype and is being made explicit because it was about to be violated in this repository's own design conversation.

## Context

There are two independent questions in front of every application on a person's desktop, and they are answered by two different parties:

| Question | Asked of | Answer means |
|---|---|---|
| **May we?** | the person | authority — they granted it, deliberately, in our dashboard |
| **Can we?** | the platform | capability — the accessibility layer will actually yield a usable tree |

These have nothing to do with each other, and collapsing them produces two distinct harms.

**Collapsing capability into authority is a lie to the user.** "I am not allowed to read your mail client" when the truth is "your mail client exposes no accessibility tree" sends the person to a permissions page to fix something that is not broken there. The prototype has the exact precedent, inverted: a refusal blamed a missing accessibility flag that was demonstrably present (issue #194). Same failure, different direction — a refusal that names the wrong cause is worse than a refusal that names none, because it is actively misleading and it is confidently wrong.

**Collapsing authority into capability is a breach.** If the system reasons "the OS lets me read this window, therefore I may", then every permission the user granted for one purpose becomes permission for all purposes, and the consent model in [ADR-0008](0008-scopes-operation-classes-and-honest-refusals.md) is decoration. Jamie's framing, 2026-08-08: *we do not care that the OS gave us permission, we care that the user did.*

There is a third, subtler version. **Probing an application's capability is itself an observation.** Asking the accessibility layer whether an unpermitted application has a readable tree learns something about the person's machine — that the application is installed and running — which is precisely what [ADR-0008](0008-scopes-operation-classes-and-honest-refusals.md) rule 6 forbids leaking. Deny-by-default means invisible, and a capability probe is a way of seeing.

> **Amended 2026-08-18 by [ADR-0042](0042-existence-is-readable-content-is-not.md).** The ordering rule above is unchanged and is now load-bearing in code: authority is asked *first*, configuration second, and an unpermitted name never reaches a capability probe (`daemon/src/server.ts`, `openApplication`) — because the probe itself would leak that the application exists. What changed is only the last sentence's premise. Deny-by-default no longer means invisible: existence and *permitted capabilities* are readable from the listing, which is answered from this daemon's own records rather than by probing the application. Nothing inside an unpermitted application is read, so the leak this paragraph guards against is still closed by the same ordering.

This matters more after [ADR-0017](0017-platform-backends-live-inside-the-daemon.md), because capability is the *only* part of this that varies by platform. Authority is ours, it is stored by us, and it is identical everywhere. Getting the line in the right place means the entire consent model — the store, the toggles, the scope enforcement, the audit log, the consent surfaces — is written once and ported never.

## Decision

1. **Authority is ours, and only the person grants it.** No operating system grant, no platform default, and no successful capability probe is ever treated as consent.
2. **Authority is checked first, always.** Capability is never probed for an application the person has not permitted. Ordering is a correctness requirement, not an optimisation.
3. **Every application is in exactly one of three states, and they behave differently on purpose:**

   | State | Behaviour |
   |---|---|
   | **Not permitted** | Invisible. The agent cannot learn the application exists. Unchanged from [ADR-0008](0008-scopes-operation-classes-and-honest-refusals.md) rule 6. |
   | **Permitted, not capable** | Visible, and refuses honestly — naming the capability that is missing and what would change the answer. |
   | **Permitted and capable** | Works, within the granted scope. |

4. **The daemon must never collapse these into a generic failure.** A refusal carries which of the two questions failed. This is the [ADR-0008](0008-scopes-operation-classes-and-honest-refusals.md) rule-4 requirement applied to the specific distinction that is easiest to blur.
5. **Capability is probed, never inferred** — [ADR-0010](0010-daemon-is-python-single-threaded-default-glib-context.md) rule 5, unchanged and now load-bearing for a second reason. A settings key is not capability, and the honest refusal in state two must cite a probe that actually ran.
6. **Authority lives above the platform seam; capability lives below it.** The permission store, the scope model, and the consent surfaces are platform-independent by construction. Only "can this backend read this application, and if not, what would have to change" is per-platform — see [ADR-0020](0020-granting-an-application-is-a-transaction-with-a-rollback.md).

## Consequences

**Good.** The refusal a person receives is actionable, and it points at the thing that is actually wrong. That is the difference between a system people trust and a system people work around.

**Good.** The portable half of the product is now identified precisely rather than hopefully. A port re-implements capability and nothing else.

**Cost.** Two checks and two failure paths where a single boolean would do, in a place that is exercised on every single resolution. Accepted: this is the check that decides whether an agent may look at someone's private application, and a fast wrong answer has no value.

**Cost.** Ordering authority before capability means the system genuinely cannot tell a user "that app would not work anyway" until they permit it. A person may grant permission and immediately be told the application is unreadable, which feels like a wasted step. That is the correct trade: the alternative is scanning applications the person never authorised us to look at, to save them a click.

## Evidence

| Claim | Source |
|---|---|
| we care that the user granted it, not the OS | Jamie, 2026-08-08, rebuild design conversation |
| a refusal blamed a flag that was demonstrably present | prototype issue #194, open at pivot |
| a refusal names the check that produced it and what would change the answer | [ADR-0008](0008-scopes-operation-classes-and-honest-refusals.md) rules 4–5; PR #220 |
| unpermitted means invisible, not blocked | [ADR-0008](0008-scopes-operation-classes-and-honest-refusals.md) rule 6; prototype proof artifact `an-unpermitted-application-is-invisible-until-the-user-says-otherwise.md` |
| capability is probed, never inferred from a settings key | [ADR-0010](0010-daemon-is-python-single-threaded-default-glib-context.md) rule 5 |
| the platform seam is inside the daemon | [ADR-0017](0017-platform-backends-live-inside-the-daemon.md) |
| scope enforcement happens at the daemon | [01-ARCHITECTURE.md §2](../01-ARCHITECTURE.md) |
