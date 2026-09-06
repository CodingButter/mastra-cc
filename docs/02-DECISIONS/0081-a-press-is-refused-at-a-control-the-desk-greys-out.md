# 0081 - A press is refused at a control the desk greys out

Status: accepted
Date: 2026-09-05
Schema: 1.17.0

## Context

`clickElement` (ADR-0078) presses inside an element it named, and everything it
refuses is about PLACE: no rectangle, an empty rectangle, a rectangle off the
screen. Place was the whole worry, because a pointer that aims at a coordinate
cannot say afterwards what it hit.

Place is not the only way a press can be spent on nothing. Measured on the demo
desk 2026-09-05, during the wallpaper errand: the settings window's `Apply`
button published

    states: ["visible"]

while every live button beside it - `Cancel`, `Downloads`, `Add Wallpaper
Image...` - published `enabled` as well. `Apply` was greyed out, because the
image had never been taken by the file chooser and there was nothing to apply.
The press was aimed correctly, landed inside the button's rectangle, and did
nothing at all. It came back a success. The errand read the button afterwards,
saw a button unchanged, and reported the wallpaper as set. The desktop
configuration never received an `Image=` key. A person watching the screen would
have seen a grey button and understood immediately; the caller was told it had
worked.

That is the failure this contract exists to prevent. A method may fail, and may
refuse, but it may not hand back a success that licenses a false report.

## Decision

A press at a CONTROL the desk greys out is refused before any pointer event is
sent.

The reading is the platform's own. The accessibility bus publishes ENABLED and
SENSITIVE, and this daemon already maps either one to the neutral state
`enabled` (`daemon/src/backends/atspi/roles.ts` - GTK4 sets SENSITIVE without
ENABLED, so both count). A control that publishes neither is greyed out. Nothing
is inferred, computed, or guessed: the element is asked, and the answer is
believed.

Only roles a toolkit greys out are held to it - `button` and `checkbox`. A web
page is not a toolkit: its generic nodes carry most of a page's clickable area
and publish no enablement at all, and holding those to this reading would refuse
every press on a search result. The narrow set is the point. It grows only when
a live desk shows another role publishing enablement it means.

The refusal names the reading rather than a remedy, because the remedy differs
by desk: something must happen first to wake the control, and only the caller
looking at the window knows what.

## Consequences

- A press on a greyed-out button is a refusal, not a success. A caller cannot
  build a report on it, which is the entire reason for the change.
- The refusal arrives before the pointer moves, so a dead press costs no event
  on the desk.
- `clickElement` now reads a role and a state before it presses - two exchanges
  it did not make before, on every press.
- A toolkit that greys a control out without publishing it will still be pressed
  into. This daemon cannot see what the desk does not say, and does not pretend
  to.
- A control that publishes enablement wrongly - marked enabled while inert - is
  pressed as before. The reading is only as good as the platform, and the
  read-back after the press remains the caller's second witness.

Pinned by `daemon/src/__tests__/a-press-inside-one-element.test.ts` and the
mutation `a-press-spent-on-a-control-that-is-greyed-out`.

## Amendment, 2026-09-05: the same grey through the other door

The guard stood only at `clickElement`. Measured the same night: a run refused
at Plasma's `Apply` by the pointer performed the button's OWN published `Press`
through `activateElement` instead, was answered with a bare success, and
reported a wallpaper the desktop configuration never received - the exact
failure this decision exists against, reached by the other door.

The enablement check now stands at both, for the verbs that ACT (`Press`,
`Click`, `Activate`, `DoDefault`, `Toggle`). Verbs that do not act are
deliberately untouched - `SetFocus` above all, because giving a form its focus
is what a caller does BEFORE the control it feeds ever wakes, and refusing it
would close the road this fix opened (ADR-0084).

The cost is a word list. A toolkit publishing some sixth name for activation
gets past the guard, and the list is a thing to maintain rather than something
the platform tells us. Receipts:
`daemon/src/backends/atspi/index.ts` (`ACTIVATING_ACTIONS`, `refuseGreyControl`),
`daemon/src/__tests__/a-press-inside-one-element.test.ts`, mutation
`a-press-that-slips-in-through-the-elements-own-verb`.
