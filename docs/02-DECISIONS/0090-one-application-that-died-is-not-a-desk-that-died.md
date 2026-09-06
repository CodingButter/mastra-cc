# 0090 — One application that died is not a desk that died

Status: accepted
Date: 2026-09-05
Schema: 1.19.0 (no protocol change; one refusal and the demo's application catalog)

Same family as [0089](0089-a-desk-that-went-deaf-is-not-a-desk-that-is-bare.md):
an answer that is true of one thing, published as though it were true of
everything.

## Context

Measured 2026-09-05 on the demo container. A window this daemon had opened
crashed mid-run. Every call after that which touched an element inside it came
back from the bus naming that one peer — `org.freedesktop.DBus.Error.NoReply`,
body `Message recipient disconnected from message bus without replying`. The
backend threw, and the server did what it does with anything a backend throws:
answered `the desktop could not be read by this session's backend`.

A browser, a file manager and a settings window were open at the time. The
errand read the blanket refusal the only way anyone could, said it was
completely blocked from every desktop interaction, and stopped — on a desk that
was almost entirely healthy.

The blanket refusal exists for a good reason (commit 98ac7fd: a raw system
error leaks transport and platform vocabulary onto the wire). Its fault is not
that it hides the cause; it is that it *widens* it.

## Decision

The channel classifies the three bus errors that name a dead peer —
`ServiceUnknown`, `NoReply`, and a recipient that disconnected without
replying — and throws `PeerGoneError` rather than a bare `Error`. The server
answers that class with its own refusal: the application this element belonged
to is no longer running, ask what is on the desk again, the rest of the desk is
still there.

No peer name crosses the wire. `:1.14` is bus vocabulary, and the caller has no
use for it; what it *means* and what to do next is the whole of the answer.
Anything the channel cannot attribute to a single peer still gets the blanket
refusal, because a failure that names nothing should not pretend to.

Separately, and for the same errand: the demo's default application catalog no
longer offers `konsole`. The prose has told the errand for two revisions that a
desktop errand is done on the desktop, and the run of 2026-09-05 opened a
terminal anyway. An operator who lists a terminal among the applications is
making an offer, and the honest fix for an offer that should not be taken is to
stop making it. `gwenview` takes its place, which has "Set as Wallpaper" in its
own menu. `DESK_DEMO_APPS` puts a terminal back for an operator who means it.

## Consequences

- An errand that loses one window is told which one and can carry on; it can no
  longer conclude the desk is dead from a single crash.
- The classifier reads the bus error's text. If a bus ever words those errors
  differently, the narrowing quietly stops applying and the blanket refusal
  returns — which is the safe direction to fail, but it is a text match.
- `NoReply` is also what a peer that is merely *wedged* returns. Such an
  application is called gone when it may only be hung; both are answered the
  same way — query again — so the advice holds either way.
- The demo desk has no terminal by default. An operator who wants one has to
  say so.

## Amendment, same day

The same widening exists one level down. A call aimed at an element whose node
has been destroyed — a dialog that closed, a page that redrew — comes back as
`org.freedesktop.DBus.Error.UnknownObject`, and became the blanket refusal too.
Measured 2026-09-05: a run that had merely outlived a closed dialog was told the
desktop could not be read while a browser and a settings window were open on it.

`ElementGoneError` is the third class: that element is no longer on the desk,
ask what is there now and work from the ids in that answer. It does not accuse
the application of dying, because the application has not.
