# ADR-0115: A socket path belongs to the daemon listening on it

Date: 2026-09-24
Status: Accepted. Proof in [socket-ownership](../proofs/socket-ownership/README.md).

## Context

`startServer` removed the socket file unconditionally before listening. A second daemon started on the same path deleted the live daemon's socket and took the path over; every client of the first daemon was orphaned with no error on either side.

## Decision

Before removing anything, the daemon connects to the path. If something answers, start refuses with "a daemon is already listening at <path>". The file is removed only when the connection fails with `ECONNREFUSED` or `ENOENT`, meaning a stale leftover from a daemon that is gone.

## Consequences

- A crashed daemon's leftover file is still reclaimed without manual cleanup.
- Two daemons starting in the same instant can both see a free path; that race is accepted, not solved. A lock file was judged unnecessary for how the daemon is started.
- Other connect errors (for example permissions) propagate instead of being treated as stale.
