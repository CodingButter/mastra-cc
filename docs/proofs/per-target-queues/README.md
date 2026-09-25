# Per-target queues (ADR-0118)

Test: `daemon/src/__tests__/one-frozen-application-stalls-only-itself.test.ts`. It runs a real daemon on a Unix socket, over a backend in which one application never answers until it is released.

- `without.txt`: base `ed39cb6` (structured refusals, before this change). A second client's read of another application, and an unscoped query, are both still unanswered after 2 s. Same-application order and per-connection order already hold. The queue-cleanup case fails there because the `queuedTargets` seam does not exist, not because of a behavioural difference.
- `with.txt`: the branch. All 5 pass; the other-application read answers in under 500 ms while the frozen one is still held.

Mutations: `every-call-waits-in-one-desk-queue`, `a-connection-requests-overtake-each-other`.
