# CC-08: reparenting and root removal on a live GTK bus

The seam-level CC-08 proof (`../README.md`) drove membership rules over a
scripted bus and said so. This slice is the "real native reparenting /
root-removal proof" that FOLLOWUPS listed as not built: a GTK3 application
whose one text view is moved between containers and windows on command, and
whose window is then destroyed, watched by the real daemon over the real
accessibility bus. No model, no network (`fetch` throws).

## Fixture and route

`fixture.py` (PyGObject, GTK 3.24): window "Reparent Home" with frames
**Left** and **Right**, window "Reparent Annex" with frame **Annex**, and a
`GtkTextView` named `doc` that starts in Left. Commands arrive on a named
pipe: `right`, `left`, `annex`, `destroy-annex`, `quit`. `session.sh` is the
private Xvfb / D-Bus / at-spi / Openbox session the other native proofs use,
launching the fixture instead of Mousepad and granting `reparent-fixture`.
`driver.mjs` runs through the public `@mastra-cc/desktop` tools only.

## What was measured

A watch on **Left** while `doc` travels, one `setElementText` per phase, then
a second watch directly on `doc` for the root-removal half. `green/result.json`:

| phase | expectation | Left-watch `changed` |
|---|---|---|
| in-left | inside: emits | 2 |
| moved-right (same window, other frame) | outside: silent | 0 |
| back-in-left | inside: emits again | 2 |
| moved-to-annex (other window) | outside: silent | 0 |
| destroy-annex (window destroyed with `doc` inside) | `doc` watch ends | `["changed", "watchEnded"]`; element no longer queryable; `unsubscribeElement` answers `ended: false` (already ended on its own) |

The `changed` before `watchEnded` is the trailing backstop emission of the
`moved-to-annex` write, not a destroy artifact (receipt times in
`green/trace.jsonl`). The two changes per inside phase are the text view's
delete + insert for one `setElementText`.

## What the first run found (`before/`)

Before this slice the same destroy produced `["changed", "changed"]` and an
`unsubscribeElement` that answered `ended: true` - the daemon still called
the watch alive on an element that no longer existed. Two things were
learned on the wire with a temporary signal dump (removed again; the
finding is pinned by the seam tests):

1. GTK announces `StateChanged("defunct", 1)` for the **window and frame**
   being destroyed, never for the text view inside them. The view is
   unparented and finalized silently.
2. By the time the window's defunct arrives, the view's `Parent` property
   already answers null - so "is the defunct object above my root" cannot be
   climbed; by then nothing is above the root.

The first fixture also held a Python reference to the view across
`destroy`, which left a live parentless widget - a fixture artifact, fixed
before the retained runs (`fixture.py`, `destroy-annex`).

## The repair

`signal-stream.ts`: on a same-application `defunct`, the stream asks the bus
whether the root still hangs anywhere (`AtspiWatchAnchor.attachmentOf`, a
direct `Parent` read that **rejects** when the peer does not answer, unlike
`parentOf` which folds failure into "no parent"). A root that answers with
no parent has left the tree: the watch emits `watchEnded` for the element it
was watching, closes, and is never re-anchored (ADR-0039). A root that does
not answer is unknown, and unknown ends nothing. A defunct descendant is an
ordinary change. Seam regressions: root's own defunct ends once and nothing
follows; window defunct + detached root ends; another object's defunct with
the root still attached does not; descendant defunct / root defunct-clear
are plain changes. Mutation `a-root-that-left-the-tree-is-still-called-watched`
forces "attached" and is caught.

## Boundaries

One toolkit (GTK 3.24 / atk-bridge 2.52), one fixture, one desk. Nothing here
says how Qt or Electron announce removal, or claims complete subtree coverage;
membership is still decided per signal by a bounded climb, and a root whose
peer stops answering stays "unknown", not "ended" - that case is the
disconnect path (`namesADeadPeer`), not this one.

## Rerun

```sh
python3 docs/proofs/reliability-remediation/cc08/reparent/run.py \
  docs/proofs/reliability-remediation/cc08/reparent/session.sh \
  <consumer node_modules with @mastra-cc/desktop installed> <any mastra entry path>
```
