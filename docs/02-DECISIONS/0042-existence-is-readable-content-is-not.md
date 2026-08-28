# 0042 — Existence is readable; content is not

Status: accepted, 2026-08-16 (pre-M3)
**Supersedes [ADR-0008](0008-scopes-operation-classes-and-honest-refusals.md) rule 6**
(denial-is-invisibility) and amends
[ADR-0036](0036-grants-live-in-a-file-the-daemon-owns.md).

## Context

Since the prototype, denial at the application level meant *invisibility*: an
application the user had not permitted did not appear as blocked, it did not
appear at all. The stated reason, in
[00-PRODUCT.md](../00-PRODUCT.md) §7, was that a visible-but-blocked application
tells the agent something about the user's machine that the user did not agree
to share. M2.5 proved the behaviour on real hardware —
[an unpermitted application is invisible](../proofs/an-unpermitted-application-is-invisible.md)
shows an ungranted application answering **absent, not filtered**, on both the
accessibility-bus route and the browser route, with the refusals byte-identical
to those for an application that never existed.

The rule is being reversed because of what it does to the *user*, which is a
consideration the original never weighed.

**The failure it produces is a false belief, not ignorance.** Jamie's case, in
his words:

> *"say a user says open up obs and set my scene to starting. if permission was
> forgotten and obs is hidden, the agent concludes obs isn't installed and
> suggests installing it."*

The agent is not merely uninformed. It has been handed a **manufactured
inventory** in which OBS is absent, and it acts on that inventory confidently:
it tells the user to install software the user already has, and sends them on
an errand to fix a problem that does not exist. The system looks broken and
wastes the time of the person it exists to save time for. An assistant that
wastes your time is an assistant slowing you down.

**And the rule cannot survive the feature it collides with.** "What
applications do I have, and what can you do with each of them?" is a request
the user will make. It is an inventory question, and no rule that hides items
can answer an inventory question honestly. Either the feature does not exist,
or the rule does not. The rule goes.

**Enforcement is what makes the reversal safe, and it is not new.** The
objection to a visible-but-refused capability would be that the agent could
ignore the refusal and act anyway — but that is not how this daemon works.
Effect-class operations are enforced *before the call*, pinned by **B11**
(`01-ARCHITECTURE.md` §5), and the dispatch table's test fails if any
effect-class operation is not marked enforced-before-call. A capability list the
agent reads is a description of a fence that is actually there. Jamie's
framing, and it is the whole argument:

> *"why provide the application with its permissions available for the agent to
> read if we aren't enforcing them? why say obs exists and you can't open close
> view or act on it if in reality the agent could just ignore and try to open it
> and successfully do so."*

The invisibility rule was, in effect, hiding the fence because we did not fully
trust it. We do — it is tested — and hiding a tested fence buys nothing and
costs the user an errand.

There is also a precedent inside the very paragraph being amended.
[00-PRODUCT.md](../00-PRODUCT.md) §7 already carves the assistant's **own tools**
out of the invisibility rule, for exactly the reason above: *"a hidden
capability cannot be asked for… hiding our own surface would make the assistant
unable to say 'I could do that, if you let me.'"* This ADR extends that
sentence's logic to applications. It is the same argument, applied one subject
further.

## Decision

**The boundary moves from *whether a thing exists* to *what is inside it*.**

**1. Existence is readable.** The daemon may report that an application is
installed, and whether it is running, regardless of what the user has permitted.

**2. Permission is readable, and it names itself.** For each application the
daemon reports which capabilities are enabled and which are refused —
open, close, view, act — together with the configuration that would change the
answer. The agent learns *permission*, never *absence*.

**3. Content remains behind the application grant.** Everything inside an
application — its elements, their names, their values, its windows, its state —
remains behind the grant, enforced inside the walk exactly as
[ADR-0036](0036-grants-live-in-a-file-the-daemon-owns.md) specifies. Once that
grant admits the walk, [ADR-0056](0056-permitted-content-is-observable-protected-content-is-redacted.md)
allows ordinary text and numeric content to be observed while controls marked
protected by the platform remain redacted without a value. Reading the label on
a door is not opening it; opening the permitted door is not permission to read a
locked drawer inside it.

**4. A refused capability is refused in fact, not merely in the listing.** The
enforcement point does not move. An agent that reads *"close: refused"* and
calls `closeApplication` anyway gets the refusal, before the call reaches a
backend, under B11. The listing describes enforcement; it never replaces it.

**5. The refusal names the setting.** A capability refused by configuration says
so, and says which configuration — so the chain the user actually experiences
works: the working agent reports a reason rather than a failure, the
orchestrator relays a decision rather than an error, and the orb can say *"I
can't do that because of this setting — here is what you would change."*

This is [ADR-0008](0008-scopes-operation-classes-and-honest-refusals.md)'s
2026-08-08 three-state amendment (invisible / permitted-unreadable / readable)
with the first state deleted: **listed-and-refused** and **listed-and-permitted**
remain, and the difference is always visible to the person whose configuration
produced it.

## Consequences

**Good.** The agent can no longer form a false belief about what is installed,
so the OBS class of failure is gone by construction. An inventory request is
answerable honestly. Every refusal becomes actionable — it names a setting, and
a setting is a thing the user can change. And the assistant's own tools and the
user's applications now obey **one rule** instead of two, which removes a carve-
out that would have needed explaining forever.

**Cost — the claim we are giving up, stated plainly.** We can no longer say that
an agent which is compromised, or which is talked into misbehaving by a
malicious page, learns nothing about the machine. It learns the installed
application list and the shape of the user's configuration. That was a real
property and it is now gone. We are trading it for an assistant that does not
confidently lie to its user about their own computer, and we think the trade is
correct — but it is a trade, not a free win. What still holds after the trade is
the part that was always doing the work: **nothing inside an unpermitted
application is readable, and no refused capability becomes performable.**

**Cost — existing code and tests encoded the old doctrine and had to change.
They did.** `daemon/src/__tests__/launch-authority.test.ts` asserted that a
launch refusal is indistinguishable from one for an application that is not
installed, and `daemon/src/server.ts` carried a comment saying a refusal must
*never reveal whether an application is installed on this machine.* Both were
correct under the old rule and wrong under this one, and both were rewritten
rather than deleted. What stands in their place: the test named *"the refusal
names no path and no command, and points at where existence IS answered"*, and
`UNAVAILABLE_REFUSAL`'s comment, which now says the sentence names the
capability and the place the answer lives while naming **nothing about this
machine's contents — no path, no command, no installed-or-not.**

Line numbers are deliberately not cited here. This ADR once cited two that had
already moved, which is a citation pointing at whatever happens to occupy that
line today. Names survive edits; line numbers do not.

**Cost — a new surface to get right.** Enumerating installed applications means
the daemon reads an application inventory it did not read before, and the
listing becomes a thing that can drift from the enforcement it describes. A
listing that says *refused* while the operation succeeds — or the reverse — is
worse than no listing, because the agent reasons on it. The listing and the
dispatch table must be checked against each other by a test, and that test is
part of the milestone that ships the listing.

**Unchanged.** The M2.5 proof artifact remains valid as the record of the
behaviour that shipped in M2 and of the mechanism that produced it — enforcement
inside the walk, not a post-filter. It documents what the system did, and it is
not retroactively wrong. The mechanism it proves is the same mechanism that
still protects contents; only the subject of concealment narrows.

## Evidence

| Claim | Source |
|---|---|
| denial was invisibility, and why | [ADR-0008](0008-scopes-operation-classes-and-honest-refusals.md) rule 6; [00-PRODUCT.md](../00-PRODUCT.md) §7 |
| an ungranted application answered absent, not filtered, on both routes | [an unpermitted application is invisible](../proofs/an-unpermitted-application-is-invisible.md) (M2.5, real hardware) |
| the assistant's own tools were already carved out of the rule | [00-PRODUCT.md](../00-PRODUCT.md) §7, the paragraph beginning "Invisibility is a rule about applications" |
| grants are enforced inside the walk, never as a post-filter | [ADR-0036](0036-grants-live-in-a-file-the-daemon-owns.md) |
| effect-class operations are enforced before the call, with a failing test if not | `docs/01-ARCHITECTURE.md` §5 (B11); [ADR-0034](0034-launch-is-the-first-effect-class-operation.md) |
| the OBS case, and the transparency ruling | Jamie, 2026-08-16 |
| enforcement is the precondition for a readable capability list | Jamie, 2026-08-16 |
| tests and comments encoding the old doctrine, since rewritten | `daemon/src/__tests__/launch-authority.test.ts` (the *"names no path and no command"* case); `daemon/src/server.ts` (`UNAVAILABLE_REFUSAL`'s comment) |
| a refusal must name the check that ran | [ADR-0008](0008-scopes-operation-classes-and-honest-refusals.md); prototype issue #194, PR #220 |
