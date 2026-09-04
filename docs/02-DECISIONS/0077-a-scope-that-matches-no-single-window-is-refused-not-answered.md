# 0077 — A scope that matches no single window is refused, not answered

**Status:** accepted
**Date:** 2026-09-04

## Context

`queryElements` and `discoverElements` take an optional `window` beside their `application`
(ADR-0073). The scope narrows what is observed; it grants nothing. The backend resolves it by
name against the application's visible top-levels and then reads that one window.

Until now, when the name did not resolve to exactly one window, the backend skipped the
application and the method returned an empty answer. Two quite different situations produced
that same empty answer, and neither of them is empty:

- **No window answers to the name.** The caller misremembered a title, or the window has
  closed since it was last read. The truthful answer is that the scope names nothing.
- **Several windows answer to the name.** Measured on 2026-09-04: Plasma's file dialog
  publishes two visible top-levels both named `Open Image`. The scope is ambiguous, and
  picking one of them would be the daemon guessing which window the caller meant.

An empty list is a sentence about the window's contents. The daemon had no grounds for it in
either case. The cost is not theoretical: an agent asked to pick a wallpaper scoped its query
to `Open Image`, was told the dialog held no controls, and stopped — while an unscoped query
of the same desk, at the same moment, returned a hundred and fifty elements including the
dialog's file list and its `Open` button. The daemon's silence, not the desktop, ended the
errand.

## Decision

The backend refuses instead of answering, and the two cases are two refusals.

1. **Unmatched.** No visible window of the application carries the name. The backend throws
   `WindowScopeUnmatchedError`; the daemon answers with refusal class `WindowScopeUnmatched`.
2. **Ambiguous.** More than one does. The backend throws `WindowScopeAmbiguousError`; the
   daemon answers with refusal class `WindowScopeAmbiguous`.

They are separate because their repairs are opposite. Unmatched means *look again* — list the
windows, take a name from what is actually there. Ambiguous means *stop narrowing* — drop the
`window` and read the application, because no name will separate two windows that share one.
A single "scope did not resolve" sentence would leave the caller unable to choose between the
two, which is the failure this ADR exists to end.

Replay answers the same way. Its tape is a record of what the live backend did, so a scope the
tape cannot resolve refuses exactly as the live backend refuses; replay does not get to be
emptier or more certain than the desk it recorded.

An unrelated backend failure — the bus going away mid-read — is untouched by this and keeps
its own refusal. Only these two conditions become these two sentences.

## Consequences

A caller that scoped by window and got an empty list will now get a refusal instead. That is
the point: the empty list was wrong, and code that treated it as "this window has nothing in
it" was drawing a conclusion the daemon never had. Callers that read the refusal have a repair
to make; callers that ignore it are no worse off than they were.

The agent instructions say what to do with each: re-list on unmatched, drop the scope on
ambiguous. Discovery (ADR-0074) is unchanged in what it publishes; it only stops publishing an
empty vocabulary for a window it never found.
