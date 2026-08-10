# Is concurrent accessibility access safe on the Node route?

Produced by `tools/proofs/concurrent-accessibility.mjs` on 2026-08-10.

M0.5 measured a deterministic SIGTRAP abort at two or more threads through
`libatspi`/GObject from Python
([is the accessibility binding thread-safe](is-the-accessibility-binding-thread-safe.md)),
and that artifact itself said the receipt cannot transfer to a process that
loads no native addon. [ADR-0030](../02-DECISIONS/0030-the-daemon-is-one-node-process.md)
clause 3 recorded the debt; this is the payment, on the route the daemon
actually uses: plain D-Bus over dbus-native@0.15.1, no `libatspi`, no GObject, no
threads.

## The separation, and how it is measured

The old artifact could not tell *concurrent connection setup aborts* from
*concurrent use of an established connection is unsafe*. This one can:

- **sequential** (the control) - open and read through each connection one at
  a time. Must succeed for the other rows to mean anything.
- **concurrent-setup** - open all N connections at once, then read each.
- **concurrent-use** - open and read through every connection sequentially
  FIRST, then read all N concurrently. A failure here is concurrent use, not
  setup, because every connection has already proved itself.

Each run is a disposable child process, so an abort is a recorded exit status.
A connection is counted established only after the socket, the authentication
handshake and one round-trip on the accessibility bus have completed; a read
is `GetChildren` on the registry root.

## Result

| mode | connections | rep | exit | wall ms | worker ms | apps seen |
|---|---|---|---|---|---|---|
| sequential | 2 | 1 | 0 | 58.5 | 10.6 | 20/20 |
| sequential | 2 | 2 | 0 | 60.5 | 10.1 | 20/20 |
| sequential | 2 | 3 | 0 | 53.4 | 10.3 | 20/20 |
| sequential | 4 | 1 | 0 | 64.6 | 16.6 | 20/20/20/20 |
| sequential | 4 | 2 | 0 | 68.1 | 14.8 | 20/20/20/20 |
| sequential | 4 | 3 | 0 | 60.8 | 16 | 20/20/20/20 |
| sequential | 8 | 1 | 0 | 75.6 | 25 | 20/20/20/20/20/20/20/20 |
| sequential | 8 | 2 | 0 | 71.5 | 22.8 | 20/20/20/20/20/20/20/20 |
| sequential | 8 | 3 | 0 | 73.9 | 24.7 | 20/20/20/20/20/20/20/20 |
| concurrent-setup | 2 | 1 | 0 | 55.3 | 7.4 | 20/20 |
| concurrent-setup | 2 | 2 | 0 | 54.2 | 7.5 | 20/20 |
| concurrent-setup | 2 | 3 | 0 | 49.8 | 7 | 20/20 |
| concurrent-setup | 4 | 1 | 0 | 52.1 | 8.5 | 20/20/20/20 |
| concurrent-setup | 4 | 2 | 0 | 59.9 | 9 | 20/20/20/20 |
| concurrent-setup | 4 | 3 | 0 | 55.5 | 12 | 20/20/20/20 |
| concurrent-setup | 8 | 1 | 0 | 59.6 | 13.3 | 20/20/20/20/20/20/20/20 |
| concurrent-setup | 8 | 2 | 0 | 64.3 | 11.9 | 20/20/20/20/20/20/20/20 |
| concurrent-setup | 8 | 3 | 0 | 76.1 | 13.1 | 20/20/20/20/20/20/20/20 |
| concurrent-use | 2 | 1 | 0 | 59.2 | 9.5 | 20/20 |
| concurrent-use | 2 | 2 | 0 | 59.2 | 12 | 20/20 |
| concurrent-use | 2 | 3 | 0 | 56 | 11.4 | 20/20 |
| concurrent-use | 4 | 1 | 0 | 59.8 | 14.1 | 20/20/20/20 |
| concurrent-use | 4 | 2 | 0 | 58.2 | 16.1 | 20/20/20/20 |
| concurrent-use | 4 | 3 | 0 | 58.3 | 16.9 | 20/20/20/20 |
| concurrent-use | 8 | 1 | 0 | 74.3 | 27.9 | 20/20/20/20/20/20/20/20 |
| concurrent-use | 8 | 2 | 0 | 75.9 | 24.7 | 20/20/20/20/20/20/20/20 |
| concurrent-use | 8 | 3 | 0 | 68.9 | 23 | 20/20/20/20/20/20/20/20 |

## Verdict, in the checkbox's own terms

**Neither was observed.** Every sequential control succeeded, and neither *concurrent setup* nor *concurrent use* aborted, errored, or raised a signal at 2, 4 or 8 connections over three repetitions each. On the Node route, in this process shape, on this machine, concurrent accessibility access did not reproduce the Python route's abort.

The daemon **keeps serialising accessibility access in M1 regardless**: one
owner for the bus is what makes an audit record attributable
(`docs/07-ROADMAP.md:92`), which is a reason that does not depend on safety.
The measurement retires the *inherited* justification, not the design.

## Limits

- **Hardware and date:** Intel(R) Core(TM) 5 120U, 7 GB RAM, Linux 7.0.0-28-generic, Node v25.2.1, dbus-native@0.15.1; measured 2026-08-10.
- **One machine, one desktop session.** The Python-route abort reproduced on a
  second machine; this measurement has not been repeated on one yet.
- **Connections, not threads.** The Node route is single-threaded by
  construction; what is exercised here is N independent bus connections in one
  process, opened and used concurrently on the event loop. No thread enters
  this measurement, so it neither confirms nor contradicts the Python
  artifact's finding about threads - it answers the question ADR-0030 clause 3
  actually owed.
- **Read-only.** Every exchange is a read (`ListNames`, `GetChildren`);
  concurrent *writes* are M2's problem, arriving with the first effect-class
  operation and B11.
