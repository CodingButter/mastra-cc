# 0072 — A dead connection stays dead, and a tool result knows its call

- **Status:** accepted
- **Date:** 2026-09-03
- **Schema:** 1.13.0 (unchanged)
- **Related:** ADR-0060 (one MastraCC instance owns one connection), ADR-0069 (the demo keeps the model above the desktop boundary), ADR-0071 (the desk reports failure instead of false absence)

**No protocol schema change.** The generated schema regenerates to an empty diff.

## Context

A transport connection used to reject requests that were already pending when its wire closed, but it remembered no terminal state. A later call could enter the pending map and write to the dead wire with nothing left to settle it. The browser desk demo compounded that failure by retaining one process-global `MastraCC` whose rejected dial or closed connection could be reused forever. The interrupted agent turn could then remain busy, and restarting the daemon did not make the next turn healthy without restarting Next.js.

The transcript had a separate identity error. Demo `tool-result` events named the tool but not the invocation. The browser paired each result with the newest unresolved call of that name, so two overlapping calls to `queryElements` could exchange results even though the daemon and model had kept them distinct.

Evidence: the transport had no terminal guard before commit `62b600a`; the merge-base recovery proof is recorded in `.mastracode/plans/the-demo-tells-the-truth.proof/without-recovery.txt`; and the merge-base pairing proof records crossed same-name results in `.mastracode/plans/the-demo-tells-the-truth.proof/without-pairing.txt`.

## Decision

A transport client's first terminal connection failure is permanent for that client instance. `TransportConnectionError` names that state with code `MASTRA_CC_TRANSPORT_TERMINAL`. The transition preserves its first cause, rejects and clears the handshake and pending requests, and is idempotent. Every later call rejects with the stored error before allocating an ID, entering the pending map, or writing to the wire. A response-level method refusal remains non-terminal.

`MastraCC` keeps its ADR-0060 identity: one instance owns one connection and does not reconnect, retry, or replay. The desk demo instead owns a cache of instances. A terminal tool failure compare-and-clears only the exact cached instance that failed. The current turn is aborted and shown as failed; it is never replayed because a desktop effect may already have happened. The next user turn lazily constructs a new `MastraCC` and may dial the replacement daemon.

Every demo `tool` and `tool-result` event carries a mandatory `callId`. The wrapper creates one process-local identifier from a module-lifetime random prefix and monotonic counter immediately before invoking the tool, then reuses it for that invocation's result. The transcript pairs exclusively by `callId`; the tool name is only a consistency check. Unknown, duplicate, or name-mismatched result IDs produce a visible notice and do not mutate another call.

This is demo-local event vocabulary. The daemon protocol and schema remain `1.13.0`.

Evidence: terminal ownership and the pre-write guard are implemented at `packages/transport/src/index.ts:223-235` and `packages/transport/src/index.ts:309-320` in commit `62b600a`; exact-instance invalidation and next-turn construction are at `apps/desk-demo/src/lib/desk-cache.ts:1-12` and `apps/desk-demo/src/lib/agent.ts:17-23,104-119` in commit `98288d4`; turn abortion is at `apps/desk-demo/src/app/api/chat/route.ts:23-47`; call creation and reuse are at `apps/desk-demo/src/lib/agent.ts:104-113`, and ID-only pairing is at `apps/desk-demo/src/lib/transcript.ts:21-33` in commit `307e958`.

## Consequences

- A dead client fails immediately and consistently; it cannot accumulate requests that no wire can answer.
- Ordinary daemon refusals do not discard connection identity or subscriptions.
- Restart recovery is explicit at the application owner. The demo can recover on the next turn without making transport or `MastraCC` secretly reconnect.
- An interrupted turn is honestly lost. The person must submit a following turn; this avoids duplicating an effect whose outcome is unknown.
- A stale failure cannot evict a newer desk instance because invalidation is compare-and-clear by object identity.
- Transcript ownership no longer depends on completion order or tool-name uniqueness.
- Call IDs are unique only within one server process. That is sufficient for the process-local streamed transcript, but they are not protocol identities and must not be treated as durable cross-process IDs.
- Malformed result sequences remain visible as notices instead of being silently attached, at the cost of leaving the affected call unsettled in the transcript.
- Browser disconnection still does not abort server work. That is a separate lifecycle decision.

## Evidence

- Commit `62b600a` — `fix(transport): make terminal connections stay dead`.
- Commit `98288d4` — `fix(desk-demo): recover after the desk connection closes`.
- Commit `307e958` — `fix(desk-demo): pair tool results by call id`.
- `packages/transport/src/__tests__/terminal-connection.test.ts` covers terminal reuse, no later write, explicit close, initial dial failure, synchronous handshake-write failure, and synchronous request-write failure.
- `apps/desk-demo/src/lib/__tests__/desk-cache.test.ts`, `agent.test.ts`, `stream.test.ts`, `transcript.test.ts`, and `apps/desk-demo/src/app/api/chat/route.test.ts` cover cache identity, one-turn abort, stream closure/error behavior, history, labels, call correlation, and malformed result sequences.
- `.mastracode/plans/the-demo-tells-the-truth.proof/with-recovery.txt` records branch recovery after daemon replacement while Next.js remains running; `without-recovery.txt` records the merge-base stuck turn.
- `.mastracode/plans/the-demo-tells-the-truth.proof/with-pairing.txt` records correct branch ownership for overlapping same-name calls; `without-pairing.txt` records the merge-base crossed results.
- `node tools/mutations.mjs` killed the terminal pre-write guard and call-ID equality mutations during their phase gates.
