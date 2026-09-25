# ADR-0122: The server is six modules behind one door

Date: 2026-09-25
Status: Accepted. Proof in [server-seams](../proofs/server-seams/README.md). No behaviour change.

## Context

`daemon/src/server.ts` had grown to 3,247 lines holding grants, launch and focus, subscriptions and stall handling, effect dispatch, request queues and the pipes. Every audit fix in this series landed in it, and every one conflicted with the others.

## Decision

The declarations move, unedited and in their original order, into `daemon/src/server/`:

| module | holds |
|---|---|
| `grants.ts` | launch context, effect authority, configuration withholding, the scope and gate refusals, capability state, inventory resolution |
| `launch-focus.ts` | accessibility acquisition, `listApplications`, open/restart, focus before and after an effect |
| `subscriptions.ts` | attribution, `SubscriptionBook`, the stalled-consumer bounds, subscribe/unsubscribe |
| `dispatch.ts` | `performEffect`, every effect handler, `DISPATCH`, `handleRequest` |
| `queues.ts` | per-target queues and the queue-wait cost (the metrics seam: every other measurement already lives in `costs.ts`) |
| `pipes.ts` | Unix and WebSocket pipes, `serveConnection`, both listeners |

`server.ts` keeps the request-line cap and re-exports all six, so every import of `./server.js` is unchanged. Declarations that were file-private are now exported from their module; they're still not part of the package's API.

## Consequences

- Static tests that read "the server's source" read it through one helper, `serverSource()`, which concatenates the hub and all six modules. That's the only test change: the file-read line in six tests.
- Mutation anchors that named `server.ts` now name the module holding their text. Each still matches exactly once.
