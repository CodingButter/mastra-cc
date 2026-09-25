# ADR-0116: The daemon remembers a bounded number of elements

Date: 2026-09-24
Status: Accepted. Proof in [element-memory](../proofs/element-memory/README.md).

## Context

Each backend kept the native reference of every element it had ever answered. It also kept several sibling facts per id: application, application root, native-to-id reverse lookup, latest picture, grey-press count and role. None of this was ever removed, so a long-lived daemon grew without limit.

## Decision

Each backend holds its answered elements in an `ElementMemory`, capped at 10,000 ids. Any use of an id marks it as recently used. When the cap is exceeded, the least recently used id is forgotten, and every sibling fact keyed by that id is forgotten with it. A reverse lookup is removed only if it still points at the forgotten id.

A forgotten id is treated exactly like an id that was never answered. It takes the existing `UnknownElement` refusal, and the wording now says so: "is known to this daemon (never answered, or forgotten after newer answers)". It never resolves to a different element. The protocol and schema are unchanged.

## Consequences

- Memory held per backend is bounded by the cap, not by uptime.
- An agent that keeps a very old id gets the refusal and queries again.
- An active watch does not pin its element. If the id is forgotten, the watch keeps running, but events for that node are no longer mapped back to the id.
