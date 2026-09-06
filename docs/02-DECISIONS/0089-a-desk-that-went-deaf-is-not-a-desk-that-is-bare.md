# 0089 — A desk that went deaf is not a desk that is bare

Status: accepted
Date: 2026-09-05
Schema: 1.19.0 (no protocol change; one refusal class and two observation routes)

## Context

Measured 2026-09-05 on the demo container. The daemon was started with
authority to switch the accessibility layer on, did so at startup, and served
an errand for several minutes. Then something on that desktop — a browser that
crashed, a shell that restarted its bus, it does not matter which — wrote
`org.a11y.Status.IsEnabled` back to `false` underneath it.

Every observation after that answered emptily. No applications, no elements.
That is precisely the shape a desktop with nothing running answers with, so the
errand read it the only way it could: the desk is bare, there is nothing to
drive, stop. It reported failure against a desktop that had a browser, a file
manager and a settings window open on it.

The daemon knew better and said nothing. It held, at that moment, both the
empty answer and a readable property saying the layer was off.

## Decision

Emptiness with the layer on is an answer. The same emptiness with the layer off
is silence, and answering silence as though it were an answer is the false
belief this daemon exists to refuse.

`queryElements` and `discoverElements` now ask the layer one question, and only
when the answer they are about to give is empty — a query that found something
has already proved the desk can be heard, and pays nothing. If the layer reads
`disabled`, the caller gets a refusal that says the desk answered nothing
because its layer is off, *not because nothing is running*, under the new
refusal class `AccessibilityLostMidSession`.

Authority is unchanged by this. A session started without
`--acquire-accessibility` may not switch anything on, and does not: it refuses
and says why. A session started with it was granted that act for its lifetime,
and an authority that evaporates the first time the desktop resets a property
is not an authority — so that session switches the layer back on and says so.

Nothing is retried on the caller's behalf. What goes back is a refusal naming
what happened and inviting the same question again, so the next call is the
caller's decision and its result is its own observation.

A layer that cannot be *read* is left alone. That is a different question and
`describeAccessibility` is the verb that answers it.

## Consequences

- An errand can no longer conclude "the desk is bare" from a desk that went
  deaf; it is told the difference and can carry on after one retry.
- The recovery costs one property read per empty answer, and nothing at all on
  any answer that found something.
- `AccessibilityLostMidSession` is distinct from `AccessibilityNotAcquired`:
  the first says a granted layer was taken away mid-run, the second says it was
  never obtained.
