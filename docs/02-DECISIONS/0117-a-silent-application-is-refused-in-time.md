# ADR-0117: A silent application is refused in time

Date: 2026-09-25
Status: Accepted. Proof in [atspi-deadlines](../proofs/atspi-deadlines/README.md). This is the AT-SPI counterpart of [ADR-0114](0114-the-browser-cannot-hold-the-desk.md).

## Context

An AT-SPI call to a frozen application waited for the session bus's own NoReply, which takes 25 seconds. The daemon's request chain waits on every call, so one frozen application held every client for that long. The failure was also misreported: the application census treated the timeout as "no application answers to that name".

## Decision

Every accessibility-bus call is given a fixed 10-second deadline (`ATSPI_CALL_DEADLINE_MS`), using `dbus-native`'s per-call `timeout`. When the deadline fires, the library deletes the pending reply handler, so a late reply finds nothing waiting and is dropped. Nothing is delivered after the caller has been told.

A timeout becomes an `AtspiDeadlineError`, a subclass of the shared `CallDeadlineError`:

- **A read** reports `effectSent: false`: nothing was changed.
- **An effect member** (`DoAction`, `GrabFocus`, `InsertText`, `SetTextContents`, `Set`, and the other members that change the application) reports `effectSent: true`, and the outcome is UNKNOWN.

The error reaches the caller through every reader and walk. It is not swallowed as "element gone" or as a skipped node, so one frozen application costs one deadline, not one per node. The one exception is `listApplications`: a single application whose name times out is reported as "cannot tell", instead of failing the whole census. Deadline refusals are recorded with the `DeadlineExceeded` refusal class. The protocol is unchanged, and the deadline cannot be configured from the wire.

## Consequences

- A frozen application is refused in about 10 s instead of 25 s, and the refusal names the call that went unanswered.
- The global request chain can still be held for up to 10 s. Queues per target are a separate item.
- An application that takes more than 10 s to answer a single call is refused, even if it is not frozen.
