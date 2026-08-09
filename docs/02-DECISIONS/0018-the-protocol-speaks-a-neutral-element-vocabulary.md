# ADR-0018 — The protocol speaks a neutral element vocabulary

**Status:** accepted
**Date:** 2026-08-08
**Depends on [ADR-0017](0017-platform-backends-live-inside-the-daemon.md). Introduces boundary B10.**
**Forward decision, not back-filled.** The prototype had no reason to avoid AT-SPI vocabulary and, as far as the schema shows, made no effort to.

## Context

[ADR-0017](0017-platform-backends-live-inside-the-daemon.md) puts the platform seam inside the daemon. That seam only holds if the thing on the other side of it — the wire protocol — is genuinely platform-neutral. A seam with a Linux-shaped hole in it is not a seam.

The failure mode is quiet and it is one-way. Every individual leak is reasonable at the time: a role string copied verbatim from the accessibility layer because that is what the backend already had; a state flag named after the toolkit that produces it; an interface name in a method description. None of them break anything. Each one is a five-second decision. Collectively they decide that the protocol is a Linux protocol, and nobody is present at the moment the decision is made.

What makes it one-way is [ADR-0002](0002-schema-freeze-is-a-ci-job.md). Once `protocol/schema.json` is frozen and consumers exist, removing a leaked platform identifier is a breaking protocol change: an ADR, a version bump, regenerated bindings for every target, updated golden fixtures, and a compatibility note. The cost of preventing a leak is a lookup in a table. The cost of removing one is a release.

This is the same species as the failure family in [03-LESSONS.md](../03-LESSONS.md) §4 — *rules that were prose*. "Keep the protocol platform-neutral" written in an architecture document is a wish. The prototype has a precise precedent for what happens to that kind of wish: the schema freeze was a sentence, and the file changed 23 times without anything failing.

There is also a live example of *why* neutrality is not merely aesthetic. The prototype's own notes record that GTK4 exposes frame actions where Qt exposes widget actions — two toolkits *on the same platform* disagreeing about where an action lives. Normalisation is already required within Linux. The cross-platform requirement does not introduce the problem; it raises the price of getting it wrong.

## Decision

1. **`protocol/schema.json` contains no platform-specific identifier.** No AT-SPI role names, no GObject or GLib type names, no toolkit names, no COM or UI Automation identifiers, no macOS accessibility attribute names — in field names, in enum values, in method names, or in descriptions.
2. **The protocol defines its own element vocabulary**: role, name, states, actions, and relationships. It is a closed enumeration, versioned with the schema, and it is chosen for what a *person* means, because the agent's job is to resolve "the compose button" ([ADR-0004](0004-semantic-first-pixels-last.md)).
3. **Each backend owns a native-to-neutral mapping table**, in the backend module, as data. A native role with no neutral equivalent maps to a generic role and keeps its native identifier in a clearly-namespaced diagnostic field — visible to a human debugging, never load-bearing for agent logic.
4. **Boundary B10:** a source-level test asserts the schema contains no term from a maintained deny-list of platform vocabulary. Per [01-ARCHITECTURE.md §5](../01-ARCHITECTURE.md), the test asserts its own input is non-empty and strips comments before matching — both rules exist because the prototype violated them.
5. **The deny-list grows when a backend is added**, in the same commit as the backend. A backend that adds vocabulary without adding its terms to the deny-list has skipped the gate.
6. **The diagnostic field is exempt and is the only exemption.** It exists so that "we could not name this element" is debuggable rather than mysterious, which is the same instinct as [ADR-0008](0008-scopes-operation-classes-and-honest-refusals.md)'s rule that a refusal names the check that produced it.

## Consequences

**Good.** A port becomes a backend module and a mapping table. Nothing above the daemon recompiles, re-versions, or re-reviews.

**Good.** The mapping table is a readable, diffable statement of what the daemon believes each native role means — which is exactly the kind of assumption that was invisible in the prototype and therefore never reviewed.

**Cost.** A translation layer on the hot path of every tree walk, and a place where information is lost. Mitigated by the diagnostic field, but the loss is real: an agent cannot reason about a distinction the neutral vocabulary does not carry.

**Cost.** The neutral vocabulary is being designed against one platform, so it will over-fit to Linux in ways that are invisible until a second backend exists. This is accepted with eyes open — the alternative is designing it against zero platforms, which is worse — and it is the reason the vocabulary is versioned with the schema rather than declared final.

**Cost.** A deny-list is a blunt instrument and will produce false positives, most obviously in prose descriptions where naming a platform is the clearest thing to write. The escape hatch is deliberately awkward: rewrite the sentence. An escape hatch that is easy to use is not a gate.

## Evidence

| Claim | Source |
|---|---|
| the platform seam is inside the daemon | [ADR-0017](0017-platform-backends-live-inside-the-daemon.md) |
| protocol changes are expensive once frozen | [ADR-0002](0002-schema-freeze-is-a-ci-job.md); [CONTRIBUTING.md](../../CONTRIBUTING.md) protocol-change checklist |
| a frozen-by-prose schema changed 23 times | [03-LESSONS.md](../03-LESSONS.md) §4; prototype `protocol/schema.json` history |
| a rule with no failing test is a wish | [05-TEST-STRATEGY.md](../05-TEST-STRATEGY.md) premise |
| GTK4 exposes frame actions where Qt exposes widget actions | prototype `docs/08-prototype-notes.md` |
| source-level tests must assert a non-empty file list and strip comments | PR #226; [01-ARCHITECTURE.md §5](../01-ARCHITECTURE.md) |
| resolution is by role and name, for what a person means | [ADR-0004](0004-semantic-first-pixels-last.md) |
| a refusal names the check that produced it | [ADR-0008](0008-scopes-operation-classes-and-honest-refusals.md) |
