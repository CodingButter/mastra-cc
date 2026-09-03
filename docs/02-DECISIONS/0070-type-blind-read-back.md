# 0070 — Type blind, read back

- **Status:** accepted
- **Date:** 2026-09-02
- **Schema:** 1.13.0
- **Amends:** ADR-0067 (reverses the refusal of a free-form string; keeps everything else)
- **Related:** ADR-0044 (focus preservation), ADR-0045 (operations), ADR-0046 (raw input is a fenced class), ADR-0047 (evidence is a read, not a return code), ADR-0069 (the measurement that led here)

**Introduces protocol schema version 1.13.0.**

## Context

ADR-0067 closed the chord vocabulary and said why in one sentence: a free-form key
string is an arbitrary-input surface wearing a chord's clothes. This record admits
that surface. It should say plainly that it is a reversal, and what was measured to
justify one.

Measured 2026-09-02 on the demo desk, once ADR-0069 let the daemon see Chromium at
all: the address bar (`Address and search bar`) and the page's `document web`
publish `Accessible, Action, Component, Text, Collection, Document, Hyperlink` —
and **no `EditableText`**. `setElementValue` and `setElementText` answer
`not-exposed`, correctly: the interface is not there. The field has a value that
can be read and no interface through which a value can be set. Electron inputs
behave the same way. There is no non-keyboard route to put a URL into a browser
through the bus.

The alternative considered was to keep the keyboard closed and splice the browser's
remote-debugging protocol into the accessibility tree for page content. That is a
second backend, a matching problem between two trees, and a browser-specific answer
to a question — "the field will not take a value" — that is not browser-specific.
The keyboard is the general answer, and the desk already has one.

## Decision

**1. `typeText` is its own method, in the raw-input class, beside `sendKeyChord`.**
`typeText { id, text }` → `{ element } | { refusal }`. It is not an operation, for
the reason ADR-0067 clause 2 gave a chord: a string typed at the keyboard goes to
whatever the machine is pointing at, and the element is only how we aim. It is not
a widening of `sendKeyChord` either: the chord vocabulary stays closed and
fourteen names long, and `sendKeyChord` still refuses anything outside it. Two
methods, two names, one fence.

**2. The text is bounded, and every control character is refused by name.**
At most 1024 characters, none below U+0020 and not U+007F. A newline is refused as
"a newline is not text, it is the chord `Enter`, sent separately through
`sendKeyChord`"; tab and escape likewise, each naming its chord; any other control
character is named by code point. An empty text is refused rather than performed.
The generated validator refuses the same set at the wire; the daemon refuses it
again, after the authority gate (ADR-0021's ordering: a session without the class
is told about the class, not handed a critique of its string).

This is what keeps the string from becoming a keyboard. A string that could carry
`Enter` is a chord vocabulary with no list; a string that can carry only printable
characters is a field entry, and a field entry is the whole of what was missing.

**3. Same gate, same aim, same read-back, same receipt.**
`--allow rawInput` is required and checked before the call; a session without it is
refused naming the flag, and the backend is not touched. The route is
`GenerateKeyboardEvent` with the `STRING` synth (`4`, verified against the live
enum): one emission carrying the whole text, never one keysym per character.
Delivery is focus → emit → restore per ADR-0044, with the same aim-doubt diagnostic
ADR-0067 attached to a chord. The result is the element as it reads *afterwards*
(ADR-0047), and the audit record carries the raw-input effect class with the
method's own name.

**4. Nothing falls back to it. Still.**
ADR-0067 clause 3 stands and is re-pinned here: there is no path from a refused or
failed `setElementValue` / `setElementText` into `typeText`. The only edges into
the daemon's typing handler are its declaration and the dispatch entry; the only
call to the string emitter in the accessibility seam is from `typeText`. Both are
asserted against source, and the behavioural half — a refused set, in a session
that holds the authority to type, types nothing — is a test with a mutation
scored against it.

The fallback lives in the **agent**, on purpose, and the shipped instructions say
so in this order: prefer the field's own `setElementValue` / `setElementText`;
only when the field answers `not-exposed` do you focus it and type blind; and you
always read the field back and compare before believing anything. That ordering
is what makes the reversal safe to make: the daemon never escalates its own
authority on error, and the caller who chooses the keyboard is the one who reads
the evidence.

**5. CDP and replay refuse.**
Neither has a keyboard; both say so with the platform sentence and name no setting.

## Consequences

An agent can put a URL into a browser's address bar, or text into an Electron
input, on a desk whose operator armed raw input — and the read-back tells it
whether the text arrived. The demo desk arms `--allow rawInput` deliberately now,
and its comment says it demonstrates the fenced route rather than its absence.

The cost is the one ADR-0067 named: this contract now carries an arbitrary-input
surface. It is fenced the same way, bounded, refused by name at every edge that
would let it grow, and read back. That was the best available answer to a field
that has a value and no way to set it; it is not a general licence to type, and
the instructions say so.

## What was measured

- Live enum on the demo desk: `SYNTH_STRING = 4`, `SYNTH_SYM = 3`.
- `typeText("example.com")` at the address bar, then `sendKeyChord(Enter)`: the
  window title read `Example Domain - Chromium` on an independent X query. The
  wire transcript and the Playwright transcript are beside this record in
  `.mastracode/plans/type-blind-read-back.proof/`, base leg (method unknown) and
  branch leg (page reached).
