# 0051 — What always-on-top is worth under a focused full-screen window

- Status: accepted
- Date: 2026-08-22
- Relates to: [0016](0016-the-face-is-a-managed-window-that-hides-when-told.md) (conditions decision 1), [0012](0012-claims-needing-a-desktop-are-proved-by-artifact.md), M4 segment 1

## Context

ADR-0016 decision 1 says the face is a window the window manager manages, and
that managed means `_NET_WM_STATE_ABOVE` is honoured and the window has a place
in the stacking list. Its Evidence table records the prototype's live run and
enters, among the claims it proved, this one:

> live verification: managed, `_NET_WM_STATE_ABOVE` present, in the stacking
> list, **survives a full-screen window**

The M4 exit gate carried that phrase forward as an unconditional box: *a raised
full-screen window does not bury the face* (`docs/07-ROADMAP.md:228`). Read
plainly, that says the face is on top of everything, always, and that is what
this milestone set out to reproduce.

It is not what happens. Measured on 2026-08-21 and again on 2026-08-22 on the
repository's own two-output X11 desk (`infra/x11-desk.sh`, Xorg `dummy` driver,
openbox 3.6.1), with only harness-opened windows on the desk:

| Condition | `xprop -root _NET_CLIENT_LIST_STACKING`, bottom to top |
|---|---|
| face shown, full-screen window raised **and focused** | face, then the full-screen window |
| same full-screen window, focus moved away | the full-screen window, then the face |

The window manager promotes a **focused** full-screen window into a layer above
the ABOVE layer. That is not an openbox quirk to be worked around: it is the
behaviour every EWMH window manager implements deliberately, because a user
watching a film full-screen should not have widgets floating over it. Setting
`_NET_WM_WINDOW_TYPE_DOCK` on the face does not change it — measured, same
result.

The moment focus leaves that window, the face returns to the top of the
stacking order on its own, with no action by the widget.

Two facts made the discrepancy easy to miss. The prototype's claim was almost
certainly true as tested — a full-screen window that the tester raised but did
not focus does not bury the face, and that is the more common case in a demo.
And the failure is invisible from inside the application: the face still holds
`_NET_WM_STATE_ABOVE`, still appears in the client list, still believes
everything decision 1 promises. Only the stacking order read out of the X server
disagrees, which is exactly why ADR-0012 requires the measurement to come from
outside the process making the claim.

## Decision

**1. The always-on-top guarantee is stated with its condition.** The face stays
above other windows except while a full-screen window holds focus, and it
returns to the top by itself when that window loses focus. Both halves are the
guarantee; neither half alone is.

**2. Decision 1 of ADR-0016 stands unamended.** Nothing here weakens it. The
prototype's bug was an *unmanaged* window, where ABOVE was silently discarded
and "on top" degraded into raw stacking order that any window could bury at any
time. A managed window that yields only to a focused full-screen window is the
correct behaviour arrived at correctly. What changes is the sentence describing
it, not the window model.

**3. No remedy is implemented, because the behaviour is not a defect.** Forcing
the face above a focused full-screen window is possible — override-redirect
would do it — and it is precisely the prototype's first wrong model, which
ADR-0016 exists to record. A user who has put a window full-screen and is
looking at it is a user who wants that window. The face waiting its turn is the
product behaving well.

**4. The exit box is ticked with its condition in a footnote, not reworded in
the roadmap.** This follows the split-tick rule Jamie set during M3: the
divergence goes in the tick, never in the roadmap master's wording. A reader
comparing the box to the artifact finds the condition rather than a
contradiction.

**5. The harness scores this box as `measured`, not `pass`, and refuses to
render an unconditional claim.** `tools/proofs/window-model.mjs` measures both
halves and writes both rows. Its overclaim guard rejects any artifact sentence
asserting the face survives a full-screen window without naming the focus
condition, and that refusal is unit-tested. An artifact that overclaims is worse
than no artifact (ADR-0012).

## Consequences

**Good.** The claim in the artifact is one a stranger can reproduce and will not
find false the first time they try it, which is the only kind of claim worth
writing down.

**Good.** The condition is now written where the next person meets it — the
roadmap box, the artifact and this record agree, and the harness cannot silently
start claiming more than was measured.

**Cost.** The face can be buried, and a user in that state has no visual
indication the assistant is trying to reach them. Nothing in this milestone
addresses that. Notification when the face cannot be seen is a real product
question and belongs to whichever milestone gives the face something urgent to
say; recording the gap here is the honest half.

**Cost.** This was measured under one window manager. openbox is a real EWMH
implementation and the behaviour it shows here is the specified one, but a
different window manager may stack differently, and nothing in this repository
would notice. The artifact states this limitation rather than implying
generality.

**Cost.** The M4 exit gate now has a box that reads as conditional rather than
green, which is worth less at a glance. It is worth more when someone acts on
it.

## Evidence

| Claim | Source |
|---|---|
| focused full-screen window stacks above the ABOVE face | `docs/proofs/what-the-face-does-on-a-real-desk.md`, box 3, measured row |
| the face returns to the top when focus leaves | same artifact, box 3, second row, `**pass**` |
| `_NET_WM_WINDOW_TYPE_DOCK` does not change the outcome | measured 2026-08-21 during M4 planning, same desk, both window types tried |
| the face keeps `_NET_WM_STATE_ABOVE` throughout | same artifact, box 2 |
| the harness refuses to write an unconditional claim | `tools/proofs/window-model.mjs` overclaim guard; `tools/proofs/__tests__/window-model.test.mjs` |
| the prototype's original unconditional claim | ADR-0016 Evidence table, "PR #228 live run on a 3840×1080 two-monitor X11 desk" |
| the exit box's plain wording | `docs/07-ROADMAP.md:228` |
| split-tick rule for a diverging box | Jamie, 2026-08-21, M3 exit gate |
