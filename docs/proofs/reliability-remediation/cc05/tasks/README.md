# CC-05 tasks: one desk takes one task at a time

`PROOF: GREEN`

The daemon's single-driver rule is real and it holds: one connection owns the
desk, a contender is refused before any effect, and a reconnect with an old
generation gets nothing. That is proven next door in [`../README.md`](../README.md).

This is the case that rule cannot see. A consumer is one `MastraCC`, which is
one connection, which is **one driver** — and two agent loops sharing it are two
goals taking turns at the same desk while the daemon sees a single well-behaved
driver making individually valid calls.

## What the demo runs

Two goals, each making three edits to the same field with its own thinking time
between them, on a desk that records what it was actually asked to type.

```
without the lease, the desk was asked to type: invoice-1 holiday-1 invoice-2 holiday-2 invoice-3 holiday-3
   invoice contiguous: false  holiday contiguous: false
with the lease, the desk was asked to type:    invoice-1 invoice-2 invoice-3 holiday-1 holiday-2 holiday-3
   invoice contiguous: true  holiday contiguous: true
   tasks refused as busy: 0
a rival loop's effect while a task held the desk: refused (invoice)
   did it reach the desk: false
```

Every call in the first line was serialized, authorized and valid. No error was
raised, nothing was refused, and the sequence is one no goal asked for. That is
what "two competing drivers on one connection" looks like from the desk.

Under `withTask` each goal holds the desk for its whole run, and a rival loop
that never asked for the desk has its effect refused before anything is sent.

## What it does not claim

- Not exclusivity over the OS session. Another process, another daemon or a
  person at the keyboard can still act; that is a deployment rule, not a lock.
- Not a scheduler. Waiting is bounded at eight; past that the desk says it is
  busy. Nothing here decides which task deserves the desk.
- A refusal at dispatch does not retract an effect already sent. Mid-effect
  interruption is the cancellation boundary (ADR-0106), not this.
- Observations are deliberately never refused, so a second loop can always see
  that the desk is busy.

## Running it

```
node docs/proofs/reliability-remediation/cc05/tasks/demo.mjs [checkout]
```

Both arrangements run in the same process against the same built artifacts, so
the difference is the lease and nothing else. Transcript in `with.txt`.
Decision record: [ADR-0108](../../../../02-DECISIONS/0108-one-desk-takes-one-task-at-a-time.md).
Pinned by `packages/desktop/src/__tests__/one-desk-takes-one-task-at-a-time.test.ts`
and the mutations `the-rival-loop-takes-its-turn-anyway`,
`a-failed-task-keeps-the-desk`, `the-waiting-line-has-no-end`, and
`looking-at-a-busy-desk-is-refused-too`.
