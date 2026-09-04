# ADR-0056 — Permitted content is observable; protected content is redacted

**Status:** accepted
**Date:** 2026-08-27
**Introduces protocol schema version 1.6.1 and amends [ADR-0042](0042-existence-is-readable-content-is-not.md) clause 3.**

## Context

The product contract says the daemon reads a text field's value and can prove that a mutation arrived. The implementation already reads platform state internally after a mutation and refuses with `WriteNotObservedError` when read-back disagrees. But protocol schema 1.5.0 did not expose current content on `SemanticElement`, so a caller could not independently re-query the desktop and observe the resulting state.

ADR-0042 said content remains behind the application grant. That boundary is correct, but the sentence "content is not readable" was interpreted as omission even after the operator granted observation. The result was contradictory: a permitted caller could write ordinary content and the daemon could verify it internally, while the caller could not observe the same ordinary state.

Content also has a second boundary. Passwords and other controls marked protected by the platform must not become readable merely because their application is permitted.

## Decision

Protocol schema 1.6.1 adds one required provider-neutral `content` observation to `SemanticElement`. It is a discriminated structure with five states:

- `text` carries the complete currently observed ordinary string when it fits the inline bound;
- `text-window` carries an explicitly bounded string together with its zero-based Unicode-scalar offset and length and total length; it carries one-based start, end, and total line numbers when the provider can determine all three without widening the requested content read;
- `number` carries the currently observed numeric value and optional published range metadata;
- `redacted` carries only the closed reason `protected` and cannot carry a value;
- `unavailable` carries `not-exposed` or `unknown` when no readable observation is published or the route cannot determine one.

There are two enforcement boundaries:

1. **Application grants gate the walk.** No element, name, state, or content inside an unpermitted application is observed. Existing capability and scope enforcement does not move.
2. **Protected controls remain redacted inside a permitted application.** Protection is determined from platform-published accessibility metadata before any content read. A protected observation carries no value.

A successful mutation is still verified internally by reading the platform back; `WriteNotObservedError` remains load-bearing. Caller-visible certainty comes from a fresh `queryElements` or `attestElement` observation after the mutation. Large ordinary text can be traversed with `readElementContent`, which accepts an element id, offset, and limit and returns the same observable-content structure. The protocol does not claim that observation and mutation are atomic.

Change events remain content-free pointers. They tell the client to re-observe; they do not carry names, text, numeric values, or redaction payloads. Audit records likewise remain content-free and record identity, authority, cause, and outcome rather than observed application content.

The content vocabulary is provider-neutral. Platform interface names, browser tree property names, DOM vocabulary, toolkit names, and deployment-provider concepts remain outside the public contract.

## Consequences

**Good.** A permitted caller can inspect ordinary text and numeric controls, mutate them, and independently verify the resulting state by re-querying. Protected values cannot cross the wire. AT-SPI, browser accessibility, replay, validation, and transport now have one contract to implement.

**Cost.** Ordinary application content may now cross the daemon boundary when the operator has granted observation. Clients must treat it as application data and must not copy it into logs, audit records, event payloads, diagnostics, or refusal strings.

**Boundary retained.** This does not make unpermitted application content readable, weaken any effect-class gate, grant launch authority, or introduce a remote transport. It amends only the interpretation of ADR-0042 clause 3 after the application grant has admitted the walk.

## Rejected alternatives

**Expose ad hoc `text` and `value` fields.** Rejected because absence would ambiguously mean non-text, unreadable, protected, unsupported, or forgotten by a backend.

**Return an empty value for protected controls.** Rejected because an empty protected value is indistinguishable from a genuinely empty ordinary control and invites accidental leakage during later refactors.

**Put fresh content in change events.** Rejected because events are deliberately bounded pointers. Re-observation keeps scope checks and protected-control handling at the owning read seam.

**Rely only on internal mutation read-back.** Rejected because daemon certainty is not caller observability. A semantic client must be able to inspect current state before and after its action.
