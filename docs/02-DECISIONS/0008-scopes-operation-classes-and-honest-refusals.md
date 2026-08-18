# ADR-0008 — Scopes, operation classes, and refusals that explain themselves

**Status:** accepted; **superseded in part 2026-08-09 by [ADR-0028](0028-trust-is-a-mode-and-the-default-asks-almost-nothing.md)**; **rule 6 superseded 2026-08-16 by [ADR-0042](0042-existence-is-readable-content-is-not.md)**.
**Date:** 2026-08-08
**Carried forward from the prototype, with the depth-ceiling correction applied.**

> **Which part.** The scope ladder below is now a **preset, not a law** — it remains the
> vocabulary a plan is written in and the axis a permission manifest is derived along, but
> it is no longer a mandatory sequence of prompts. Honest refusals are unaffected, and the
> ambiguity rule is *strengthened*: refusing and naming both candidates holds in every
> trust mode, because it is a correctness check rather than a permission check.

## Context

"Let an agent use my desktop" is not one permission. The prototype spent its first three days discovering that it is at least five, plus a depth dimension, plus an ownership dimension, and that conflating any of them produces either a useless system or an unsafe one.

**The five operation classes** settled early and never needed to change. They are enumerated in `protocol/schema.json` under `enums.operationClass`, and the descriptions below are that file's own:

| Class | What it covers |
|---|---|
| `observe` | reads desktop state; changes nothing |
| `edit` | changes a value in place, such as typing into a field |
| `activate` | moves focus or raises a window; visible to the user, trivially reversible |
| `submit` | triggers an application's own action — the consequences belong to the application |
| `destructive` | may discard or overwrite user data, or is not reversible |

`submit` is different in kind, not degree, and the prototype treated it that way: a submit-class action requires an **attestation** — the service refuses a commit it cannot describe, with the error `ATTESTATION_FAILED`. The reasoning behind that error is worth preserving verbatim: *a commit the service cannot describe is a commit nobody can review.*

**Depth** was the decision the prototype got wrong first and corrected in public. A depth ceiling shipped with a stated justification; the justification turned out to be derived from an **instrument setting** rather than from measured behaviour of the accessibility layer. The retraction was filed as its own issue — *"name the real one — our depth ceiling"* (#42) — and the replacement principle, developed over three further issues (#45, #58, #60), is that **a deeper walk is earned**: the system asks for more reach with a reason, rather than assuming a fixed radius.

**Ownership** is the third dimension. An element is *owned while it is being written*, and a human at the keyboard outranks the agent (issue #25). This is enforceable only because effects are attributed — see [ADR-0004](0004-semantic-first-pixels-last.md).

**Refusals** were the last piece and the one that arrived late. Early refusals were bare. The failure that motivated the fix is precise and damning: the orb refused an action by blaming a missing accessibility flag **that was demonstrably present** (issue #194). The refusal was not merely unhelpful, it was wrong, and nothing in it pointed at the check that had actually failed.

## Decision

1. **Five operation classes, exactly:** `observe`, `edit`, `activate`, `submit`, `destructive`. Enforced at the daemon, so a buggy or compromised hub cannot widen its own reach.
2. **`submit` requires an attestation the agent cannot author.** The service describes what it is about to commit; a commit it cannot describe is refused with `ATTESTATION_FAILED`.
3. **Depth is earned, not fixed.** Any ceiling must cite measured behaviour. A limit justified by an instrument setting is a bug, and the prototype's #42 retraction is the precedent for how to handle finding one: file it, name it, replace the justification.
4. **A refusal names the check that produced it.** Every refusal carries: which check ran, what it observed, and what would change the answer. Landed in the prototype as PR #220.
5. **A refusal must be derived from a check that actually ran** — not from a plausible-sounding cause. Issue #194 exists because that distinction was violated.
6. ~~**Deny by default at the application level**, and denial is *invisibility*: an unpermitted application does not appear as blocked, it does not appear at all. A blocked-but-visible application leaks the fact that it is installed.~~ — **Superseded 2026-08-16 by [ADR-0042](0042-existence-is-readable-content-is-not.md).** Deny-by-default survives; invisibility does not. Existence and permitted capabilities are readable; contents remain behind the grant. The rule is left standing here because the reason it was made is part of the record: it was reversed for producing a *false belief* in the agent rather than ignorance, which is a cost this version never weighed.
7. **The person wins.** Ownership holds, human-outranks-agent, and an `emergencyStop` in the protocol that is not advisory.

## Consequences

**Good.** Each of the three dimensions can be reasoned about and tested separately. A refusal becomes debuggable by the person who received it, which is the difference between a system people trust and a system people work around.

**Cost.** Five classes plus depth plus ownership is more surface than a single "allow desktop control" toggle, and the consent UI has to make that comprehensible without a manual. That is a design problem, not a reason to collapse the model.

**Cost, accepted.** Attestation on `submit` adds a round trip and can be annoying on a chain of small submits. The alternative — an agent that can send email without describing the email — is not an alternative.

## Amendments

**2026-08-08 — three per-application states, never collapsed to two.** Rule 6 above says
denial is invisibility. That is still true, but it hid a third state the prototype never
named. An application is in exactly one of:

| State | Meaning | What the person sees |
|---|---|---|
| `invisible` | Not granted. | Nothing. It does not appear, is not nameable, is not queryable. |
| `permitted-unreadable` | Granted, but its tree could not be read. | An honest report naming the check that failed and what would change it. |
| `readable` | Granted and readable. | Normal operation. |

Collapsing `permitted-unreadable` into either neighbour is a violation of the
"not a thing that pretends" non-goal in [00-PRODUCT.md](../00-PRODUCT.md). Reporting it as
invisible lies about installation; reporting it as readable lies about capability. The
prototype got this right once, by reporting an unreadable browser as *running but
unreadable* (commit 6657915), and that behaviour is now required rather than incidental.

A fourth state, `unknown`, exists before an application has ever been observed. It is not
a failure and must not be presented as one — see Q02 in
[09-QUESTIONS.md](../09-QUESTIONS.md), which is open on whether capability can be
determined without launching.

**2026-08-08 — what the permission surface actually grants.** The dashboard offers a
per-application **View / Interact** control, which maps onto this ADR's classes rather
than replacing them:

- **View** grants `observe`.
- **Interact** grants `edit` and `activate`.
- **Neither grants `submit`.** `submit` is never conferred by the toggle. It is either
  requested per act, or armed deliberately per application under
  [ADR-0021](0021-standing-authority-is-armable-attestation-is-not-waivable.md), which
  moves the human's consent earlier in time without removing it — and which does not
  waive the attestation in rule 2 above, because attestation is the machine verifying
  itself, not the human being asked.
- `destructive` is likewise never conferred by a toggle.

**2026-08-08 — authority is checked before capability.** Split out into its own record,
[ADR-0019](0019-capability-is-not-authority.md): the operating system's permission is a
precondition, never consent. A refusal caused by missing user authority must never be
reported as an operating-system limitation, and the authority check runs first so that
the two can never be confused.

**Consistency note.** [00-PRODUCT.md](../00-PRODUCT.md) §7 describes four scopes and omits
`destructive`. The schema and this record enumerate five. The product document is the
simplification for a reader; this record and `protocol/schema.json` are normative.

## Evidence

| Claim | Source |
|---|---|
| five operation classes | `protocol/schema.json`, `enums.operationClass` |
| attestation on submit; `ATTESTATION_FAILED` | protocol methods `attestElement` / `commitElement` |
| "a commit the service cannot describe is a commit nobody can review" | prototype protocol error documentation |
| depth ceiling retracted for resting on an instrument setting | issue #42 |
| deeper walk is earned | issues #45, #58, #60 |
| element owned while being written; human outranks agent | issues #46, #25 |
| refusals explain themselves | PR #220 (closes issue #184) |
| orb blamed a flag that was present | issue #194, open at pivot |
| unpermitted application is invisible | `docs/proofs/an-unpermitted-application-is-invisible-until-the-user-says-otherwise.md` |
| emergency stop | protocol method `emergencyStop` |
| approval criteria the agent cannot author | amendment A15, issue #74 |
