# 0040 — A visibility verdict carries its route

Status: accepted, 2026-08-13 (M2.5)

## Context

M0.5 asked both reading routes to decide whether a person can actually see an
element, judged against layout ground truth. The browser route scored **10 of
10**; the platform route scored **6 of 10** — it cannot detect a fully
transparent element, and its hit test returns *self* for an element covered by
an opaque panel (`docs/proofs/what-hidden-actually-means.md`;
`docs/07-ROADMAP.md:131`). **Bounds alone is a liar**: a covered button has a
perfect rectangle. The roadmap has carried the conclusion since that probe —
"A visibility verdict must carry its route" — as pre-declared architecture
waiting for its implementation. This record is that implementation; it invents
nothing.

The problem with a bare `visible` state is that it erases the difference
between those two instruments. A downstream reader — the hub, an episode
narrative, a human debugging a wrong click — sees the same seven-value state
vocabulary whichever backend answered, and has no way to weight the verdict by
the instrument's known blind spots.

Two shapes were considered:

1. **A schema field** — `semanticElement` gains a `route` (or similar) field,
   schema version bumps, goldens regenerate, every consumer sees it.
2. **A namespaced diagnostic key** — the answer rides in the `diagnostic`
   subtree, the single exemption from the neutral-vocabulary rule (ADR-0018
   clause 3; pin B10 encodes the exemption by field name), and the schema does
   not change.

## Decision

The route is **provenance, not vocabulary**, so it lives in the diagnostic
subtree. Schema stays at 1.3.0; the freeze gate still answers "schema
unchanged".

1. **Every element answer names its instrument.** Both backends stamp
   `diagnostic["mastra-cc/visibility-route"]` on every element they construct:
   the accessibility reader stamps `accessibility-bus`
   (`daemon/src/backends/atspi/roles.ts`), the browser reader stamps
   `browser-protocol` (`daemon/src/backends/cdp/roles.ts`). The stamp merges
   with — never destroys — the clause-3 unmapped-role diagnostic when one is
   present.

2. **The key is namespaced and the labels are ours.** `mastra-cc/` prefixes the
   key, and the two labels name the *kind* of instrument, not a platform
   product — the same posture as the wire's neutral vocabulary, applied to a
   field that is allowed to be candid. Pin B10's clause-6 exemption (any
   subtree under a field named `diagnostic`) is exactly the sanctioned place
   for this: instrument vocabulary, visible to a human reading a log, never
   load-bearing (`tools/pins/b10.mjs`).

3. **A replayed answer keeps the label of the instrument the tape recorded.**
   The replay flavours run the same reader as their live counterpart
   (`daemon/src/backends/replay/index.ts:9`), so a `replay` answer says
   `accessibility-bus` and a `cdp-replay` answer says `browser-protocol`. That
   is the honest reading: the provenance of a recorded state is the instrument
   that recorded it, not the tape deck.

4. **The label names WHICH instrument answered — never that it is right.** The
   platform route's transparent-element and opaque-panel blind spots are the
   *reason* the label exists, and stamping the route does not fix them. What it
   fixes is the lie of omission: a bare verdict that hides its own provenance
   cannot be weighted, cross-checked against the other route, or doubted in the
   right direction.

## Consequences

- A downstream reader can weight `visible` by route — trust a
  `browser-protocol` geometry verdict, treat an `accessibility-bus` one as
  "present in the tree, geometry unverified" — without any schema change and
  without the daemon growing an opinion about which instrument is better.
- The diagnostic field is now **always present** on element answers, where it
  was previously emitted only for unmapped roles and carried only
  `nativeRole`/`nativeId`. Anything that assumed `diagnostic` implies
  "something unusual happened" loses that inference. The conformance suite
  pins the new shape on every registry backend.
- The cost of the chosen shape: a diagnostic key is invisible to schema
  tooling. Nothing in `protocol/schema.json` documents it, the generated
  validator does not check its value, and a backend that forgets the stamp
  breaks no schema validation — which is why mutation 33
  (`the-verdict-forgets-its-instrument`, `tools/mutations.json`) deletes the
  stamping line and requires tests to go red, and the conformance suite
  asserts the stamp per backend and that the two labels differ.
- If the route ever becomes load-bearing — an agent branching on it — that is
  the signal it has outgrown the diagnostic subtree and must be promoted to
  schema vocabulary with a version bump and its own ADR. Today it is
  deliberately not that.

## Evidence

- M0.5 visibility scoring, 10/10 vs 6/10 with the two platform-route blind
  spots: `docs/proofs/what-hidden-actually-means.md`, summarised at
  `docs/07-ROADMAP.md:131`.
- Stamp implementations: `daemon/src/backends/atspi/roles.ts`
  (`stampVisibilityRoute`, applied in `daemon/src/backends/atspi/index.ts`)
  and `daemon/src/backends/cdp/roles.ts` (applied to both the application
  element and node elements in `daemon/src/backends/cdp/index.ts`).
- Tests: `daemon/src/__tests__/backend-conformance.test.ts` (every registry
  backend stamps its own route; the two routes differ) and
  `daemon/src/backends/atspi/__tests__/roles.test.ts` (the stamp preserves the
  clause-3 diagnostic it merges with).
- Mutation 33 `the-verdict-forgets-its-instrument`: removing the atspi stamp
  line reddens 2 tests (`node tools/mutations.mjs` — "33 mutation(s), none
  survived").
- The exemption the shape rides on: ADR-0018 clause 3 and `tools/pins/b10.mjs`
  (diagnostic subtree exempt **by field name**).
