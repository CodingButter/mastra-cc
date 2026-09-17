# ADR-0103: Native watch membership is fresh and bounded

Date: 2026-09-07
Status: Accepted — bounded CC-08 correction; schema version 1.24.1

## Evidence

The native signal stream permanently cached positive and negative ancestry verdicts. Reparented nodes continued using their first verdict; an unreadable parent could permanently hide subsequent changes. Closing a watch while its parent read was pending could still permit one late sink call. Five new deterministic regressions fail against the pre-fix implementation.

## Decision

Check ancestry afresh for every candidate signal. Membership is internally inside, outside, or unknown. A cross-application parent is outside; a failed parent read, missing parent, cycle, or exhausted climb is unknown. Only an inside verdict permits delivery. No membership verdict survives into the next signal. The climb performs at most 24 parent reads and detects cycles. Check closure both during the climb and after its asynchronous result before emitting. Failed parent reads must not poison the serial decision queue.

This exchanges cache efficiency for correctness after reparenting. It does not claim an atomic tree snapshot: parent edges can change during the climb. An established probe proves only that registered signal classes can reach the listener, not complete subtree coverage. The native implementation still suppresses unknown membership rather than disclosing potentially out-of-scope identifiers.

## Verification and limits

Regression coverage includes reparenting in and out, recovery after unreadable ancestry, closure during a pending read, cycle and depth bounds, failure recovery, root delivery, descendants, unrelated senders and sibling isolation. Existing server visibility checks remain unchanged.

The retained RED/GREEN transcripts are deterministic seam-level verification, not a native-application demo. A live application that reparents accessible nodes and exposes deterministic parent-read barriers is not supplied here. This is an explicit proof limitation, not a claim that passing tests demonstrate live desktop behavior.

Follow-ups: versioned watch-health/coverage reporting for unknown membership; reliable deeper-than-24 descendant coverage; explicit root-removal lifecycle evidence; bounded queue and backstop-map retention; monotonic timing; native reparenting demonstration and cost measurements. No whole-subtree completeness, task-state integration, or cancellation of an already-issued parent read is claimed.
