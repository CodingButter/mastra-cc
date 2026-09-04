# 0073 — A query can name the one application it means

- **Status:** accepted
- **Date:** 2026-09-04
- **Schema:** schema version 1.14.0 (`queryElements` gains an optional `application` parameter)
- **Related:** ADR-0036 (an ungranted application is absent, not blocked), ADR-0047 (the wire carries words we did not invent), ADR-0068 (the name a person types and the name the desk prints), ADR-0069 (a name is the same name in any case)

**Protocol schema change.** `queryElements` gains one optional string
parameter, `application`. The generated schema, golden fixtures, and the
`packages/protocol-types` build output all regenerate; the change is additive.

## Context

`queryElements` walks every visible application and returns a flat list of
matches from all of them. An agent that wants "the OK button in the dialog it
just launched" cannot say so on the wire: it gets OK buttons from the shell,
the dialog, and any other visible application mixed together, distinguishable
only after the fact with a per-element `applicationOfElement(id)` lookup. The
shell's own controls and an application's content share one answer with no way
for the caller to state which scope it meant.

The ownership the caller needs is already measured. Both backends read the
application's name up front for the ADR-0036 visibility gate, and both stamp
ownership at answer time — the AT-SPI backend into an `applicationOf` map, the
CDP backend through `recordApplication` during element materialisation. What
was missing was a way for the caller to *name* the scope it wants before the
walk, rather than filtering an all-applications answer afterwards.

## Decision

**1. `queryElements` accepts an optional `application` name.** When present, the
answer is restricted to the one application whose normalised name matches;
absent means every visible application, exactly as today. The parameter is an
open string, not a closed vocabulary: application names are read off the desk,
not decided by the daemon, the same reasoning ADR-0047 applies to action names.

**2. The scope is matched with the grant normaliser.** The comparison uses
`applicationName()` (NFKC then case-fold, `daemon/src/backends/atspi/names.ts`)
— the same normalisation grants and attribution already use — so a scope names
an application the same way a grant does. Element `name` matching keeps its
existing case-sensitive `nameMatches` behaviour (the Chromium bus-name lesson,
ADR-0069): only the *application* scope is case-folded.

**3. Scope is not a grant, and does not weaken visibility.** The scope filter
runs *after* the existing `isVisible` gate. Naming an ungranted application as
scope yields an empty answer — the application is absent, never surfaced as
"blocked" (ADR-0036). Naming a granted application reads nothing the caller
could not already have queried unscoped. The shell is an application by name
like any other: scoping to it returns shell controls and only shell controls.

**4. Fresh ids and attestation are unchanged.** Scoped answers flow through the
same `readElement` / `nodeElement` path, so element ids and `attestElement`
behave exactly as an unscoped query's do.

## Alternative rejected

**A new `queryApplicationElements` method.** A second method would duplicate the
whole walk, double the golden surface, and split the grant-enforcement path in
two. One optional parameter reuses the fast path, both backends' budgets, and
the single `observedWithConfiguration` grant seam.

**Scoping by element id ("query under this id").** The problem is picking an
application from the *inventory* by name and getting fresh ids back. An
id-scoped query presumes the caller already holds a live id, which is the
stale-id situation this change exists to avoid.

## Consequences and costs

- **The all-applications default is unchanged.** Every existing caller that
  omits `application` gets exactly the answer it got before; the field is
  additive and optional.
- **A non-matching scope on a single-application backend returns empty.** A CDP
  target is one application, so a scope naming anything but that browser yields
  no elements — the same "absent" answer the visibility gate produces.
- **Server passthrough, no new guard.** Unlike `role` (a closed vocabulary
  refused by name before the backend is touched), `application` is an open
  string validated at the wire like `name`, and passes straight to the backend;
  grants are still enforced at the result by `observedWithConfiguration`.
