# 0071 — A deep application does not silence the desk

- **Status:** accepted
- **Date:** 2026-09-02
- **Schema:** 1.13.0 (unchanged)
- **Related:** ADR-0047 (the wire carries words we did not invent), ADR-0026 (the audit log is an access record), ADR-0069 (the measurement that let the daemon see Chromium), ADR-0070 (the keyboard route that navigated it)

**No protocol schema change.** The generated schema regenerates to an empty diff.

## Context

Commit `4149e06` (`feat(daemon): reach deep elements and watch them change`)
gave the AT-SPI walk an invariant this record keeps: a partial tree must never
be reported as complete, because a truncated walk reads as a false absence.
Running out of budget therefore *refuses* with `IncompleteObservationError`
rather than truncating. That commit shipped without a decision record; this is
the invariant's first written one.

The budgets it chose — `MAX_DEPTH = 24`, `MAX_NODES_PER_APP = 4000`,
`MAX_NODES_TOTAL = 20000` — were sized from one measured KDE editor (1030
nodes, 17 deep). Measured 2026-09-02 on the demo desk (dogfood
`.mastracode/plans/dogfood-2026-09-02.md` D1–D4): after ADR-0070's `typeText`
+ `Enter` put Chromium on `https://en.wikipedia.org/wiki/Wren`, every
subsequent `queryElements` — Chromium's, KCalc's, Kate's — refused with
`the desktop could not be read by this session's backend` in ~170 ms. The
container's stderr, once the deployed bundle was patched by hand to print the
swallowed error, showed `IncompleteObservationError`: the depth budget was
reached inside Chromium, and the whole request aborted with it. One deep
application silenced every other application on the desk.

Measured with an independent walker on the live bus (not through the daemon;
`.mastracode/plans/a-deep-application-does-not-silence-the-desk.proof/measure.mjs`,
run twice):

```
MAX-DEPTH: 48
NODES: 3902
WALL-MS: 658   (second run: 505)
```

The article is 48 deep and 3902 nodes: past the old depth cap, just under the
old per-application cap. The failure was the depth cap, and the per-application
cap was one article away.

Two more things came out of the same session. A probe with `role: "heading"`
(not a value of the generated `ROLES` enum) crashed inside
`roleIsCollectable` — `NATIVE_ROLE_IDS[role].length` on `undefined` — and was
masked by the same generic refusal. And the mask itself: the daemon's top-level
catch (`98ac7fd`, *a spawn failure is refused with a constant, never a raw
system error*) returned the constant and logged nothing, so diagnosing the
failure required patching the deployed bundle.

## Decision

**1. The caps become a safety net, not a working limit.**
`MAX_DEPTH = 10_000`, `MAX_NODES_PER_APP = 1_000_000`,
`MAX_NODES_TOTAL = 5_000_000` (`daemon/src/backends/atspi/index.ts`). They are
sized so that no real desk meets them; the measured range of real desks — the
KDE editor at the low end (1030 nodes, 17 deep) and the Wikipedia article at
the high end (3902 nodes, 48 deep, 658 ms) — sits two to three orders of
magnitude below them. The throw sites are unchanged: exhaustion still raises
`IncompleteObservationError`, and a partial tree is still never reported as
complete. The `focusedElement` walk shares the constants and gets the same
lift; `subscribeElement` never consulted them.

The caps are not configurable from the CLI, a config file, the environment, or
the protocol. The only injection point is an optional `limits` constructor
option on `AtspiBackend`, used by tests so the *unchanged* production
comparisons can be exercised at small values (depth 5, 50 nodes, 80 nodes) —
a fake channel costs ~5 exchanges per node, so the invariant cannot be tested
at a million. One additional test drives the real depth cap (a 10 001-deep
chain generated lazily) to show the number itself binds.

**2. An unknown role is refused by name before the backend is touched.**
`queryElements` in `daemon/src/server.ts` checks `role` against the generated
`ROLES` tuple and refuses with `UNKNOWN_ROLE_REFUSAL` (`that role is not one
this desk can be asked about`), classified `MalformedParameter`, mirroring the
chord guard. An absent `role` still passes; every generated role passes,
including the ones with no Collection fast path (`generic`, `application`,
`grid`, `row`, `gridcell`). `collection.ts` is unchanged: `roleIsCollectable`
still dereferences by role and would still crash for a caller that bypasses
the server guard. There is no such caller today; this is recorded, not fixed.

**3. The daemon says why — on its own stderr, never on the wire.**
The top-level catch now writes one line,
`daemon: <method> failed in the backend: <ErrorName>: <message>`, to stderr
before returning `BACKEND_UNREADABLE_REFUSAL`. The wire rule of `98ac7fd`
stands unchanged: the client sees the constant and nothing else — no error
text, no argv, no paths. The log line never includes `request.params`.

This stderr line is the operator's log, and it is deliberately *not* the audit
record. The audit record (ADR-0026) keeps its no-prose discipline: it records
that an observe attempt failed, by class, with no free text. The stderr line
carries whatever the backend threw, because the operator reading the daemon's
own output is the one person who needs the cause verbatim — the audit sink is
an access record, not a debugger.

## Alternative rejected

**Per-application partial results.** The principled design: when one
application exhausts its budget, return the other applications' elements and
mark the deep one `unobserved`, so a deep page degrades only itself. That is a
schema change (`1.14.0`) and a change to the agent instructions (an
`unobserved` marker the agent has to understand). Jamie rejected it on
2026-09-02 — raise the caps "super high" and "only optimize if we really see
performance that is causing actual problems"; then "you can raise it way over
1000". Deferred, not discarded: if a real desk ever trips the new net, that
design is the recorded answer, not further constant tuning.

## Consequences and costs

- **Walk time is now unbounded by the caps in practice.** The Wikipedia
  article walks in ~0.6 s; the live proof's post-navigation window query
  returned in well under the demo agent's tool timeout. A page ten times
  deeper has no cap to stop it early. Accepted: the caps were never a
  performance control, and the user chose to measure before optimising.
- **Memory before the net fires.** The walk keeps no visited set. A cyclic
  or pathological tree accumulates up to `MAX_NODES_PER_APP` (one million)
  elements — each a read of role, name, state, interfaces and children — before
  `IncompleteObservationError` is raised. That is the cost of a safety net
  sized past every real desk, and it is stated here rather than hidden in a
  smaller number that a real page would meet.
- **`roleIsCollectable` remains crash-prone for a future direct caller.**
  The guard lives in the server, where the wire enters; the backend still
  trusts its role.
- **A backend throw is now diagnosable from the daemon's log** without
  patching the bundle. The wire is exactly as silent as before.

## Receipts

- Failure: `.mastracode/plans/dogfood-2026-09-02.md` D1–D4.
- Measurement: `measure.txt` (two completed runs, above).
- Live proof, same argv both legs, distinct bundle checksums: base
  `08a81de67e109aebf39a82dcdb3a88b3` — `NAV: ok`, `WINDOWS: refused`,
  `KCALC-BUTTONS: refused`, `HEADING: refused` (all three the generic
  constant); branch `8f78e9ec3064b7681d09bb8377f40476` — `NAV: ok`,
  `WINDOWS: 12 window(s): … Wren - Wikipedia - Chromium …`,
  `KCALC-BUTTONS-BEFORE: 70` / `KCALC-BUTTONS: 70`,
  `HEADING: refused: that role is not one this desk can be asked about`.
- Demo, exact dogfood prompt through the real agent: `listApplications` →
  `openApplication` → `queryElements` → `typeText` → `sendKeyChord` →
  `queryElements({role:"generic"})` → *The first heading on the page is
  "Wren".* (`demo.txt`, `demo-wren.png`).
