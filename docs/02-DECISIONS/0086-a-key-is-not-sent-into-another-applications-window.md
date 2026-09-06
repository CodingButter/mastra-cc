# 0086 — A key is not sent into another application's window

Status: accepted
Date: 2026-09-05
Schema: 1.18.0 (no protocol change; refusal class added)

Supersedes the remedy in [0083](0083-a-road-that-is-closed-is-left-for-another-road.md).

## Context

Raw input is not addressed. `typeText`, `sendKeyChord` and `clearElementText`
name an element, but what actually happens is a key going to whichever window
the display server currently gives the keyboard to. This daemon does not raise
windows, so the element named and the window reached can be two different
things.

Measured 2026-09-05 on this desk: an errand aimed typing at a field while
Chromium was the front window. Every key went to Chromium. The daemon answered
`performed`, because by its own contract it had done what it said — it sent the
keys. The caller read that as a filled field.

ADR-0067 already established why the focus read cannot refuse: measured against
a Kate document that provably takes the key, the grab's own boolean answers
`false` while the key lands perfectly, and the tree's focus state names an
unrelated `listitem`. Refusing on either refuses a working press. So the reading
was kept as a diagnostic note and nothing more.

That reasoning holds *inside* one application. It does not hold *across* them.
The focus walk only reports a focused element beneath an ancestor the bus marks
active, so a focused element in another application is not a mis-named node —
it is the keyboard being in another application's window. Every measurement of
the wrong-window case has had that shape.

## Decision

When the focus read names an element belonging to a **different application**
than the element being aimed at, the raw-input verbs refuse — with
`KeyboardHeldElsewhereError`, before anything is sent. The refusal names the
application that would have received the key and points at `clickElement`, since
a real press is what puts a window in front and the keyboard in it.

Three readings deliberately do **not** refuse, because each has been observed
being wrong or empty:

- focus elsewhere in the *same* application — the measured liar of ADR-0067,
  still a doubt note
- a desk where nothing claims the keyboard — an ordinary desktop
- a focus read that failed — the weaker signal must not take a working key down

The refusal precedes the emit. For every other verb the guarantee is read-back,
but a key cannot be un-sent: a wallpaper path typed into a browser's search box
has already happened by the time anything could be compared.

## Consequences

- A caller that gets this refusal has lost nothing; the desk is untouched.
- The remedy is the one a person uses: press the thing, then type into it.
- ADR-0083 sent an unfinishable window to the command line. That remedy is
  withdrawn: this errand is a desktop errand, and the wrong-window bug it was
  really working around is fixed here.
- `KeyboardHeldElsewhereError` joins the closed refusal vocabulary
  (`daemon/src/audit.ts`), which is a deliberate act, not a quiet append.

## Amendment, 2026-09-05

The guard refused a raised window. The focus walk answers with the FIRST
focused element in registry order, and more than one application can carry an
`active` claim at once - a settings dialog in front, a Chromium behind it still
saying it is active. An errand died on that: every attempt to type a path into
the file dialog was told the keyboard belonged to the browser, over and over,
while the dialog was the front window.

So the accusation now needs a second witness that is about the target and not
about the desk in general: walk up from the element, and if a window above it
claims keyboard activation, the key lands here and nothing is refused. The
witness may only ever excuse a press - a read that fails answers false, leaving
the original refusal in place.
