# ADR-0008 — Scopes, operation classes, and refusals that explain themselves

**Status:** accepted
**Date:** 2026-08-08
**Carried forward from the prototype, with the depth-ceiling correction applied.**

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
6. **Deny by default at the application level**, and denial is *invisibility*: an unpermitted application does not appear as blocked, it does not appear at all. A blocked-but-visible application leaks the fact that it is installed.
7. **The person wins.** Ownership holds, human-outranks-agent, and an `emergencyStop` in the protocol that is not advisory.

## Consequences

**Good.** Each of the three dimensions can be reasoned about and tested separately. A refusal becomes debuggable by the person who received it, which is the difference between a system people trust and a system people work around.

**Cost.** Five classes plus depth plus ownership is more surface than a single "allow desktop control" toggle, and the consent UI has to make that comprehensible without a manual. That is a design problem, not a reason to collapse the model.

**Cost, accepted.** Attestation on `submit` adds a round trip and can be annoying on a chain of small submits. The alternative — an agent that can send email without describing the email — is not an alternative.

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
