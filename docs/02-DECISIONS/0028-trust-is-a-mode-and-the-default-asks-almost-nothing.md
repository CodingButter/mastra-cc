# 0028 — Trust is a mode, and the default asks almost nothing

**Status:** accepted, 2026-08-09.
**Supersedes in part:** [ADR-0008](0008-scopes-operation-classes-and-honest-refusals.md),
[ADR-0019](0019-capability-is-not-authority.md),
[ADR-0021](0021-standing-authority-is-armable-attestation-is-not-waivable.md), and
[ADR-0023](0023-the-phone-is-a-consent-surface.md) — specifically, every part of those
records that assumes gating is mandatory. Each keeps its mechanism and loses its
compulsion.
**Forced by:** a ruling from the product owner, plus two measurements that changed what
the profile boundary is worth. A user ruling is a finding; it is the kind this document
set exists to record rather than argue with.

## Context

The consent ladder was built on an assumption that was never stated because it never
looked like an assumption: that the product's job is to ask before it acts, and that the
design question is only *how often* and *how well*.

The ruling is that this is backwards for the product's actual user. The working
relationship people already accept with a capable agent is one where permission is not
requested per action, because a harness that asks before every write loses — people want
to hand over a task and leave. Asked for the intended shape of "send my sister a message
on Facebook", the answer was: the agent asks for the message, asks *which* sister only
when it genuinely cannot tell — "Jessica Baily or Jessica Hester?" — and then acts.

Two measurements make that position defensible rather than merely convenient.

**The browser profile is a real boundary, enforced by someone other than us.** Since
Chrome 136 a debugging port is ignored unless it is accompanied by a non-default profile
directory. That constraint, which looked like an obstacle, forces a separate profile — and
a separate profile is a better isolation mechanism than anything in our design. The
permission grain drops from per-application to **per-account**: if the bank is not signed
in inside that profile, no amount of agent misbehaviour reaches it. Isolation is enforced
by Chrome's cookie jar rather than by our code, and revocation is deleting a directory.

**The page-level layer we hoped could gate is not a gate.** Measured at 5 of 8
effect-causing paths observed — it misses a `fetch` inside a Worker, a same-process
iframe's natives, and a trusted click dispatched over the protocol. A boundary with three
known holes is not a boundary. That closed off the design where fine-grained gating lives
in the page, and pushed the honest boundary outward to the profile.

A third thing became clear from watching the ladder in use. **Much of the consent ladder
was a clumsy mechanism for something a sentence does better.** Asking which Jessica is not
authorisation — it is identity resolution, and the existing rule already covers it: when a
predicate matches two elements, refuse and name both, never take the first. A spoken
question satisfies that rule completely.

## Decision

**Trust is a mode the user selects, not a law the architecture enforces. The scope ladder
becomes a preset. What survives every mode is the record and the honesty.**

1. **YOLO mode exists and gates nothing.** In it the agent acts freely within whatever the
   mode covers. It is a legitimate, supported configuration, not a debug escape hatch.
2. **Browser trust and desktop trust are two separate switches**, because they cover two
   different risk surfaces and pretending otherwise would be dishonest. The dedicated
   browser profile is a real boundary **for the browser and only for the browser**. It says
   nothing about the accessibility side, where unrestricted operation means typing into any
   window on the machine. The desktop switch must say that plainly, in those words.
3. **The scope ladder is a preset, not a law.** `observe` / `reveal` / `edit` / `transmit`
   remain the vocabulary a plan is written in and the axis a manifest is derived along.
   They stop being a mandatory sequence of prompts.
4. **Disambiguation is not authorisation.** When a predicate matches two elements the run
   refuses and names both with enough context to tell them apart. This holds in every mode
   including YOLO, because it is not a permission check — it is a correctness check, and
   taking the first match is the machine pretending to know something it does not.
5. **The audit record survives every trust mode, and not for safety reasons.** It is the
   measuring instrument. Steps to completion and element resolutions in
   [does the second run cost less](../proofs/does-the-second-run-cost-less.md) are counted
   from exactly the events an access record holds. An agent acting through a path the
   daemon does not record makes the product's central claim unmeasurable. Turning off the
   asking is a user's choice; turning off the record would break the product.
6. **The governing rule, verbatim:** *be thorough, and if you are not one hundred percent
   sure it is doing exactly what the user wants, there is no harm in asking for clarity at
   the moment the uncertainty happens.*

   "At the moment" is load-bearing and is a capability requirement, not a sentiment: a run
   must suspend mid-plan with its resolved state intact, surface a question, and resume on
   the answer. Not batch its questions up front, and not discover the problem afterwards.
   That capability is measured, not aspirational — see the evidence below.
7. **How this composes with [ADR-0022](0022-failure-to-act-is-harm-we-caused.md).** They
   look like they conflict and do not. Ask at the moment uncertainty arises. If the user
   cannot be reached, ADR-0022 governs: complete the stated task and be loud about it
   rather than stopping quietly. **Asking is the first move, not the exit.** A run that
   halts because nobody answered has chosen precisely the failure ADR-0022 forbids.
8. **The phone is where a question can be answered, not a checkpoint that must be passed.**
   ADR-0023's mechanism is unchanged and its authority model is unchanged. What changes is
   that its existence no longer implies a gate on the path.

## Consequences

**The cost, stated first and not softened.** A permissive default means a mistake executes.
The disambiguation rule catches the *ambiguous* mistake — two Jessicas — and catches
nothing about a confidently wrong single match. The profile bounds the blast radius for
browser work and bounds nothing on the desktop side. We are trading a class of prevented
errors for a product people will actually use, and the honest form of that trade is to say
so here rather than to imply the boundaries are tighter than they are.

Prior art disagrees with us, and that is recorded rather than omitted. Mobile platforms
moved from install-time consent to runtime prompts to one-time grants — the arrow points
toward asking *more*, and we are pointing it the other way. Our justification is that the
user is granting to their own agent rather than to a third-party application, which is a
real difference and not a complete answer. Q17 in [09-QUESTIONS.md](../09-QUESTIONS.md)
carries the sources.

Several later milestones shrink. The consent ladder's UI, the per-action prompt surfaces,
and the phone's checkpoint role are all smaller than the roadmap assumed.

**What is unambiguously better:** the questions the assistant does ask now sound like
conversation instead of a dialog box, and they arrive at the moment they matter. That was
always the goal the ladder was reaching for.

## Evidence

- [what a page-level recorder observes](../proofs/what-a-page-level-recorder-observes.md)
  — 5 of 8 effect paths observed. The best version of the idea was measured, not a
  strawman, and it still cannot be a gate.
- Chrome's separate-profile requirement for remote debugging, verified against Chrome 150
  and recorded in
  [what the browser protocol gives us](../proofs/what-the-browser-protocol-gives-us.md).
- [what a plan can say without a model](../proofs/what-a-plan-can-say-without-a-model.md)
  — an ambiguous predicate returns **both** candidates with role, name and ancestry, and
  the run causes no effect at all; a test asserts the interpreter never takes the first
  match. Also: a run suspends mid-plan on a question and resumes on the answer, recording
  what it had to re-derive across the pause.
- [does the second run cost less](../proofs/does-the-second-run-cost-less.md) — the
  improvement measurement is counted from recorded steps and element resolutions, which is
  why clause 5 is not negotiable.
- The memory half of the same artifact: a remembered answer that no longer resolves
  uniquely causes a **re-ask**, not a silent reuse. A stale locator merely fails to find
  something; a stale memory confidently finds the wrong thing.
