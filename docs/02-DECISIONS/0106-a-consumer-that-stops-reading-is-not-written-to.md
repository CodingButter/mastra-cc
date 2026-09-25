# ADR-0106: A consumer that stops reading is not written to

Date: 2026-09-17
Status: Accepted — CC-09 stalled-consumer policy. Refines [ADR-0039](0039-the-desktop-talks-first.md) (an event is a pointer with no content; the daemon never throttles for the client) by naming the one case where the daemon must decide something: a client that is not reading any more.

## Evidence

`docs/proofs/reliability-remediation/cc09/daemon-queue/` measured the daemon's retained queue toward a watch consumer. There is none of the daemon's own: an event goes from the backend sink through `SubscriptionBook.deliver` into `socket.write`, and nothing looks at the return value. A consumer that reads keeps Node's writable buffer at zero. A consumer that has stopped reading makes it grow at ~124 B per event, linear, without bound, and the daemon neither notices nor decides. Two thousand events was 247 KB; a day of the recorded native cadence (~10 changes a second) would be ~100 MB held on behalf of a peer that may never come back.

The measurement also gave the shape of a reader that is merely slow: the kernel socket buffer absorbs ~500 events before Node holds any, and a reading client drains to zero within a turn.

## Decision

Past **256 KiB of unsent bytes toward one connection** (`STALLED_CONSUMER_PENDING_BYTES`) the consumer is stopped, not slow — at the measured cost that is ~2100 events, over three minutes of not reading at native cadence, and well past what a busy reader ever reaches. From then until the pipe drains, the connection's watches are not written to. Instead each watch **holds** the newest change per element, at most 64 elements (`STALLED_CONSUMER_POINTERS`), forgetting the oldest beyond that. When the pipe drains, the held pointers are written, in the order they were last touched, and ordinary delivery resumes.

Three things are deliberately not done:

- The consumer is **not disconnected**. Disconnect ends the connection's watches and, for a driver, its ownership ([ADR-0100](0100-one-connection-owns-desktop-effects.md)); the daemon inventing a disconnect on the client's behalf would take all of that for the crime of being paused by its own host. A consumer that comes back finds its watches alive.
- The consumer is **not sent every event it missed**. An event is a pointer with no content (ADR-0039); what a consumer loses when pointers to the same element are collapsed is only how many times it changed, and it must reobserve on any pointer anyway. Replaying two thousand pointers to the same textbox would tell it nothing the last one does not.
- **`watchEnded` is never held.** It is one line and the last one for that watch; holding it would leave a dead watch looking alive to a consumer that eventually reads. A pointer held for a watch that ended while stalled is dropped, not delivered after the end.

A `SubscriptionBook` without a pipe (tests, in-process use) has no gauge and never holds anything.

## Consequences

The daemon now retains a bounded amount on behalf of any one connection: at most the bound plus one line in the socket, plus 64 pointers per watch. The number is a decision, made from the one measurement there is, and it is exported as a constant rather than hidden so the next measurement can move it.

The WebSocket pipe has no `drain` event; its gauge is `bufferedAmount` and its drain is the `send` callback that finds nothing buffered after pressure was seen. This is the same contract with `ws`'s vocabulary and is not separately measured here.

A consumer cannot tell a held-and-released pointer from a fresh one on the wire, which is the point: both mean "look again".

## Verification

`daemon/src/__tests__/a-consumer-that-stops-reading-is-not-written-to.test.ts` drives the book with a scripted gauge (writes under the bound, holds the newest per element over it, keeps at most N, never holds `watchEnded`, holds nothing without a gauge) and then a real Unix socket with a client that pauses: 8000 changes emitted, retained bytes stop at the bound instead of reaching ~1 MB, and the held pointers arrive when the client resumes, followed at once by the next fresh change. `docs/proofs/reliability-remediation/cc09/stalled-consumer/` runs the same shape against the built daemon beside the pre-decision measurement.

## Amendment (2026-09-24): answers are held on the request side

The bound above covered events only. Answers to requests were written straight to the socket, so a client that pipelined large reads and never read the answers could make the daemon buffer all of them. The measurement: 3,000 pipelined 16 KB reads left about 49 MB retained.

An answer cannot be coalesced or dropped, so it is bounded where it is caused. While a connection is over the pending-byte bound, or has `MAX_IN_FLIGHT_REQUESTS` (64) requests unanswered, the daemon dispatches no further request from it and stops reading it (`pause()` on the socket, so the kernel pushes back on the client). Reading and dispatch resume, in order, on drain or when an answer lands. The retained total per connection is at most the bound plus one round of in-flight answers.

A consequence: a request sent behind 64 unanswered ones, cancellation included, waits its turn. Proof in [stalled-answers](../proofs/stalled-answers/README.md). Test: `daemon/src/__tests__/answers-wait-for-a-reader.test.ts`.
