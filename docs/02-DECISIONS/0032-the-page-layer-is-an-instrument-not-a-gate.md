# 0032 — The page layer is an instrument, not a gate

**Status:** accepted, 2026-08-09.
**Forced by:** the coverage count in
[what a page-level recorder observes](../proofs/what-a-page-level-recorder-observes.md),
closing G6 in [09-QUESTIONS.md](../09-QUESTIONS.md).

## Context

A script injected before any page script runs can see a great deal: it can wrap the methods
a page uses to act, and report every call with a timestamp and an element. The idea that
follows is seductive — make that layer a permission gate, and every action inside the page
is checked at the point it happens.

It was measured rather than argued about, and deliberately in its **best** form rather than
as a strawman. Eight ways to cause one effect were enumerated and a document-start layer was
asked, for each, whether it saw it.

**Five of eight.** It missed a `fetch` inside a Worker, a same-process iframe's native
methods, and a trusted click dispatched over the browser protocol. Two of those are one
line of page code each: dispatching a synthetic event fires the real handler while a patched
method never sees it, and a freshly created same-process iframe hands back clean, unpatched
natives — with no separate target created, because a same-process frame is an execution
context inside its parent rather than a target of its own.

A gate with three known holes, two of which are trivially reachable, is not a gate.

That leaves the question of where the boundary actually is, and the answer turned out to be
better than the one we were trying to build. **The browser profile is the fence**, enforced
by Chrome rather than by us: the agent cannot reach an account that is not signed in inside
that profile. **The daemon's verbs are the gate**, out of reach of anything running in the
page. And this layer is neither — it is the **highest-resolution instrument available**,
seeing the page's own code in a way no accessibility stream can.

## Decision

**The injected page layer records. It never enforces.**

1. **It is documented as an instrument in the code that installs it**, not merely here.
   A comment saying so is what stops someone removing the daemon-side check in six months
   because "the page layer already covers this".
2. **It records shapes, never values** — identity, role, revision, counts. Never content.
   Redaction happens at write time here, uniquely, because this record is *authored* rather
   than derived, so there is no later opportunity to remove what was never separated.
3. **It must be re-armed per attached session, recursively.** A cross-site frame does not
   attach automatically; it attaches only after re-arming on the parent's session.
   Otherwise coverage silently stops at the first frame boundary — silently being the
   problem, since the recorder keeps reporting successfully.
4. **Unmatched effects are labelled `external`, not flagged.** This replaces an earlier
   rule that any effect not corresponding to an audited verb call is a divergence event.
   That rule was measured against a live application and fires constantly during correct
   use: a human typing, a notification arriving, a contact coming online. **A tripwire that
   screams during normal operation gets switched off within a week**, and then the
   instrument is gone too.
5. **The use of attribution is knowing when to yield, not when to alarm.** We know what we
   issued and when. If a task is in flight and the user starts typing in the same box, the
   correct response is to notice and yield.
6. **Any coverage claim about this layer is a tested number.** Never an argument.

## Consequences

**The cost.** We do not get in-page enforcement, and every effect must still go through the
daemon's verbs — not for security, but for accounting. Without that, the audit record
cannot name the element, a workflow has nothing to record and is neither replayable nor
pre-approvable, and the improvement measurement has no instrument. The daemon is not only
the guard; it is the measuring device.

Clause 4 gives up a real security property: a genuinely rogue in-page action is labelled
rather than blocked. Given clause's the 5-of-8 measurement, that property was never actually
available — the earlier rule offered the *feeling* of enforcement, which is worse than
having none, because it would have been relied upon.

**What we keep:** timestamped, element-precise, causally attributable observation of what a
page actually did, at a resolution no other route provides.

## Evidence

- [what a page-level recorder observes](../proofs/what-a-page-level-recorder-observes.md)
  — 5 of 8, with each path marked observed or missed. The spike **refused to write a
  number twice** before producing one, because a path it claimed to test had not actually
  fired: a coverage number computed over paths that did not fire is a lie with a decimal
  point.
- [what the browser protocol gives us](../proofs/what-the-browser-protocol-gives-us.md) —
  a document-start script proven to run before page script by having the page's own script
  read a value only the init script could have set; and a cross-site frame that does not
  auto-attach until the parent session is re-armed.
- [can we subscribe to element changes](../proofs/can-we-subscribe-to-element-changes.md)
  — the push channel this instrument reports over, measured at 253ms from cause to
  observation. That spike also produced a **fake pass** on its first run, reporting "did
  not fire" when nothing had happened during its window; it was rewritten to cause its own
  event and refuse otherwise.
