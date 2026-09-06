# 0087 — A window is raised from the task bar

Status: accepted
Date: 2026-09-05
Schema: 1.18.0 (no protocol change; three refusal messages and the prose)

Refines the remedy in [0086](0086-a-key-is-not-sent-into-another-applications-window.md).

## Context

ADR-0086 gave raw input the refusal it was missing: a key aimed at an element
inside one application, while another application holds the keyboard, is now
refused before anything is sent. The refusal named the application that would
have received the key, and then told the caller what to do about it — press the
element with `clickElement`, "a real press puts that window in front".

That advice is wrong, and the first errand run after the refusal landed proved
it. Measured 2026-09-05: an errand was told four times that the keyboard
belonged to `dolphin` while it aimed at Chromium's address bar. Four times it
did as it was told and pressed the Chromium window with `clickElement`. Four
times the press was performed, and four times the next key was refused for the
same reason. Then it stopped and reported the errand impossible.

`clickElement` cannot raise a window, and the reason is the same reason it is a
trustworthy pointer at all: it presses a point inside the rectangle the platform
publishes for the named element. A window that is behind another window still
publishes its whole rectangle. The point computed inside it belongs, on the
screen, to whatever is stacked on top — so the press lands in the covering
window and raises *that*. The advice sent the caller into a loop that made the
situation it was meant to fix slightly worse each time round.

## Decision

The desk already has the thing a person uses, and the desktop shell publishes
it: the task bar carries one `button` per running application, and that button
answers `Press`. Measured on this desk with Dolphin in front and Chromium
behind: `activateElement` with `Press` on the shell's `"Chromium Web Browser"`
button moved the active window to Chromium. A pointer press aimed at the same
button did not — one more reason the semantic action is what gets named.

So the three refusals that ask for a window to be brought forward —
`KeyboardHeldElsewhereError`, the `typeText` read-back, and the zero-progress
`clearElementText` — now name the task bar, name `activateElement`, and say
plainly that pressing inside the window itself does not raise it. The prose says
the same, and says why.

No new verb, no protocol change, no new authority: raising a window this way is
a press on a button the shell publishes, which the caller was always permitted
to make. The daemon still does not raise windows on its own initiative — it
tells the caller where the handle is.

## Consequences

- A caller that is refused for the keyboard now has a move that works, and the
  move is the one a person makes.
- The advice is only as good as the shell. A desktop without a task bar, or one
  whose shell publishes no button for the application, leaves the caller with
  the refusal and no remedy — which is still better than the loop.
- `clickElement` keeps its meaning: it presses a place inside a thing. It was
  never a window manager, and no longer pretends to be one.
