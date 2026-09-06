# 0084 - A field that names its own way to the focus

Status: accepted
Date: 2026-09-05
Schema: 1.18.0

## Context

Every verb here that presses a key focuses first, and focus went through exactly
one road: `Component.GrabFocus` (ADR-0044). An element publishing no Component
interface was refused with "this element does not expose being given the focus".

That refusal was measured to be wrong on a control that is plainly focusable.
On this desk (2026-09-05, wallpaper errand attempt 32) the KDE file dialog
behind `Add Wallpaper Image…` publishes its file-name entry as:

    role=text  name=""  states=[enabled]
    interfaces=[Text, Action]        <- no Component
    actions=[SetFocus]

Probed live through the daemon (`/tmp/probe-type.mjs`), `typeText` at that
element refused for want of a focus route, while the SAME call at the filter
combobox beside it succeeded — so the run typed a path into the filter, pressed
Enter, and got four stacked dialogs and no wallpaper. The one field the dialog
exists to be given was the one field the contract could not reach.

## Decision

When an element publishes no `Component`, `grabFocus` performs the element's OWN
published action named `SetFocus` instead, through the ordinary `performAction`
route — which re-reads the action's name per index before performing it, so the
word is exact and came from the element.

This is not a nearest match and not a role table. `SetFocus` is a single exact
word; an element that publishes actions but not that one falls through to the
same refusal as before, in the same words. Component remains the first road
wherever it exists, so nothing that worked yesterday takes a different one.

## Consequences

The cost is a second road into the focus, and two roads mean a caller can no
longer read a successful focus as "this element publishes Component". Worse, the
Action road goes through the application's own handler rather than the
accessibility component, so what it does is whatever the toolkit decided
`SetFocus` means there — including nothing at all. That is survivable only
because nothing here trusts the reply: `grabFocus` reports the platform's
decline, never its success, and every caller that presses a key afterwards still
reads the world back and compares (ADR-0047).

The gain is that a file chooser is reachable at all. The KDE dialog is not
exotic; a toolkit publishing Action without Component is a shape this contract
will meet again, and refusing it left an errand with no route that did not go
through a terminal.

Receipts: `daemon/src/backends/atspi/effects.ts` (grabFocus),
`daemon/src/__tests__/a-field-that-names-its-own-way-to-the-focus.test.ts`,
mutation `a-focus-that-only-knows-one-road`.
