# 0094 — A connection must finish introducing itself

**Date:** 2026-09-06
**Status:** Accepted

## Context

Transport waited indefinitely for a WebSocket upgrade or the daemon's schema hello. A desktop tool could therefore remain stuck before any request reached the daemon. The existing terminal-connection contract ([ADR-0072](0072-a-dead-connection-stays-dead-and-a-tool-result-knows-its-call.md)) did not bound startup.

## Decision

`packages/transport/src/index.ts` owns one fixed 10,000ms startup budget, covering opening the Unix socket or WebSocket and receiving the matching schema hello. Startup failure rejects with `TransportConnectionError`, clears its timer and closes the wire. A late event cannot revive the failed attempt. A successful handshake clears the deadline; it is not a timeout on subsequent requests.

The WebSocket implementation imports `ws` and uses its supported `terminate()` for failed startup, rather than relying on graceful `close()` to reclaim an uncooperative peer. Promote transport's existing `ws` devDependency to a runtime dependency: this is a dependency classification change, necessary because production now imports it, not a new package choice. Do not reach into private socket internals. Normal established-client close remains graceful; successful sessions are not terminated by the startup timer. The current artifact consequently needs no global WebSocket, though historical baselines may.

No public configuration, protocol field, automatic retry or replay is added. A caller may explicitly establish a fresh connection. Desktop wrappers inherit the behavior through the existing transport; the daemon and demo do not implement a second timer.

## Consequences

An unavailable or silent peer no longer leaves startup pending indefinitely. Ten seconds is a product default, not a measured universal network allowance; a slow remote peer can now fail where it previously waited. JavaScript timer scheduling is not a hard real-time guarantee. Failed startup must reclaim the underlying connection without waiting for a close-handshake reply; a WebSocket close frame is not required. The local proof allows 1.5 seconds after caller rejection to observe TCP closure before harness cleanup. This is a measured tolerance, not a universal real-time guarantee. Rejection is not proof of remote cancellation or reversal of desktop effects. Established requests remain unbounded by this change.

## Evidence

`packages/transport/src/__tests__/startup-deadline.test.ts` exercises the lifecycle. The [independent live proof](../proofs/connection-startup-2026-09-06/README.md) uses the built public client and real local stalled peers, checks request counters and connection closure, and checks explicit recovery. The revised proof requires an uncooperative raw upgraded peer to satisfy both bounded rejection and TCP closure, alongside cooperative cases and healthy Unix/WebSocket longevity. Historical transcripts remain unchanged, including the RED uncooperative evidence; earlier PASS output is not proof of this stronger contract. Final rebuilt-artifact verification passed on September 6, 2026: all stalled peers rejected near ten seconds, uncooperative TCP closure occurred immediately after rejection before harness cleanup, and healthy Unix/WebSocket sessions remained usable after 10.5 seconds. The full build/lint/typecheck/test gate passed 19/19 with 97 transport tests. See the proof README for the artifact hash, retained transcript, package-consumer check, and limitations.
