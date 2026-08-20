# 0048 — The words Gmail's inbox publishes, carried as words

**Status:** accepted
**Date:** 2026-08-20
**Schema:** schema version 1.5.0

## Context

The M2.6 live measurement read real Gmail through the daemon on the operator's
signed-in profile (docs/proofs/real-gmail-through-the-daemon.md): at least 502
nodes, budget-capped, and behind the `generic` bucket a diagnostic tally of
`gridcell` 154, `row` 100 and `grid` 1 — the inbox is a grid of one hundred
rows of gridcells. Genuine semantic structure, visible today only in the
diagnostic, because those native roles had no neutral equivalent. A caller
asking "what is the inbox called" was answered with anonymous soup. The counts
are one run's walk under a page budget and drift between runs — the segment's
own proof leg read `gridcell` 137 on a different day against a different inbox;
the structure, not the count, is the finding. The native `checkbox` word was
observed in the same M2.6 diagnostic tally (once), which is the measurement
behind decision 2 below.

ADR-0047 sets the test: the wire carries words we did not invent. `grid`,
`row` and `gridcell` pass it — they are the desktop's own words, observed on
the real thing, not vocabulary this project coined. ADR-0045 clause 2 asks the
same question and gets the same answer.

## Decision

1. **`grid`, `row` and `gridcell` join the neutral role vocabulary** at
   schema version 1.5.0. The cdp backend maps its observed native words to
   them; the map's keys remain words actually observed, never guessed — the
   atspi map gains nothing here because no AT-SPI surface has published these
   words to a measurement yet. When one does, that mapping is a data change
   inside the backend, not a schema change.
2. **The native `checkbox` word maps to the existing `checkbox` neutral
   role** in the cdp map. No schema change — the neutral word existed; the
   backend had simply never met Chromium's spelling of it.
3. **The landmark words the same measurement observed (`navigation`,
   `banner`, `main`, `search`) and `tab` stay in the diagnostic.** They were
   observed once each (tab: five times) and no caller has yet needed them at
   the level of meaning. Leaving a word in the diagnostic is a recorded state,
   not a loss — promotion later is another ADR against another measurement.
4. **The version bump discharges the schema's prose debt from M2.7
   Segment 1.** Seven method descriptions ended "Defined on the wire before it
   is possible; until … every call is refused by name" — false since the
   segment routed every method. The freeze gate correctly made that sentence
   unfixable without a bump, so the debt was recorded at incurrence and rides
   this bump as a named deliverable. Each description now states what is true:
   served on the wire, effect-class gate enforced before the call, refusal by
   name when the capability is not granted. Had the vocabulary decision gone
   the other way, this rewrite alone would have justified the bump.

## Consequences

- `protocol/golden/` is regenerated and committed; `SCHEMA_DIGEST` changes;
  the transport must be rebuilt because it verifies the digest at connect and
  that check is not optional and not a parameter.
- The B10 deny-list is untouched: `grid`, `row` and `gridcell` are neutral
  words the desktop offers, not platform vocabulary.
- Today only the cdp backend can emit the three new words. AT-SPI publishes
  `table` and `table cell` for the same structures, and those spellings have
  not yet been observed by a measurement this project took — when one is, the
  atspi mapping is a data change inside that backend (decision 1). Until then
  the parity gap is real and named: the same inbox read over the two routes
  answers with different words.
- A conformance expectation changes shape: an element whose native role is
  `gridcell` now answers `role: "gridcell"` with no diagnostic, and an
  unmapped native role still answers `generic` with the native word kept in
  the diagnostic — the property that must not regress.
