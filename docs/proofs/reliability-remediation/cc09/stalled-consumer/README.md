# CC-09: a consumer that stops reading is not written to (ADR-0106)

[`../daemon-queue/`](../daemon-queue/README.md) is the RED: the daemon's only
outbound retention toward a watch consumer is the socket's writable buffer,
which a client that has stopped reading grows at ~124 B per event, linear and
unbounded, with nothing in the daemon noticing. This slice is the decision
that measurement was left waiting on, and its proof.

## The decision, in one paragraph

Past 256 KiB of unsent bytes toward one connection (`STALLED_CONSUMER_PENDING_BYTES`,
~2100 events at the measured cost, over three minutes of not reading at the
recorded native cadence) the consumer is stopped rather than slow. Its watches
are no longer written to; each holds the newest change per element, at most
64 elements (`STALLED_CONSUMER_POINTERS`), and delivers them when the pipe
drains. The consumer is not disconnected, is not sent a replay, and its
`watchEnded` is never held. A book with no pipe holds nothing. Full reasoning
in [ADR-0106](../../../../02-DECISIONS/0106-a-consumer-that-stops-reading-is-not-written-to.md).

## Demonstration (`demo.mjs`, built daemon, `with.txt`)

Real `startServer` on a Unix socket, one client that subscribes and then
pauses its socket, 8,000 changes alternating over two elements in bursts of
100 per turn.

| | RED (`../daemon-queue/`, nothing decided) | GREEN (this slice) |
|---|---|---|
| retained at end | ~124 B × events, unbounded (247 KB at 2,000) | **262,174 B** — the bound plus one line, flat from event ~2,100 through 8,000 |
| seen while paused | 0 | 0 |
| delivered after resume | every event (2,000 of 2,000) | 2,082: what the socket already held, then **one held pointer per element** |
| fresh change after drain | written | written at once |

`with.txt` is the JSON the demo printed; the `samples` array shows
`writableLength` climbing to the bound and then not moving.

## Regression coverage

`daemon/src/__tests__/a-consumer-that-stops-reading-is-not-written-to.test.ts`:
four cases with a scripted gauge (under-bound writes, over-bound hold of the
newest per element with delivery on drain, the 64-pointer cap forgetting the
oldest, `watchEnded` never held and a held pointer for an ended watch dropped,
no gauge holds nothing) and one over a real Unix socket with a genuinely
paused client. Mutations in `tools/mutations.json`:
`a-stopped-consumer-is-still-written-to`, `the-drain-forgets-what-was-held`,
`the-watch-end-is-held-with-the-rest`, `held-pointers-grow-without-bound` —
each caught in isolation.

## Not claimed

The WebSocket pipe carries the same gauge through `bufferedAmount` and the
`send` callback; it is typed and reviewed, not measured here. The bound is a
number chosen from one measurement and exported so the next measurement can
move it; it is not an SLA.

PROOF: GREEN
