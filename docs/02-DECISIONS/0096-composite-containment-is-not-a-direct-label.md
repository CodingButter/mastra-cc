# 0096 — Composite containment is not a direct label

Status: **proposed, awaiting Jamie's explicit contract acceptance**. Phase 1 outcome **(b)**, not implementation authorization. Does not supersede ADR-0095.

## Context

Fresh isolated Mousepad calibration records a combo box with exactly two immediate children: one menu and one child with native role `text` and `EditableText`. Both children point back to that combo box. Each node's `GetApplication` equals the isolated application's root; all references share its bus. The combo box, not the editable child, has `LABELLED_BY` to `Search for:` or `Replace with:`. The text child's direct relations are empty. The menu is not editable; after reopening it may contain history items. Its descendants are not alternative immediate editable children.

Before editing, after filling, and after destroying/reopening the application, this shape is retained. Reopening changes the bus identity: object-path suffixes alone must never identify a live object. In the retained earlier calibration, Search parent `/334` lists menu `/347` and text `/348`, whose Parent is `/334`; Replace parent `/336` lists menu `/349` and text `/350`, whose Parent is `/336`. Full bus-qualified references, interfaces, states, ownership and relations are retained, not inferred from these suffixes.

The provisional exactly-one-child validator correctly rejects both real composites. It remains unchanged, with its failures retained. A separate calibration validator tests only the measured two-child shape and returns **observed containment**, not field identity. Tests reject a second editable child, absent parent, contradictory backlinks, nesting, stale nodes, foreign ownership, duplicate children and unsupported sibling roles. This is justification for a bounded observation proposal, not a generic ancestor-label heuristic.

Current packed public tools provide editable IDs and screenshots but no direct child labels establishing this association. Public saved/reopened readback does work. No real-agent field-selection baseline has demonstrated that screenshots alone suffice; therefore no claim that visual completion is impossible, or that base behavior is causal RED, is made. Outcome (a) has not been established.

## Decision

Propose a **separate optional** `compositeObservation` on text elements returned by existing observations. Do not implement it until the exact contract is accepted in the local amendments record. No effect, traversal API, generated actionable parent ID, name matching or discovery change is proposed.

Exact proposed wire union:

```ts
type CompositeObservation =
  | { kind: "available";
      provenance: "atspi-immediate-combo-parent";
      parentRole: "combo box";
      relation: "labelled-by";
      label: string;
      immediateChildCount: 2;
      editableChildCount: 1;
      siblingRole: "menu" }
  | { kind: "unavailable";
      reason: "not-exposed" | "ambiguous" | "out-of-scope" |
              "unreadable" | "limit-exceeded" };
```

`label` is explicitly the **parent's native label**, not the child's name or direct label. Available means the following structure was observed, not semantic equivalence or permission to act:

1. Start at the already authorized queried text element. Require native role `text`, `Text` and `EditableText`, no children, and a live unprotected state. Follow exactly one Parent edge to native `combo box`.
2. Require exactly two distinct immediate child references. Resolve both; one must be this text element, the other a non-EditableText native `menu`. Require both Parent backlinks to equal the combo box. Never descend into the menu or infer from order/proximity.
3. Require exactly one direct parent `LABELLED_BY` target, with native role `label`. Missing evidence is not-exposed; competing targets or editable children are ambiguous. Unsupported shape is not-exposed; malformed/defunct/stale/changing evidence is unreadable. Protected or unowned references are out-of-scope.
4. Before reading any label name, establish all four nodes are within the already authorized application root using the existing bounded parent-chain ownership rule, and additionally verify `GetApplication` equals that root and bus identity matches. Native GetApplication alone is not authorization. Preserve the existing 16-hop ownership ceiling, cycle rejection and ownership-before-content order.
5. Re-read target Parent, parent children, child/sibling backlinks, roles/interfaces/states, ownership and label relation before returning. Any disagreement discards the observation. This is a bounded multi-read observation, not an atomic snapshot or guarantee that later actions see unchanged structure.
6. Structural depth is exactly one parent edge, two immediate children and one label target: four distinct observed nodes, with no sibling-descendant traversal. These bounds come from the measured shape, not a generalized numeric search. Keep the existing label text ceilings (2048 UTF-16 code units and 1024 Unicode code points for this one label); over-limit labels are refused, not truncated.
7. Share, never multiply, the existing label reader's backend outstanding-call slot, 250 ms per-element deadline and 500 ms cumulative public-operation wait budget across direct and composite evidence. Deadline expiry is unreadable; cumulative budget expiry is limit-exceeded. A timed-out native call occupies the slot until settlement. No new native work after closure; late results cannot retroactively emit evidence. Missing replay exchanges must propagate `UnrecordedExchangeError`, not be converted to unavailable. Other native failures yield unreadable. All native calls use the existing capture/replay channel.

These are proposed acceptance constraints, not guarantees proven by the calibration-only validator. Phase 2 must test ownership-chain limits, text limits, deadlines, concurrency, read/change races and close/replay behavior before claiming them. If they cannot be implemented within this proposal, stop rather than weakening them.

Compatibility: existing `labelObservation` remains unchanged, including empty direct-label arrays. The new optional union requires the normal additive schema version/digest generation and exact daemon handshake; older artifacts cannot be represented as matching merely because the new field is optional. Non-AT-SPI backends may omit it. Discovery remains metadata-only. No protocol file or runtime was changed in Phase 1.

## Consequences

The proposal exposes native provenance without pretending inheritance. It deliberately supports only the measured immediate text-plus-menu shape. Other composites remain unsupported, and history/menu descendants cannot identify fields. The additional ownership and stability reads may exhaust the unchanged budget, in which case honest unavailability is required.

Visual inspection is **not complete**: the available image read returned binary text and the browser could not start without a display. PNG checksums, dimensions and successful decoder execution, plus ffprobe frame count/duration, validate media integrity but are not visual review. This remains a limitation, not proof of model-visible mapping. Phase 3 still requires genuine recording/checkpoint inspection. Native calibration performed edits and saves independently; it is not an agent session.

## Evidence

See [proof README](../proofs/mousepad-verified-find-replace/README.md), `inspect-evidence.mjs` and `evidence.test.mjs` in that directory. Retained calibration includes original/native exchange transcripts, current public tool calls/results, exact hand-authored before/expected/saved bytes, unsaved rejection, media, installed consumer lock and import/handshake records. `demo.sh inspect` recreates isolated native calibration; its final verdict is EVIDENCE, never agent completion. The literal expected bytes are authored in `inspect-session.sh`, separately from the comparison/count implementation in `evidence.mjs`.
