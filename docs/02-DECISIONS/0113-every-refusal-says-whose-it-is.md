# ADR-0113: Every refusal says whose it is

Date: 2026-09-23
Status: Accepted as direction; schema and implementation pending. See [14-DIRECTION.md](../14-DIRECTION.md) §4.

## Context

Mastra CC is meant to feed learning agents: the consumer's skills, the subconscious learner and the curator. Those agents learn from what the daemon tells them. Today most refusals are prose. A transport-level refusal becomes a plain `Error` carrying a sentence, and no caller can classify it without parsing strings ([audit](../audits/2026-09-23/PROJECT-AUDIT.md)).

The costly confusion is between the agent being wrong and the daemon being wrong. If the two blur, the learner records a daemon timeout as "this button does not work", and the knowledge rots from the source.

## Decision

1. **Every refusal and every failed outcome carries a `class`:**
   - `agent`: the request was wrong for the desktop as it was (wrong element, disabled control, point outside the picture, a grant that was never held).
   - `world`: the desktop changed underneath (element moved, stale capture, dialog opened, human takeover, application exited).
   - `daemon`: the daemon failed to do what it advertised (backend timeout, lost reply, a write it could not verify, an internal error).
2. **Every refusal also carries** a stable machine `code`, the observed state the check actually read, and, where one exists, a suggested next move. The prose stays, for humans.
3. **When unsure, say `daemon`.** Blaming the agent for our uncertainty is the dishonest direction.
4. **Daemon-class outcomes are counted.** Their rate is a first-class benchmark metric that we drive toward zero.
5. **A capability is advertised only where it holds.** An operation that would predictably end as `daemon` for an application is not offered for it.

## Consequences

- Good: learners can filter to `agent` outcomes, which are the learnable ones, and ignore ours.
- Cost: a schema change to the refusal shape, and a pass over every existing refusal site to classify it.
- Cost: classification can itself be wrong. A mis-classed refusal is a defect in the same category as a lying log.
- Direction: this reorders priorities. Daemon faults that make a log lie (audit C1) or freeze it (C3) outrank new capability.

## Evidence

- `docs/audits/2026-09-23/PROJECT-AUDIT.md` (refusals are unclassified prose; C1, C3).
