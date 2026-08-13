# Real Gmail through the daemon

Produced 2026-08-13 on **minibeast** (Ubuntu 24.04, Wayland), by an
observe-only run against **real Gmail** — the operator's own inbox, reached
through the daemon's wire and nothing else. The M0.5 proof
[what a plan can say without a model](what-a-plan-can-say-without-a-model.md)
ran against a fixture with Gmail's shape and said so plainly: *a fixture cannot
surprise its author*. This document is the surface we did not author.

**Zero Gmail content appears here, by design and by gate.** No subject lines,
no addresses, no sender names — the wire client that produced this transcript
never prints an element's name. Counts, roles, and structural facts only.

## How the surface was reached

- The operator signed into Gmail **once, by hand**, into a dedicated
  persistent profile directory. The daemon never saw the sign-in and holds no
  credentials; it only launches the browser against that directory.
- The daemon ran with the cdp backend and a single launch permit: the `gmail`
  catalog entry (`daemon/src/launch/recipes.ts`), which is the built-in chrome
  recipe pointed at the signed-in profile and the mail URL.
- Before the launch, the leg verified the debugging endpoint was silent — one
  browser identity at a time is the daemon's own constant, and the proof
  honours it rather than assuming it.
- Every read below is an ordinary wire call: `openApplication`,
  `queryElements`, `attestElement`, `subscribeElement`. Nothing else touched
  the browser.

## The predicate table

The M0.5 plan grammar's step targets are `{role, name, within}` predicates.
The 1.3.0 wire's `queryElements` takes `role` and `name`; `within` narrows
here to *within this session's one visible application* — the walk is already
scoped to it, and nesting below that is not expressible on this wire. Each
predicate was answered as an observe query against the live inbox:

| predicate | answer |
|---|---|
| `{role: window}` | **yes** (2) |
| `{role: button, name: "Compose"}` | **yes** (1) |
| `{role: link}` | **yes** (8) |
| `{role: list}` | **no** (0) |
| `{role: textbox}` | no (0) |

The `list` **no** is the honest answer of this wire's vocabulary, not a
statement that Gmail has no list: the neutral role map translates a dozen
Chromium roles and renders the rest as `generic` with the native word kept in
the diagnostic (ADR-0018 clause 3). What the generic bucket is actually made
of is measured below — and it is where the inbox turned out to live. The
`textbox` no is a point-in-time read of the loaded surface; Gmail's search box
did not present as a native textbox in this walk.

## The attestation

`attestElement` on the Compose button's id re-resolved it live: same id back,
role `button`, no refusal.

## The subscription witness

`subscribeElement` anchored on the mail document's window element (the inbox
is beneath it; with no `list` role on this wire, the window is the honest
subtree root). The wire stayed open for a 30-second watch window in which the
daemon caused nothing. What arrived:

- **302 change events**: 61 appeared, 61 disappeared, 180 changed.
- Every event carried **exactly the seven contract fields** and no content
  field — pointer, never payload, re-witnessed on a surface we did not author.
- Every event was attributed **`external` or `unattributed`**, and no event
  carried a `causeId` — the attribution contract's exact shape for changes the
  daemon did not cause. Real Gmail is simply this busy on its own.

The watch was then ended by the client and the daemon confirmed it.

## The node count, re-measured at last

The M0.5 probe's "a few thousand nodes across roughly thirty roles" was
deliberately never cited — its spike was deleted and no artifact carried it.
This is the re-measurement, with its context and its cap:

- **At least 502 nodes — budget-capped.** The cdp walk enforces budgets of
  500 nodes per page and 2500 in total; the mail document sat at its per-page
  budget, so this count is a floor, not a total. The budgeted walk cannot
  confirm or deny the old few-thousand figure; it measures what the daemon
  actually reads.
- Role histogram (neutral vocabulary): `generic` 419, `text` 51, `button` 21,
  `link` 8, `window` 2, `application` 1.
- Native roles behind the generic bucket (diagnostic tally, structural words
  only): `gridcell` 154, `row` 100, `tab` 5, `image` 6, `LineBreak` 3, and one
  each of `grid`, `navigation`, `banner`, `main`, `search`, `checkbox`,
  `tablist`, `alert`, `separator`, `complementary`, `contentinfo`,
  `LayoutTable`, `LayoutTableRow`.

That last tally is Q03's original question answered on the real thing: the
inbox is a **grid of one hundred rows of gridcells** — genuine semantic
structure, not anonymous soup. It also names real work: those structural roles
are not yet in the neutral map, so today they cross the wire as `generic` and
their structure is visible only in the diagnostic.

## The limit of this result

One machine, one session type, one signed-in account, one watch window. The
subscription witness reports what real Gmail did in those 30 seconds — nothing
was staged, so another window will see different counts. The node count is a
budget-capped floor. The predicate answers are answers of this wire's
vocabulary against this walk, dated above. No claim is made beyond them.
