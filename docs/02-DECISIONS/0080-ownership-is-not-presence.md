# 0080 - Ownership is not presence

Status: accepted
Date: 2026-09-05
Schema: 1.17.0

## Context

`openApplication` has two jobs it must not confuse. It must never launch a
second copy of something this daemon already started, and it must never launch
over a copy the person started themselves (ADR-0027: a stranger's application is
refused, never killed). Both were answered from the ownership table alone. If
the table said "this name is ours", the request was treated as an idempotent
re-open: nothing was spawned, and the readiness poll simply waited for the
application to appear.

The table records a live process (ADR-0029), and a live process is not the same
thing as an application there to work in. Measured on the demo desk 2026-09-05,
during the wallpaper errand: the agent closed Chromium's last window. Chromium
does not exit when its last window closes - the browser process stayed up, the
ownership entry stayed valid, and with no window there was nothing on the
accessibility bus answering to `Chromium`. Every `openApplication("chromium")`
after that took the idempotent path, started nothing, polled for the whole
budget and refused:

    open: that application did not become readable in time

which was true, and useless. The desk held a live process the caller could
neither reach nor restart, and no sequence of protocol calls could get out of
it. The errand ended there.

## Decision

Ownership answers "may a second copy be started", not "is it there". The desk is
asked in both cases: `openApplication` now reads the application from the
backend before deciding, and an owned name that publishes nothing on the bus is
treated as a name to open again.

Re-opening is the right move rather than a workaround, because it is what a
person does. The catalog entry runs the same command the desktop entry does, and
a browser already running answers that command by opening a window in the
existing session rather than starting a second browser - the handoff prints
`Opening in existing browser session` and exits. The launch the daemon performs
is therefore a window request, and the readiness poll that follows it is
unchanged: it waits for something readable, or refuses.

What did not move is the protection for a copy this daemon does not own. A
readable application nobody here launched is still refused as already running,
never started beside and never signalled.

## Consequences

- An owned application that is alive but publishes nothing is recoverable: the
  next `openApplication` opens a window instead of waiting for one that was
  never coming.
- The idempotent re-open still holds where it was meant to. Ours, readable, and
  asked for again is answered with the application, and nothing is spawned.
- `openApplication` now costs one tree read on the owned path that it did not
  cost before. It is the same read the readiness poll performs on its first
  tick, taken once, before anything is started.
- The launch record can accumulate an entry whose process exits immediately -
  the handoff wrapper does exactly that. The table already fails safe here: a
  dead recorded pid answers "not ours" (`daemon/src/launch/table.ts`), so the
  next request re-reads the desk rather than trusting a stale claim.
- The cost is honest: a desk where the accessibility bus is silent for a reason
  other than "no window" will now be launched into rather than waited on. That
  turns a thirty-second refusal into an extra process, which is the trade this
  decision accepts, because the state it replaces had no way out at all.

Pinned by `daemon/src/__tests__/an-owned-application-with-nothing-to-show-is-opened-again.test.ts`
and the mutation `an-owned-application-that-is-never-opened-again`.
