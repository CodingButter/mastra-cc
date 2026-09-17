# CC-09: what the daemon retains for a watch, measured

The plan's CC-09 line asks for retained cache sizes on the daemon side. The
consumer side and the recorded native cadence are in [`../load/`](../load/README.md);
this is the daemon's own path.

## Where the daemon keeps events

Reading `daemon/src/server.ts`: a change event goes `Backend sink` →
`SubscriptionBook.deliver` → `pipe.write(line)` → `socket.write(line)`. There is
no queue of the daemon's own between the backend and the socket, and the pipe
does not look at `socket.write`'s return value or `writableLength`. The only
retention on the way out is therefore Node's writable buffer for that
connection, plus the 256-pointer initialization buffer that exists only while
`subscribeElement` is resolving (see `../../cc08/initialization/`).

## Measurement (`measure.mjs`, built artifacts, `with.txt`)

Scripted observe-only backend, one Unix-socket connection through the real
`serveConnection`, one watch, 2000 changes emitted in bursts of 100 per event-
loop turn (faster than the recorded native ~10/s; this is a ceiling for the
retention path, not a rhythm claim). Two trials:

| client | events seen | Node `writableLength` at end | after resume |
|---|---|---|---|
| reading | 2000 | **0 B** | — |
| paused after subscribing | 0 | **247,214 B** | 2000 (nothing lost) |

One event line on the wire is 187 B. The Node-side figure is ~124 B per
undelivered event because the kernel's socket send buffer absorbed the first
~500 lines before Node started holding them; growth after that point is linear
(samples in `with.txt`: 23 KB at 800 events, 210 KB at 1800).

## What this says

- A consumer that reads keeps the daemon at zero retained bytes.
- A consumer that stops reading makes the daemon retain every event, without
  bound, at roughly the wire size per event. Nothing in the daemon notices;
  nothing in the daemon decides. The plan's product decision that the client
  owns pacing (ADR-0039: the daemon never re-anchors, never throttles for the
  client) is honoured, and this is its cost.
- Not measured: WebSocket pipe (same `write` shape, different buffer owner),
  multiple watches per connection (additive; nothing is shared), or a bound
  — there isn't one to measure.

## Follow-up recorded, not decided here

Whether a stalled consumer should be disconnected, told, or simply allowed to
accumulate is a policy with a number in it; picking the number is out of this
slice's scope (the plan forbids inventing SLAs from a first measurement). It is
listed in `FOLLOWUPS.md` with this measurement as its starting point.
