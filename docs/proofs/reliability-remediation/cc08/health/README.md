# CC-08: degraded coverage says so at the root

Plan §11: "When coverage is degraded, an authorized root-level watch-health
indication is safer than pretending the stream is complete or exposing a
possibly out-of-scope descendant. Use the existing watch-health/error contract
where possible; propose a schema change only where necessary."

## Before

`signal-stream.ts` classified a signal's membership as inside / outside /
unknown and emitted only for inside. Unknown - a parent read that failed or
answered nothing, a climb that hit `MAX_CLIMB`, a cycle - produced silence,
identical to outside. A caller could not tell "nothing in your subtree changed"
from "something changed and I could not place it". `cc08/reparent` proved the
inside/outside edges live; this is the third edge.

## Change

Unknown membership now delivers a content-free `changed` on the **watched
root** - the one element the watch is authorized to speak for - under the same
100 ms backstop as every other change, so a flood of unplaceable signals is one
nudge per window plus one trailing. The descendant is never named: the walk
never proved it in scope. `outside` is still silent. No schema change:
`changed` on the root is already in the vocabulary and already means "observe
again".

Fixture realism: on the wire an application root's `Parent` is the registry's
desktop on the registry's own bus name, which is how a climb learns it has
left the application. The unit fixture had no such edge and answered "no
parent" for the application root, which would now read as unknown; it answers
the registry edge, as the bus does.

## Evidence

- Unit (scripted bus): unreadable parent → root nudge, then the element by
  name once readable; 20 unplaceable signals → one nudge plus one trailing;
  cycle / depth / throw each → one root nudge, bounded reads unchanged (24 or
  1); sibling outside the subtree → still silent; close during a pending parent
  read → still nothing. `signal-subscription.test.ts`, 30 passing.
- Mutation `degraded-coverage-goes-quiet-instead-of-saying-so` (drop the
  nudge) → 5 tests red. `a-watch-that-speaks-for-the-whole-application`
  re-anchored to the new `outside` return; still caught.
- Live (`live/`): the `cc08/reparent` GTK fixture rerun on the repaired daemon
  from this tree (`declaration.json`, `daemon-command` in `session.txt.gz`).
  All five phases pass; in particular **moved-right and moved-to-annex are
  still silent** - real GTK ancestry reads to the registry edge and classifies
  as outside, so the change introduces no spurious nudges on a healthy desk.

## Not shown

A live degraded case. A healthy GTK application answers every `Parent` read;
inducing an unreadable ancestor on a real bus (a hung peer mid-tree) was not
staged here. The degraded edge is proven on the scripted bus only, and this
README says so.
