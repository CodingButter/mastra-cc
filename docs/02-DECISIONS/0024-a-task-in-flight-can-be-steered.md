# ADR-0024 — A task in flight can be steered

**Status:** accepted
**Date:** 2026-08-08
**Follows from [ADR-0023](0023-the-phone-is-a-consent-surface.md).**
**Forward decision. The prototype had no concept of this and the gap is in its state machine.**

## Context

Everyone builds the yes/no prompt. Almost nobody builds the channel for a person to say *no — do it this way instead*, while the work is still running.

The distinction matters more here than in most systems, because of what [ADR-0022](0022-failure-to-act-is-harm-we-caused.md) and [ADR-0021](0021-standing-authority-is-armable-attestation-is-not-waivable.md) together produce: long tasks, running unattended, with the person somewhere else. In that world, a binary channel is impoverished. The person watching a task drift has exactly two options — let it finish wrong, or stop it and start over. Both are bad, and the second one silently punishes them for paying attention.

The hub already owns a session and turn state machine ([01-ARCHITECTURE.md §2](../01-ARCHITECTURE.md)) and a lane vocabulary of `progress`, `answer`, `voice_opened`, `voice_closed` ([01-ARCHITECTURE.md §4](../01-ARCHITECTURE.md)). Every one of those flows *outward*, hub to clients. There is no inward path for a correction that is not a new turn, and no notion of an instruction arriving from a device other than the one that started the work. That is the gap: not a missing feature so much as a missing direction of travel.

Two design facts from the existing documents constrain the answer, and both are useful.

**A decline is already a complete turn.** [01-ARCHITECTURE.md §6](../01-ARCHITECTURE.md) step 9 records that ending a session on a person saying *stop* closes the microphone gate immediately rather than letting a silence timer run out (PR #231). The state machine already accepts that a person's utterance can end a turn out of band. Steering is the same shape with a different outcome — it redirects rather than terminates.

**Lane edges must be replayed.** PR #230's lesson was that a client joining mid-stream must be told the current state or it sits in the wrong mode forever. A steering channel makes this sharper: a person opening their phone during a running task must see what the task is doing *now*, not what it was doing when the notification fired. Steering a stale picture is worse than not steering.

## Decision

1. **A correction is a first-class input, distinct from a new turn and from a decline.** It arrives mid-task, is attributed to the person, and does not end the session.
2. **A correction may arrive from any consent surface**, not only the device that started the task — the phone, the dashboard, or the widget. The hub derives who sent it ([ADR-0007](0007-identity-is-derived-credentials-are-minted.md)).
3. **Corrections are applied at a checkpoint, not mid-action.** The agent reaches a safe point and takes the correction; it never abandons an action after attesting it and before committing it. An in-flight `submit` completes or fails on its own terms — a correction is not an undo, and pretending otherwise would create a partial-commit hazard where none needs to exist.
4. **The state machine gains an explicit steering path**, with the correction, the checkpoint it applied at, and the resulting change of direction recorded in the audit log and the episode graph. A correction that vanishes into a prompt leaves no way to ask later why the task changed course.
5. **Any surface offering steering must show current state, replayed on connect** — what the task is doing now, what it has completed, and when it last progressed. Per PR #230, a joining client is told the state rather than left to infer it.
6. **Steering carries no authority of its own.** A correction cannot widen scope. If the new direction needs permission the agent does not have, that is a permission request under [ADR-0023](0023-the-phone-is-a-consent-surface.md), with its own proof-of-human. Redirecting is not granting.
7. **A correction is bounded by the same declared plan.** If the new direction materially changes the scale the agent declared, it re-declares it ([ADR-0021](0021-standing-authority-is-armable-attestation-is-not-waivable.md) rule 6).

## Consequences

**Good.** It is the difference between an assistant and a batch job. A person who notices drift can fix it in one sentence from wherever they are, instead of killing the run.

**Good.** It makes the emergency stop a genuine last resort rather than the only intervention available, which should make it rarer and therefore more meaningful when used.

**Cost.** The session and turn state machine gets materially more complex, and it is already the component that owns lanes, sessions, and liveness. The prototype's liveness work needed 24 tests to pin one opening frame (PR #230 mutation results) — this is not a cheap area to add a state to, and the mutation suite must grow with it.

**Cost.** Checkpoint semantics are a real design problem, not a detail. Too coarse and steering feels ignored; too fine and the agent is checking for corrections instead of working. This ADR states the rule (correct at a safe point, never mid-commit) and deliberately leaves the granularity to be found against real tasks.

**Cost.** Steering is an inbound instruction channel to a running agent, from a device that may be off-network. It is the second high-value attack surface introduced in one day, after [ADR-0023](0023-the-phone-is-a-consent-surface.md). Rule 6 is the containment — a correction can redirect but never widen — and it is the clause worth mutation-testing hardest.

**Cost.** Not scheduled here. This is a decision about shape, so that the state machine written for M3 has a place to put it rather than being reshaped later. Building it before M6 would be feature work against a moving target ([ADR-0015](0015-one-vertical-slice-before-parallel-agents.md)).

## Evidence

| Claim | Source |
|---|---|
| steering the agent in another direction | Jamie, 2026-08-08, rebuild design conversation |
| hub owns the session and turn state machine | [01-ARCHITECTURE.md §2](../01-ARCHITECTURE.md) |
| lane vocabulary is outbound only | [01-ARCHITECTURE.md §4](../01-ARCHITECTURE.md) |
| a decline is a complete turn; ending a session closes the gate immediately | [01-ARCHITECTURE.md §6](../01-ARCHITECTURE.md) step 9; prototype PR #231 |
| a joining client must be told current state or sits in the wrong mode | prototype PR #230 |
| 24 tests went red when the opening voice-state frame was removed | prototype PR #230 mutation results; [05-TEST-STRATEGY.md](../05-TEST-STRATEGY.md) |
| identity is derived, not claimed | [ADR-0007](0007-identity-is-derived-credentials-are-minted.md) |
| episodes are an inspectable graph | [ADR-0013](0013-episodes-are-a-git-graph.md) |
