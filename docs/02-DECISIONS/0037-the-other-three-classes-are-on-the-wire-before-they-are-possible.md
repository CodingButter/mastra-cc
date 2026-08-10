# 0037 — The other three classes are on the wire before they are possible

Status: accepted, 2026-08-10 (M2.3)

## Context

Since ADR-0008 the product has named five operation classes — observe, edit,
activate, submit, destructive — but through schema 1.1.0 the wire defined
methods for only two of them: observe (`queryElements`, `attestElement`) and
activate's single launch method (`openApplication`, ADR-0034). A client that
asked the daemon to edit a text field got the effect-class gate's
unknown-method refusal (`daemon/src/server.ts:171-190`): "not a method of
schema v1.1.0". That refusal is honest but uninformative — it cannot
distinguish "this capability is not built yet" from "this method will never
exist", and a method absent from the schema is indistinguishable from a
method the daemon hides. The doctrine says the daemon's own refused methods
are named, never hidden: "a refusal that cannot explain itself is
indistinguishable from a bug" (`docs/00-PRODUCT.md`).

A stale citation also needed resolving: ADR-0008 line 17 refers to an
`enums.operationClass` that no v1.x schema ever carried (pre-1.0.0 prose).
Operation classes do not live in the schema at all — they live in the
daemon's dispatch table (`daemon/src/server.ts` DISPATCH), whose shape the
B11 pin parses and enforces (`tools/pins/b11.mjs`: every non-observe entry
must be marked `enforcement: "before-call"`). This ADR is the record of
where classes actually live; ADR-0008's citation is superseded by it, not
edited (house rule: accepted ADRs are never rewritten).

## Decision

**schema version 1.2.0** defines the remaining non-destructive classes as
wire methods — `editElement` (edit-class: replace a text field's content),
`activateElement` (activate-class: perform one advertised action), and
`submitElement` (submit-class: commit something beyond taking back) — and
the daemon refuses every call to all three, naming the check that ran:

1. **Defined and refused, never implemented.** Each method's handler is a
   pure refusal constant naming the scope gate, the method, its class, and
   what would change the answer (a grants surface for that class, arriving
   with a later milestone). The handlers never touch a backend — the Backend
   seam (`daemon/src/backend.ts`) still carries only
   `queryElements`/`attestElement`/`close`, so a refused method *cannot*
   reach a desktop even by bug.
2. **`submitElement` carries a required `attestation` param** even though
   every call refuses. ADR-0021: attestation is never waivable — the wire
   shape must make waiving it inexpressible, so the requirement is in the
   contract from the method's first day, not bolted on when the capability
   arrives. The refusal is the scope gate's (authority is checked before
   capability, ADR-0019), never a claim about the attestation's validity.
3. **The dispatch table is where classes live.** Three new one-line entries,
   all `enforcement: "before-call"`; B11 now witnesses four non-observe
   entries. No `operationClass` enum returns to the schema — the wire speaks
   methods, the daemon speaks classes.
4. **Destructive stays absent.** The fifth class defines no methods, and
   that absence is itself doctrine (never casually granted, ADR-0008): the
   effect-class gate's unknown-method refusal remains the honest answer for
   it.

## Consequences

- A client can now ask about edit/activate/submit and receive a refusal that
  names itself, instead of an unknown-method refusal that cannot say whether
  the capability will ever exist.
- Three methods exist that do nothing, and every client must handle their
  refusals — the cost of putting the contract ahead of the capability.
- The refusal constants are byte-stable contract: tests pin them with exact
  equality, and changing their wording is a breaking change in practice even
  though the schema does not encode refusal text.
- When a real grants surface for these classes arrives (M4's consent UI and
  the per-class authority model), the wire does not change — only the
  handlers behind it do. The 1.2.0 shapes (including `submitElement`'s
  required attestation) are the contract that implementation must meet.

## Evidence

- Freeze gate witnessed in both directions this change (ADR-0002 ritual):
  red before this ADR and the regenerated goldens existed ("freeze-gate: no
  ADR names schema version 1.2.0" / "golden fixtures were not updated"),
  green after — both outputs recorded in the introducing commit's message.
- The unknown-method refusal template being mirrored:
  `daemon/src/server.ts:171-190`.
- B11 pin parsing the one-entry-per-line dispatch table:
  `tools/pins/b11.mjs:31-38`.
- Attestation never waivable: ADR-0021; authority before capability:
  ADR-0019; five classes and refusals that explain themselves: ADR-0008.
- The Backend seam that refused methods cannot reach:
  `daemon/src/backend.ts:13-20`.
