# CC-08 degraded ancestry, induced on a real bus

`PROOF: GREEN` — six phases, one GTK3 application, one private accessibility
bus, no model and no network.

The daemon's watch rule is that only PROVEN membership emits, and that
membership is re-read for every signal rather than cached. The
[reparenting proof](../reparent/README.md) covers the two provable answers:
inside emits, outside is silent. This one covers the third answer, which is the
reason the rule is phrased that way at all — **unknown**.

## Inducing it, rather than simulating it

Unknown ancestry was previously only reachable through fakes, because it is a
race in normal use: a parent read that fails because the tree changed underneath
it. The fixture makes it deterministic and real. It removes the text view from
its parent while keeping a live reference to it, so the widget is still on the
bus, still emitting change signals, and has **no parent to climb to**. Nothing
was destroyed, so nothing announces `defunct`. The daemon is simply told about a
change it cannot place.

## What was measured

| Phase | Expected | Observed |
| --- | --- | --- |
| in-left | inside: emits | 2 changes on the Left watch |
| moved-right | outside: silent | 0 |
| back-in-left | inside: emits | 2 |
| moved-to-annex | outside: silent | 0 |
| destroy-annex | one `watchEnded`, element gone | `changed`, `watchEnded`; unqueryable; `unsubscribeElement` → `ended: false` |
| **unreadable-ancestry** | not silence, and not a claim the change was inside | 2 receipts, **every one naming the watched root**, none naming the orphan |

The last row is the whole proof, and it needs its baseline to mean anything:
immediately before orphaning, a change to the same view inside the same watch
was reported **against the element that changed**. After orphaning, the same
watch still speaks — but it names the root, not the element.

## Why not one of the easier answers

**Silence** would be worse than wrong. A watcher that hears nothing concludes
nothing happened, and here something did happen; the daemon just could not say
where. Silence would convert a readability failure into a false negative that
nothing downstream could detect.

**Naming the element** would be a lie about location. The watch is a claim that
a change occurred inside a particular container, and the daemon has no evidence
of that — it could not read the ancestry at all.

So the event is a content-free nudge at the watched root: *something changed
that I could not place; look again.* It is rate-limited through the existing
backstop, so an application in a bad state cannot turn this into a flood.

## Scope

One GTK3 fixture on a private bus. It shows that this daemon reports unknown
ancestry honestly on a real toolkit; it is not a claim about every toolkit's
unparenting behaviour, and it does not measure how often unknown occurs in
ordinary use. Membership re-reading is pinned in unit tests, and the mutation
`a-watch-that-speaks-for-the-whole-application` covers the classification itself.

## Rerun

```sh
python3 run.py session.sh <consumer node_modules with @mastra-cc/desktop> <any mastra entry path>
```

The consumer must carry protocol artifacts built from the same tree; a stale
consumer is refused at the digest handshake before any of this runs. Evidence
in `evidence/`, hashes in `SHA256SUMS`.
