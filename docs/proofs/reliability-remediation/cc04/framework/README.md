# CC-04: a watch that ended says nothing more (under the real framework)

ADR-0099 bounded the provider's retained pointers and left one thing open: a
pointer held for trailing delivery could still become a notification after
the watch was ended. "Framework-integrated run not done" was the FOLLOWUPS
row. This closes it.

## What changed

The instance's `ObservationLedger` - already shared by the tool layer and the
signal provider - now records ended watches. `unsubscribeElement` answering
without refusal marks the watch ended; so does a `watchEnded` pointer from
the daemon. The provider's throttle hears each end and forgets every pointer
pending for that subscription, keeping only the watch's own `watchEnded`.

A guard against pointers arriving *after* the end was written, survived its
own mutation, and was removed: the wire is ordered, so a pointer the daemon
wrote before answering the unsubscribe lands before the answer and is
forgotten with the rest; and the daemon's book writes nothing for a watch it
has ended. The test now pins that ordering instead.

## Demonstration (`demo.mjs`)

Real `Agent` (mastracode's Mastra install, core 1.64.0) with the desk's
provider under `signals`, real `LibSQLStore` notification storage with a
`persist` policy, `fetch` forbidden (0 calls), a real daemon on a Unix socket
with a scripted observe-only backend, and the real tool layer ending the
watch. Rows for one subscription coalesce while pending, so the honest count
is each row's `coalescedCount`.

| | RED `without.txt` (master build) | GREEN `with.txt` (this branch) |
|---|---|---|
| tool ends the watch with a pointer held | `desktop.changed x2` after `ended: true` — the held pointer woke the thread after the watch was over | `desktop.changed x1` before and after the end |
| daemon ends the watch with a pointer held | (not reached) | `desktop.changed x1`, `desktop.watchEnded x1`; nothing after |
| bytes pushed at the backend after the end | — | nothing: the book has no entry |

Run: `node demo.mjs <checkout> <mastra-install>/package.json`. The RED was
taken from a clean worktree of `origin/master` built with the same
dependencies.

## Regression coverage and mutations

`packages/desktop/src/__tests__/a-watch-that-ended-says-nothing-more.test.ts`:
the throttle forgets a subscription's pending pointers and keeps other
watches'; it keeps the watch's own end even when the wake budget has it
pending; through a real daemon, a pointer held when the tool ends the watch
is not delivered and a daemon-ended watch delivers `watchEnded` exactly once.
Mutations `an-ended-watch-keeps-its-pending-pointers`,
`forgetting-a-watch-drops-its-end-too` and
`the-tool-layer-ends-a-watch-and-tells-no-one` are each caught in isolation.

## Not claimed

Grant revocation mid-watch (the daemon's `Visibility` is fixed at boot; the
CC-06 design gap). Nothing about whether the model reads the notification.

PROOF: GREEN
