# Is the accessibility binding thread-safe?

Produced by `spikes/daemon/thread-safety.py`, which is deleted at the end of
M0.5.

The prototype asserted that the binding is not thread-safe, and specifically
that violating it produces **silent data corruption rather than a loud error**.
The assertion lives in a docstring and was never tested, while the daemon's
entire single-threaded shape rests on it.

## Result: the design is right and the stated reason is wrong

| | |
|---|---|
| Control — **one** worker thread | exit 0, 60 successful reads |
| Experiment — **8** worker threads | exit -5 on all 2 repeats |
| Diagnostic | `(process:61464): dbind-ERROR **: 02:50:48.065: AT-SPI: Couldn't connect to accessibility bus. Is at-spi-bus-launcher running?` |

Concurrent access does not silently corrupt anything. It **aborts the process
immediately and deterministically**, before a single read completes, with a
diagnostic printed to standard error. Exit `-5` is `SIGTRAP`: the library calls
`abort()` rather than returning an error, which is the behaviour the prototype
documented elsewhere and did not connect to this claim.

The boundary is sharp. One worker thread reads the desktop happily. Two do not.
That was checked at two, three, four and eight threads, twice each, and the
result never varied.

**Confirmed on a second machine.** The same spike was run on a different host —
X11 rather than Wayland, a different desktop session, different hardware — and
produced the same result: control exit 0, concurrent exits `-5` on both repeats.
A crash reproducible on one machine could be that machine's problem; on two
unlike machines it is the library's behaviour.

## What this measurement does *not* establish

The diagnostic names a **connection** failure, not a corrupted read. So the
mechanism consistent with this evidence is *concurrent connection setup aborts
the process* — not *concurrent use of an established connection is unsafe*. The
control does not separate the two, because one worker thread opens one
connection and the failure appears at the second.

That distinction is load-bearing rather than pedantic. This daemon speaks D-Bus
directly and loads no `libatspi`
([ADR-0030](../02-DECISIONS/0030-the-daemon-is-one-node-process.md) clause 1),
and a D-Bus client opening one socket per connection is ordinary practice. **The
abort measured here is a property of the C library's connection setup, and it
cannot be assumed to transfer to the route being built.**

The experiment that separates them: establish every connection first, confirm a
sequential read on each, and only then read concurrently. If that survives, the
hazard is setup and not use. M1 owes it, on the Node route — recorded as an owed
measurement in ADR-0030 clause 3.

## Why the control run is the important half

A crash on its own proves nothing about concurrency — it could mean the binding
cannot be used off the main thread at all, or that something about a child
process is wrong. So the single-threaded control runs first and must succeed
before the concurrent result is allowed to mean anything. It does: one thread,
same code path, same child process, no crash.

## What this changes

The single-threaded daemon design **survives, with a better justification than
the one it had.** The documents should stop citing silent corruption and start
citing this: concurrent access to the accessibility bindings terminates the
process, loudly, every time.

That difference is not cosmetic. A silent-corruption risk argues for defensive
review, since violations would be invisible and could accumulate unnoticed. A
deterministic abort argues for something better — a startup assertion, because
any violation announces itself immediately and cannot reach production quietly.
It also means the rule is **cheaply testable**, which a corruption risk would
not have been.

One caution against over-reading this: it says nothing about the same library
under a properly initialised GLib main context, which is how the prototype
actually used it. What it settles is the claim as written.

## Receipt

```
python3 spikes/daemon/thread-safety.py --threads 8 --reads 40
```
