# 0074 — Discovery is vocabulary, not authority

- **Status:** accepted
- **Date:** 2026-09-04
- **Schema:** 1.15.0
- **Related:** ADR-0017 (platform backends live inside the daemon), ADR-0018 (neutral element vocabulary), ADR-0071 (incomplete observation is not absence), ADR-0073 (query scope narrows authority)

## Context

An agent exploring an unfamiliar interface had to guess `queryElements` role and name predicates. In Google Images, it could observe Chromium's address bar but could not discover whether a page-level search control existed under another semantic name. Repeated guesses neither established absence nor gave a bounded account of the vocabulary exposed by the authorised application.

A raw accessibility-tree dump would solve the wrong problem. It would expose topology, native identity, content, and potentially actionable element IDs while duplicating the daemon's grant, visibility, scope, traversal, replay, and refusal rules in callers.

## Decision

The protocol advances to schema version 1.15.0 and adds `discoverElements`, an observation-only method requiring an exact normalised application name and accepting optional window, role, and bounded limit controls. The daemon owns scope selection and complete selected-root traversal. Discovery shares the same authorisation, visibility, normalisation, traversal-budget, replay, and incomplete-observation truth as scoped queries, but uses its own complete depth-first traversal rather than AT-SPI Collection.

The result aggregates fully observed elements by neutral `(role, name)`. Each entry contains only role, an always-present name (empty for unnamed elements), exact occurrence count, and sorted unique exposed action and operation names. Entries are deterministic and capped after complete aggregation. `truncated` means additional distinct entries were omitted by that output cap; an incomplete traversal remains `IncompleteObservationError` and returns no inventory.

Discovery never returns or mints element IDs, values, text content, descriptions, bounds, paths, URLs, native references, selectors, or diagnostics. Its entries are query vocabulary only. Acting requires a subsequent fresh `queryElements` call and an ID returned by that call.

## Consequences

- Agents can inspect bounded semantic vocabulary before choosing an exact query predicate.
- Duplicate and unnamed controls remain visible as aggregate evidence without exposing identity or topology.
- Application and window names still narrow daemon-owned authority; they do not grant it or reveal why a scope was empty.
- Names may be user-authored or sensitive. Exposure is reduced by authorised scope, normalisation, output caps, and omission from audit, but names are not claimed to be harmless.
- Version one has no pagination or cursor state. A capped result may require a narrower role filter, while `truncated: false` is meaningful only after complete traversal.
- Backends must separate metadata observation from actionable registration so discovery does not create authority as a side effect.

## Evidence

- `protocol/schema.json` defines the request, aggregate entry, result, and schema version.
- `protocol/generate.mjs` emits the generated client types, method descriptor, recursive entry validation, and golden package output.
- Daemon tests pin request bounds, exact result fields, no-ID registration, complete DFS, deterministic aggregation, audit omission, and AT-SPI/CDP/replay parity.
- Desktop and desk-demo tests pin the discover → fresh query → act → reread loop and the rule that discovery output is never actionable authority.
- The bounded semantic discovery proof records branch/base behavior and repeated process-reset trials against a deterministic Google-Images-shaped fixture.
