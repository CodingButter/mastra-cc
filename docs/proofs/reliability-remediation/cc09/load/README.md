# CC-09: a recorded native rhythm, and retention in bytes

Two of CC-09's open items were "representative load distributions" and
"retained cache sizes in bytes, not pointers". This slice answers both as far
as one desk can, and found a daemon defect on the way.

## What was recorded

`trace-driver.mjs` (run by `trace-run.py` inside the same private
Xvfb/D-Bus/Mousepad session the other native proofs use) subscribes to the
document once and drives two workloads a person would recognise, logging every
change event the daemon forwards with a monotonic receipt time:

- **typing** — a 359-character paragraph through `typeText`, key by key, then
  a readback asserting the paragraph landed exactly;
- **replacement-burst** — thirty whole-text `setElementText` calls back to
  back, then a readback asserting the last one landed exactly.

No model, no Mastra agent, no network: `fetch` throws. The trace is the
daemon's own change stream (`trace.jsonl.gz`); `trace-result.json` counts 16
receipts; `daemon.log.gz`, `session.txt.gz`, `driver.log`, `declaration.json`
and `outcome.json` are the run's provenance, all in `SHA256SUMS`.

## The defect the first trace exposed

The first run received **2** change events for 359 keystrokes and 30
replacements, with 417 lines of `backstop collapsed` in the daemon log and no
event announcing the document's final state. The ATSPI signal stream's
ambient-noise backstop ("one change per element per 100 ms") measured its
window from the last **arrival**, so any stream denser than 100 ms — typing —
held the window open indefinitely: first change delivered, everything after
it dropped, nothing trailing. That is the deaf watch the route exists to
refuse, created by its own backstop.

`daemon/src/backends/atspi/signal-stream.ts` now measures the window from
the last **emission**, keeps the newest collapsed change, and emits it when
the window ends; `close()` and a refused probe drop anything held. Two
regressions in `signal-subscription.test.ts` pin it (sustained change yields
one per window plus one trailing; a closed watch delivers nothing held) and
were RED against the previous code. Mutation
`the-backstop-forgets-the-change-it-held` deletes the trailing emission and
is caught.

The retained trace is from the **second** run, on the repaired daemon: 14
receipts during typing at gaps of 98.6–101.4 ms, a 339.9 ms gap, then 2 for
the burst (first and trailing). `backstop-collapses.txt` records 14 collapse
lines — one per scheduled trailing emission, not one per keystroke.

## What was replayed and sized

`replay.mjs` (Node `--expose-gc --experimental-transform-types`, importing
the real `SignalThrottle` source, SHA256 recorded) does two things and
writes `replay-result.jsonl`:

1. **Replay at recorded gaps** through the consumer throttle at its 250 ms
   default: 16 pushed, 8 delivered, 0 overflow, peak 1 retained pointer,
   delivery latency p50 51.8 ms / max 205.6 ms. One subscription on one
   element cannot retain more than one pointer; the number this replay adds
   is the delivery count under a real rhythm rather than a synthetic burst.
2. **Retained size in bytes.** Fill the throttle with N distinct keys inside
   one window, read the GC-differenced heap, minimum of five readings per N
   after a warm-up fill. At the 256-pointer limit: **117,040 bytes** (samples
   117,040–124,456), about 460 bytes per retained entry — the Map entry, its
   key string, the pending event object and timestamp. Rows below 128 are
   dominated by GC noise (the 32-row spans 1.5–16 KB) and are retained as
   measured, not smoothed; the least-squares slope across all rows (469
   B/entry) agrees with the limit row.

## What this does and does not establish

- Established: the daemon's change stream stays alive under sustained
  change and announces final state; a recorded native inter-arrival
  distribution from two named workloads; the consumer throttle's worst-case
  retention is on the order of 120 KB, not an unbounded structure.
- Not established: any production distribution (this is one desk, one
  editor, two workloads); daemon-side retained queue bytes (the subscription
  book's 256-change initialization buffer and watch state were not sized
  here); the ChangeEvent payload a caller retains beyond the throttle. No
  budget is chosen from these numbers.
