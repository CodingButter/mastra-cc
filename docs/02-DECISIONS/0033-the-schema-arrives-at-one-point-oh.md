# 0033 — The schema arrives at 1.0.0, and its introduction goes through its own gate

Status: accepted, 2026-08-09 (M1, Phase 2)

## Context

ADR-0002 made the schema freeze a CI job: any change to `protocol/schema.json`
relative to the merge base requires an accepted ADR naming the schema version,
a version bump in the file, and regenerated golden fixtures. The prototype's
freeze was prose, and its schema changed 23 times after freezing with nothing
going red.

M1 Phase 2 creates the schema. Creation is a change like any other: the diff
against the merge base is the entire file. If the introduction were
special-cased around the gate, the gate's first act would be an exemption, and
a gate whose first act is an exemption has taught everyone how to ask for the
second one.

## Decision

**Schema version 1.0.0** exists, and this ADR is the record the freeze gate
demands for it.

What 1.0.0 contains, and why it is this small:

- **Exactly two methods** — `queryElements` and `attestElement`. One cannot
  exercise shared types; twenty is a week of work before anything is proven
  (`docs/07-ROADMAP.md:90`).
- **`semanticElement.id` matches `^(el|win|app)-[0-9a-f]{12}$`** and is never
  reused. Identity is hashed to twelve hex digits behind a kind prefix; what it
  is hashed *from* is the backend's business (ADR-0029 for ownership,
  M0.5's identity findings for the input).
- **No `backend` field, and no platform vocabulary anywhere** — not in field
  names, enum values, method names, or descriptions (ADR-0018 clause 1, which
  names enum values explicitly). The caller cannot tell which backend answered
  (`docs/07-ROADMAP.md:102`). Any future need for backend identity on the wire
  is a superseding ADR and a freeze-gate event, never a quiet enum.
- **The `diagnostic` field exists from 1.0.0** (ADR-0018 clauses 3 and 6): the
  one exemption to the neutral-vocabulary rule, carrying native role and
  identifier verbatim for a human reading a log. It is present from the first
  version so that adding it later never looks like an exemption being invented
  under pressure.
- **A closed role vocabulary of fifteen**, ending in `generic`: a native role
  with no neutral equivalent maps to `generic` and keeps its native name in
  `diagnostic` (ADR-0018 clause 3), so an unmapped role is visible in logs
  without ever leaking onto the wire.

## Consequences

- The freeze gate (`tools/freeze-gate.mjs`) goes green on this branch because
  this ADR names schema version 1.0.0 and the golden fixtures in
  `protocol/golden/` are cut from the schema as committed. Editing one
  character of the schema without touching this ritual goes red — proven by
  doing it, in this phase's commit record.
- Every future schema change pays the full toll: version bump, ADR, regenerated
  fixtures. That is deliberate friction. The cost is real: small, honest
  corrections (a typo in a description) carry the same ceremony as a new
  method. We accept that cost because the prototype demonstrated the
  alternative: 22 post-freeze changes, none blocked.
- Two methods means M1's daemon can refuse everything else by construction.
  The cost is that M2 must open the schema again (a version bump and an ADR)
  before any effect-class operation exists.

## Evidence

- Freeze-gate mechanics and the 23-revision churn table: ADR-0002,
  `docs/02-DECISIONS/0009-generated-code-is-build-output.md`.
- The two-method floor: `docs/07-ROADMAP.md:90`.
- Neutral vocabulary and the enum-value clause: ADR-0018, clauses 1, 3 and 6.
- The gate going red on a one-character edit and green on the revert: recorded
  in this phase's commit message with both CI run identifiers, and in
  `.mastracode/plans/` proof transcripts referenced by the M1 progress record.
