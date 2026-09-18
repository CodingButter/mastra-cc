# ADR-0108: One desk takes one task at a time

Date: 2026-09-17
Status: Accepted — CC-05 task serialization in the consumer. Completes the half of single-driver authority that [ADR-0100](0100-one-connection-owns-desktop-effects.md) could not reach from inside the daemon. No schema change.

## Evidence

The daemon already refuses a second driver, and that guarantee holds: one connection owns the desk, a contender is turned away before any effect, and a reconnect with an old generation gets nothing. The remediation plan (CC-05) names what it leaves open in the same paragraph it grants it: *a single connection serving two interleaved agent loops is still two competing drivers in practice.*

That case is not hypothetical — it is the normal shape of a consumer. One `MastraCC` instance is one connection by design (ADR-0060), which is the right design for signal delivery, attribution and ownership. It also means two unrelated goals sharing that instance are, to the daemon, one driver making a serialized sequence of individually valid calls. Every call is serialized. The tasks are not. One loop types into a dialog the other loop opened, and the desk cannot tell the difference because from where it stands there is no difference.

The daemon cannot fix this: it has no way to distinguish two call sites on one connection, and inventing a per-call task identifier would be a token the second loop simply does not carry. The distinction exists only where the two loops exist, which is the consumer.

## Decision

`MastraCC.withTask(name, run)` holds the desk for one complete task and releases it when the task settles, including when it settles by throwing.

While a task holds the desk:

- an **effect** dispatched from outside that task is refused with `DeskBusyError`, before the dial and before anything is sent;
- an **observation** is never refused. Refusing it would hide the busy desk from the loop that most needs to see it, and looking changes nothing.

A task that arrives while another holds **waits**, up to `WAITING_TASK_LIMIT` (8) waiters. Past that the desk is honestly busy and says so. The lease travels with the async context (`AsyncLocalStorage`) rather than through the call signature: tools are built before any task exists, and a lease a caller must remember to carry is one the rival loop forgets to carry.

A consumer that never calls `withTask` is not serialized behind anyone. A single loop that never asked for a task is not competing with itself, and imposing a lease on it would be a breaking change dressed as a safety feature.

## What this does not claim

- This is not exclusivity over the OS session. Another daemon, another consumer process, or a person at the keyboard can still act on the same desktop; the one-authority-per-desktop deployment rule (ADR-0100) is still the only thing that makes that claim true.
- Refusing an effect does not retract one already sent. The refusal is at dispatch; a task that was mid-effect when it lost interest is covered by cancellation boundaries (ADR-0106), not by this.
- Waiting is bounded queueing, not scheduling. Nothing here decides which task *should* have the desk, and a queued task must observe the desk again before acting: the desk it observed before waiting is not the desk it gets.

## Consequences

- Added: `withTask`, `heldBy`, `DeskBusyError`, `WAITING_TASK_LIMIT` on the `@mastra-cc/desktop/mastra` surface. No protocol or schema change; a daemon cannot see any of this.
- Effect classification reuses `EFFECT_METHODS`, already shared with the CC-06 wake policy: one list, so an effect that is invisible to attribution cannot be visible to serialization, or the reverse.
- Pinned by `packages/desktop/src/__tests__/one-desk-takes-one-task-at-a-time.test.ts` against a real daemon, and by four mutations covering the refusal, the release on failure, the waiting bound, and the observation exemption.
