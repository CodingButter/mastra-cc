# 0085 - A typing that changed nothing is not a typing

Status: accepted
Date: 2026-09-05
Schema: 1.18.0

## Context

Raw input is aimed but not addressed: keys go to whatever window the desk holds
in front, and this daemon does not raise windows (ADR-0070). `sendKeyChord` and
`typeText` therefore returned the element read back afterwards together with a
DOUBT — "the focus may not have been where this was aimed" — and made no verdict.
For a chord that is honest: a chord can succeed and leave an element reading
exactly as it did before, so there is nothing to compare against.

Typing is not like that. Text that arrives makes the element's own published
text longer. Measured 2026-09-05 on this desk, that difference mattered: one
press of Plasma's `Add Wallpaper Image…` opens TWO windows called "Open Image",
at the same geometry — `xdotool search --name "Open Image"` reports `8388664` and
`8388666`, both mapped at `560,271 600x400`. Only one is in front. Typing the
wallpaper path at the file-name entry of the twin behind sent real keys into the
front window's field, the named element read back empty, and `typeText` answered
`performed`. The errand above it read that as a filled chooser, pressed `Open`,
watched nothing happen, and reported a wallpaper the desk never received.

## Decision

`typeText` reads the named element's text before the keys and after them. When
both reads are readable, the typed string is not empty, and the text is no
LONGER than it was, the verb refuses: the keys were sent, and they did not
arrive here.

The refusal names the count on both sides, says that a key reaches an element
only while that element's window is the front one, says that a desk can hold two
windows of one name, and points at the way out that was measured to work —
`clickElement`, which puts the window it lives in in front, and then type again.

Three cases are deliberately NOT accused, because in each the check would be
inventing a fact it does not have:

- an element whose text this daemon cannot read — nothing to compare
- a typing of the empty string — no claim was made
- a field that took the text — length grew, however little

## Consequences

`typeText` joins `clearElementText` as a raw-input verb with a verdict, and for
the same reason: it has an intended state to check. `sendKeyChord` keeps its
doubt and no verdict, because it still has nothing to compare.

A password-style field that publishes masked text of a fixed length, or none,
now refuses a typing that in fact landed. That is the trade taken knowingly: a
refusal that can be retried after a click is cheaper than a success that was
never true. A field publishing no readable text at all is untouched.

The twin-window desk is not fixed by this — it is made VISIBLE. The contract
still cannot raise a window; what it can now do is refuse to pretend the keys
went where they were aimed.

## Amendment, 2026-09-05

Zero growth was only the loud half. Measured the same day in Dolphin's location
field: seventeen characters were sent into a field that had just been given the
focus, sixteen arrived, and the leading key was eaten while the widget settled.
The field HAD grown, so this guard said nothing and the errand navigated to a
path that did not exist.

So the comparison is now against the count that was sent, not against zero: a
field that grew by fewer characters than were typed is refused, told how many
arrived, and told to empty the field and type again rather than to type the
missing part on top of what is there.
