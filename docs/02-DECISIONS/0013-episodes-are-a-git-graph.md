# ADR-0013 — Episodes are a git graph

**Status:** accepted
**Date:** 2026-08-08
**Carried forward from the prototype (issue #27).**

## Context

A session in which an agent touched somebody's desktop needs a history that is more than a log file. The requirements, in order of how much they matter:

1. **Inspectable by the person, with tools they already have.** Not a proprietary viewer.
2. **Diffable.** "What changed between the state before this action and after it" must be a first-class question.
3. **Attributable.** Every entry says who caused it.
4. **Revertible in principle**, or at least able to describe what a revert would mean.
5. **Append-only in practice**, so the record cannot be quietly rewritten.

The prototype's answer was to make an episode a **git commit graph**. Not "a log stored in a git repository" — the structure of the episode *is* the structure of the graph: states are trees, actions are commits, and the causal chain is the parent chain.

This is a cheap idea with disproportionate payoff. `git log`, `git diff`, `git show`, and `git bisect` all become episode tools without being written. A person who wants to audit what happened on their machine last Tuesday uses the same command they use at work.

It also composes with the rest of the model. Because effects are attributed at the daemon ([ADR-0004](0004-semantic-first-pixels-last.md)), a commit can honestly record whether the human or the agent produced a change. Because submit-class actions carry an attestation ([ADR-0008](0008-scopes-operation-classes-and-honest-refusals.md)), the commit that represents a submit can carry the description the service produced — the thing a reviewer would want to read.

## Decision

**An episode is a git repository. Actions are commits; state snapshots are trees; causality is the parent chain; the actor is the author.**

Consequences of that mapping, made explicit so they are not rediscovered:

- **Author field carries the actor.** Human-caused changes and agent-caused changes are distinguishable by the same field git already has for the purpose.
- **Commit message carries the description.** For submit-class actions, that is the attestation text — the service's own description of what it was about to do.
- **Nothing is force-pushed.** The record is append-only by policy, and the policy is checkable.
- **Episodes are local by default.** They live beside the hub's state, on the person's own machine. Exporting one is a deliberate act.
- **Retention is a setting, and deletion means deleting the repository**, not editing history inside it.

## Consequences

**Good.** Zero-cost tooling, a genuinely inspectable audit story, and a format nobody has to trust us about.

**Cost.** Git is not a database. Querying "every time the agent touched the mail client this month" across many episodes is a scan, not an index. If that becomes a real need, the answer is an index built *from* the episodes, never a replacement for them.

**Cost.** Storage grows with snapshot granularity. Snapshot policy is a tuning knob, and the honest default is to snapshot at action boundaries rather than continuously.

**Open question, carried from [01-ARCHITECTURE.md §9](../01-ARCHITECTURE.md):** whether the audit log is a separate artifact or is derived from the episode graph. The prototype had both — a JSONL audit trail with redaction, and episodes — and never settled whether that was redundancy or separation of concerns. It needs a decision before either is built, because the answer determines whether redaction happens at write time or at read time.

## Evidence

| Claim | Source |
|---|---|
| episodes as git | issue #27 |
| effects are attributed at the daemon | prototype delta/attribution model; `external` vs cause id |
| attestation text describes a submit before it happens | protocol `attestElement` / `commitElement`; `ATTESTATION_FAILED` |
| audit JSONL with redaction existed alongside episodes | prototype daemon audit implementation |
| `getDeltaSince` is the change-query primitive | `protocol/schema.json` |
