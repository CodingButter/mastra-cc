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
`keyChordNames` enumerates fourteen names (twenty-one as first accepted; seven were withdrawn by the amendment below - a chord this route cannot hold is not a name it may offer). A chord outside the list is refused
by name, by the generated validator, before any daemon code runs.

Every other closed vocabulary in this contract closes a word *the daemon decides* —
roles, states, the three ways a capability can be unavailable. This one closes what
a *caller may send*, which is a different kind of closure and the reason it exists:
a free-form key string is an arbitrary-input surface wearing a chord's clothes.
`"Enter"` and `"PageDown"` are a vocabulary. `"any keysym you like"` is a
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

## Amendment, 2026-09-01: retracted, and the precondition a chord really has

An earlier amendment in this record said no platform in this build delivers a chord, and that the
accessibility device controller accepted every named chord and delivered none. **That is withdrawn.
It was false, and both of its supports were bugs of ours.** The harness that produced it never put
focus on a document — it typed into an editor welcome screen, whose search box accepts a word and
gives it back — and the daemon's synth-type constant was `1`, which is `RELEASE`, where `SYM` is
`3`. The daemon was emitting the release of a key nobody had pressed, and the interface answered
success every time.

What is true, and measured on a live KDE desktop
(`docs/proofs/04-a-key-addressed-to-one-element.md`, and the spike transcript beside it):

- The Linux route delivers. `Delete` sent to a named element in a text editor removed exactly one
  character, confirmed by a second connection holding no raw-input authority.
- **A key follows the display server's focus, not the accessibility layer's.** With another window
  in front, the element cannot even take accessibility focus, the key vanishes, and the emission
  still returns success. Grabbing focus on the target's own window first does not change that.

So the capability is real and conditional: a chord addressed to an element lands when that
element's window is the front one. This daemon does not raise windows on an agent's behalf, and
this record does not ask it to — that would be focus theft dressed as a keystroke, and ADR-0044
settled that question in the other direction. The clause that carries the weight is clause 5: the
caller reads the desk back, so a chord that went nowhere is visible as a chord that went nowhere,
whatever the bus said.

Everything else in this record stands — the closed vocabulary, the before-call enforcement, the
separate attribution, and the prohibition on reaching a key from a refused semantic verb. A second
platform arrives with its own measurement and its own containment entry in pin B8.

## Amendment, 2026-09-01: the chorded names are gone, in schema version 1.12.0

The vocabulary shipped with seven chorded names — `Shift+Tab` and six `Control+` combinations —
and they could not work. The emission uses `SYM`, which synthesises a complete press *and release*
of the keysym it is given, so a modifier sent that way is tapped rather than held. Measured on a
live desk: `Control` `a` `Control` as three `SYM` taps leaves the document exactly as it was, while
the same chord sent as a keycode `PRESS`, a `SYM`, and a keycode `RELEASE` selects the document and
the following `Delete` empties it.

The working form is unavailable to this daemon on purpose. `PRESS` and `RELEASE` take a **keycode**,
not a keysym, and a keycode is a fact about the display server's current keyboard layout. This
daemon speaks to the accessibility layer and never to the display server (pin B1), and a guessed
keycode is a different key on a different layout — the exact class of promise ADR-0047 forbids.

So schema version 1.12.0 removes all seven names. Fourteen single-key chords remain, each one a keysym
`SYM` can express. A caller that asks for a name outside the list is refused with the list, which is
how it should learn the vocabulary shrank. This is clause 2 of this record working as intended: a
closed list is only honest if every name in it does something, and a name that quietly does nothing
is worse than a refusal — the caller believes the desk received a chord it never saw.

A chord with a held modifier arrives when there is an honest keysym-to-keycode route, with its own
measurement. It is not owed by this record.

## Amendment, 2026-09-02: the string surface is admitted, as its own method, by ADR-0070

Clause 1's refusal of a free-form key string is reversed by
[ADR-0070](0070-type-blind-read-back.md): a browser's address bar was measured publishing a
value with no interface to set it, and the keyboard is the only route. The chord list stays closed
and `sendKeyChord` still refuses anything outside it; the string is a separate method, `typeText`,
bounded and printable-only, in the same fenced class with the same gate, aim, read-back and
receipt. Clause 3 — nothing falls back to it — stands for both.
