# 0067 — A chord is a closed list, and the desk is read back afterwards

- **Status:** accepted
- **Date:** 2026-09-01
- **Schema:** 1.11.0
- **Amends:** ADR-0046 (implements clauses 1, 3 and 4), ADR-0066 (spends the capability it declared)
- **Related:** ADR-0044 (focus preservation), ADR-0045 (operations), ADR-0047 (evidence is a read, not a return code), ADR-0004 / ADR-0046 decision 8 (pin B8)

**Introduces protocol schema version 1.11.0.**

## Context

ADR-0066 added the `rawInput` capability and nothing that spends it. This is the
version that spends it: `sendKeyChord` delivers one named key chord to one element.

The errand sweep is why. Dolphin's inline rename commits on Enter, and the sweep
scored it 0/3 before the instruction rewrite and 0/3 after it — not because the
agent was confused, but because no shipped tool could press a key. Every other
failure in that sweep was a literacy problem. This one was an absence.

## Decision

**1. The chord vocabulary is closed, and lives in the schema.**
`keyChordNames` enumerates twenty-one names. A chord outside the list is refused
by name, by the generated validator, before any daemon code runs.

Every other closed vocabulary in this contract closes a word *the daemon decides* —
roles, states, the three ways a capability can be unavailable. This one closes what
a *caller may send*, which is a different kind of closure and the reason it exists:
a free-form key string is an arbitrary-input surface wearing a chord's clothes.
`"Enter"` and `"Control+s"` are a vocabulary. `"any keysym you like"` is a
keyboard, and handing an agent a keyboard is the thing ADR-0046 declined to do.

The list can grow. Growing it is a schema change, in a diff, which is the point:
the day this contract can send `Control+Alt+F2` is a day somebody wrote it down.

**2. It is not an operation, and is not in `operationNames`.**
The four operations describe what an element is *for* and are answered by the
element itself: `setText` reaches an element that publishes `EditableText`, and an
element that does not gets `not-exposed` — a fact about the application. A key is
not like that. It is delivered to whatever the machine is pointing at, and the
element is only how we aim. Targeting does not make it semantic (ADR-0046 clause 1),
so it is its own capability with its own method, and adding it to the operations set
would have been a lie told in a data structure.

**3. Nothing falls back to it.**
There is no code path from a failed `submitElement`, `activateElement` or
`setElementText` into key delivery (ADR-0046 clause 3). A daemon that quietly
retried a refused semantic verb as a keystroke would be one that escalated its own
authority on error — the failure mode that turns a restricted class into an
unrestricted one on exactly the days it matters. This is asserted by a test and
scored by a mutation, not left to inspection.

**4. It is audited as itself.**
A raw-input event is recorded with its own effect class, distinguishable at a glance
from an `activateElement` (ADR-0046 clause 4). The operator reading the audit is the
person that clause protects, and an audit where a keystroke reads like a semantic
action is an audit that hides the one class its reader most wants to find.

**5. The desk is read back afterwards.**
`GenerateKeyboardEvent` returns `()` whether the key landed on the intended element,
on another window, or nowhere at all — measured, not assumed (segment 04 spike). So
the result carries the element as it reads *after* the chord, and the caller compares
that against what it expected. Consistent with ADR-0047: the evidence is a read of
the world, and a return code is not evidence.

**6. Focus is borrowed and given back, and a failure to give it back is reported.**
Delivery is focus → emit → restore, per ADR-0044. The restoration note travels in the
element's diagnostic exactly as it does for a launch. A route that grabbed focus and
moved nothing is caught by reading focus back, never by trusting the grab.

**7. B8 becomes containment, as it was re-specified to.**
`CONTAINMENT_HOME` names the directory holding the delivery implementation. The pin
has said since ADR-0046 that the milestone building the class adds its path *in a
diff*; this is that diff. Because the implementation reaches the accessibility
registry and shells out to nothing, it matches none of B8's banned tokens — so the
boundary is scored against a scratch-tree fixture that plants a banned token inside
the containment path and one directory outside it, in the style of the existing
`sneak.sh` case. A containment entry no test can distinguish from its absence is the
vacuous pin this obligation existed to end.

## Consequences

An agent can press Enter on an element it names, on a machine whose operator armed it,
and nowhere else. The capability is still off by default; this ADR changes what it is
worth turning on, not who may turn it on.

The chord list will be found wanting — the first real errand that needs a chord it does
not have will say so. That is the intended failure: a missing name is a refusal that
names the vocabulary, which is a bug report with a fix that fits in one line of schema.

## Amendment, 2026-09-01: no platform in this build delivers a chord

The route this record was written against was measured on a printable keysym and assumed to carry the
rest of the vocabulary. It does not. On a live KDE desktop the accessibility device controller accepts
`Enter`, `Backspace`, `Escape`, `Delete`, `F2`, every arrow and the `Control+` chords and delivers none
of them, returning success for each — proven against a control keystroke delivered by a different
mechanism to the same window in the same second
(`docs/proofs/04-a-key-addressed-to-one-element.md`).

So `selectKeyDelivery` returns no route on any platform and the capability reports `not-exposed`. That
is this record's clause 5 taken seriously rather than abandoned: the emission's own reply was never
evidence, and here the reply was success while nothing happened. Reporting the capability as available
would have made the daemon the source of the false belief; reporting it as
`disabled-by-configuration` would have sent an operator to add a flag that cannot help.

Everything else in this record stands — the closed vocabulary, the before-call enforcement, the
separate attribution, the read-back-afterwards rule, and the prohibition on reaching a key from a
refused semantic verb. A delivering route arrives with its own measurement, its own containment entry
in pin B8, and a decision about the mechanism it needs.
