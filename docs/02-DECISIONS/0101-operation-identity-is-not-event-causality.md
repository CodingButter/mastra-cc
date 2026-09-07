# ADR-0101: Operation identity is not event causality

Date: 2026-09-07
Status: Accepted — conservative CC-06 event-origin correction
Supersedes: the timing/application event-attribution rule in ADR-0039 and the per-socket causality claim in ADR-0060. Historical records remain historical.

## Evidence

The same application name on two independent backend instances let an operation on one stamp the other's change `self`. Quiet periods stamped events `external` although delayed application responses remained possible. The built daemon/transport proof publishes changes before, during and after an operation to three subscribers across two backends: the baseline falsely labels all three streams external/self/external. No native causal evidence participates in that decision.

## Decision

Native change pointers always have `attribution: unattributed` and no `causeId`. Concurrent operations, matching application names, and absence of current operations prove neither self nor external origin. The enum is retained for evidence-backed producers; its reference frame is the desktop execution session, not the individual observing connection. Current server change streams have no such causal witness.

Operation audit receipts answer a different question: which request commanded an attempted effect. They retain their identity, now in request-local asynchronous context rather than module-global mutable in-flight state. Native event publication does not consult that context. Driver ownership remains separately connection-bound under ADR-0100.

Visibility checks and pointer-only publication remain intact. Raw transport listeners receive authorized events regardless of wake filtering. The signal provider retains its conservative external-only default; consequently current native changes do not generate automatic planning wakes. This deliberate fail-closed change avoids substituting an action/wake feedback loop for false causal certainty. Applications can explicitly opt into unknown-origin notifications, but bounded coalescing alone is not proof of loop freedom. Active tasks must consume the raw change stream for invalidation/completion independently of planner wakes.

Protocol 1.23.0 updates the generated contract and mirrored instructions. The adapter no longer claims that separate sockets establish per-agent causal attribution.

## Verification and limits

[CC-06 proof](../proofs/reliability-remediation/cc06/README.md) runs built daemon, transport and signal provider over real sockets with synthetic change sources and a notification sink. Three subscribers receive all nine pointers, zero cause IDs and zero default planning wake attempts. Regression tests cover the same ambiguity and a twenty-event raw-consumer burst; existing visibility and audit tests remain gates.

This is not a completed autonomous task-state machine or a new safe unknown-origin wake policy. Those require whole-task ownership and active/idle integration; track them with the CC-05 specialist follow-ups. No native causal tracing, live model-loop claim, or application-completion claim is made.
