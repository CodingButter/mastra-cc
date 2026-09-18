# 0099 — Signal throttling retains bounded dirty pointers

Date: 2026-09-07

Status: core correction implemented; immediate watch-end cleanup landed September 17, 2026 (see the addendum below).

## Evidence

CC-04 in the supplied remediation plan identifies an unbounded last-wake map,
wall-clock ordering assumptions, and loss of the final change inside a leading
throttle window. The [built-library demonstration](../proofs/reliability-remediation/cc04/README.md)
compares the same event source and sink against pre-fix commit `00a9ad1` and the
candidate: one versus two notification attempts around a marked observation boundary,
and 1000 versus 32 leading attempts during unique-watch churn. These are synthetic
source/sink measurements, not native desktop or model-completion evidence.

## Decision

Use a local monotonic clock for intervals; retain daemon timestamps only as
notification metadata. Default behavior admits a leading notification, retains the
latest suppressed pointer, and attempts a trailing notification without requiring
another event. Delayed/out-of-order timestamps cannot reopen or extend a window.

Retention is independently capped at 256 keys plus one overflow pointer. Quiet
entries expire after the greater of the configured gap and one second. One local
unreferenced timer handles expiration and queued notification attempts. It never
queries the desktop. Delivered keys rotate to the queue's back, so hot keys cannot
starve quieter pending work. With continuing churn, eviction chooses the oldest
queue entry; evicted pending work becomes a broad, content-free invalidation.
This aggregate uses its own kind/dedupe/coalesce identity, no representative
source or attribution, and the highest priority among discarded pointers. This can
produce an extra observation but does not silently assert that every pointer was
retained. A fixed local one-second budget permits at most 32 notification attempts
per window. This is not a sliding-window bound or a bound on framework-internal
in-flight promises. Explicit `dedupeWindowMs: 0` opts out of both throttles and
retains no entries or timers.

Only protocol pointer fields are copied. No application text is retained. Stop
clears the queue, timer, and retained state; restart begins a fresh budget. Existing
attribution filtering and listener-generation protection remain in force. Errors
from notification delivery remain contained, without automatic retry.

## Limits and follow-up

A notification attempt is not proof the framework persisted it, woke the model,
or that the model observed final state. Provider delivery/coalescing policy remains
outside this deterministic guarantee.

The transport currently exposes change events but no watch-ended listener to this
provider. Quiet expired watches therefore leave bounded state until local expiry;
a queued pointer may still cause an extra notification attempt after unsubscribe.
Immediate removal on explicit unsubscribe, grant revocation, and connection/watch
termination needs a shared transport lifecycle observation rather than guessing
from an element's `disappeared` kind or intercepting only adapter tools. That part
of CC-04 is not claimed complete here. No protocol change is made in this slice.

### Addendum (September 17, 2026): the watch-end cleanup

The shared lifecycle observation turned out to already exist: the instance's
`ObservationLedger`, which both the tool layer and the signal provider hold.
The ledger now records ended watches - `unsubscribeElement` answering without
refusal marks the watch ended from the tool layer, and a `watchEnded` pointer
marks it from the daemon - and the provider's throttle hears each end and
forgets every pointer pending for that subscription. The one pointer it keeps
is the watch's own `watchEnded`, which the agent is still owed. No guard
against "late" pointers was needed: the wire is ordered, so a pointer written
before the unsubscribe answer arrives before it and is forgotten with the
rest, and the daemon's book writes nothing for a watch it has ended - a
guard written for that case survived its own mutation and was removed.
Proven under the real framework in
[`cc04/framework`](../proofs/reliability-remediation/cc04/framework/README.md).
Grant revocation mid-watch remains the design gap recorded for CC-06.

## Verification

Provider regressions cover reversed/forged timestamps, trailing delivery, 10000-key
churn, overflow invalidation, stop/restart, attribution, and disabled throttling.
Internal-state tests assert the hard bound at every insertion, expiration to zero,
content-free copying, and timer cleanup. Focused deletion mutations cover the cap,
expiration, budget, trailing wake, overflow, and throttle gap.
