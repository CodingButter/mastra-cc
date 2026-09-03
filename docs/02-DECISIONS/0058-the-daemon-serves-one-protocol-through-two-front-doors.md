# ADR-0058 — The daemon serves one protocol through two front doors

**Status:** accepted
**Date:** 2026-08-30
**Extends [ADR-0003](0003-one-shared-transport-package.md) and [ADR-0041](0041-agents-live-in-the-hub-clients-are-thin.md). Revisits, without reviving, the wire questions [ADR-0052](0052-the-lane-carrier-is-transports-second-wire.md) asked before [ADR-0057](0057-mastra-cc-is-a-peripheral-not-an-assistant.md) buried it.**

## Context

The daemon has only ever listened on a unix domain socket. That is the right default and it
costs nothing on a bare host: the filesystem is the address space, permissions are the
gatekeeper, and there is no port for anything to find. It has exactly one flaw, and it is
structural rather than a bug — a client that is not on the same filesystem cannot reach it.
That is now the shape of the product. [ADR-0057](0057-mastra-cc-is-a-peripheral-not-an-assistant.md)
made this repository a portable daemon plus an installable package, and the two are not
guaranteed to share a machine: the daemon may be in a container driving a desktop while the
agent runtime consuming it is anywhere at all. [ADR-0041](0041-agents-live-in-the-hub-clients-are-thin.md)
anticipated exactly this hop — *"socket on the same machine or a WebSocket over the tailnet"* —
and left it unbuilt.

The tempting bad answer is a relay: a small WebSocket process that forwards bytes into the
unix socket. It works, and it adds a second thing that can be running, be misconfigured, be
half-dead, and be a second place to look when a message does not arrive. The daemon already
owns the wire; the address it listens on is not part of the protocol.

## Decision

**One protocol, one handler, two listeners.** The per-connection logic — hello gate, digest
refusal, newline framing, request routing, event emission, watch teardown — is lifted into a
single `serveConnection(pipe, …)` in `daemon/src/server.ts:1341`, driven through a seven-member
`Pipe` interface. `startServer` adapts a `net.Socket` to it and keeps its signature and return
type unchanged; `startWebSocketServer` adapts a WebSocket connection to the same interface.
There is exactly one framing loop and exactly one of each refusal string in the file, which is
the mechanically checkable form of "the two pipes cannot drift".

**The newline stays.** Every response is `JSON + "\n"` and remains so on the WebSocket pipe. A
frame does not need a delimiter — but a frame that omits one is a *different payload*, and the
whole claim is that it is the same payload. Likewise the WebSocket adapter feeds frames into
the shared buffer rather than parsing JSON per frame, so a peer that packs two messages into
one frame or splits one across two behaves identically to a socket peer doing the same.

**`ws` for the server; the global `WebSocket` for the client.** Node has no built-in WebSocket
*server*, and RFC 6455 — masking, continuation frames, ping/pong, the close handshake — is
where subtle bugs live and is not our product. `ws` is a runtime dependency of the daemon only.
The transport is a *client*, and Node's global `WebSocket` is a perfectly good one — precedent
`daemon/src/backends/cdp/channel.ts:115` — so `packages/transport` gains no runtime dependency
for its second dial.

**Opt-in, loopback by default.** No flag means no listener and no open port; the default posture
is exactly today's. `--ws-port <n>` binds one, on `127.0.0.1` unless `--ws-host <addr>` says
otherwise, and `--ws-port 0` lets the kernel pick and prints the result. Binding wider is
therefore always a visible act in a command line. The flag exists because inside a container
loopback defeats `-p` publishing — Docker's proxy cannot reach the container's own loopback —
so the container case passes `--ws-host 0.0.0.0` deliberately.

**Where a URL dial sits under [ADR-0003](0003-one-shared-transport-package.md).** That
record makes the transport's four responsibilities normative and requires an ADR to add a
fifth. This is not a fifth. A URL names the *same* daemon peer speaking the *same* generated
vocabulary through the *same* digest handshake; only the address family changed. It falls
inside the existing address-resolution responsibility, and `connect()` remains one entry point
— naming both a socket path and a URL is refused rather than silently resolved.

**Authentication is out of scope by decision, not by oversight.** The daemon binds loopback and
says nothing about who may connect. Anything wider is the operator's deliberate act and the
composing product's problem. [ADR-0007](0007-identity-is-derived-credentials-are-minted.md) already sketched
the shape a product layer would add — a WebSocket subprotocol carrying a device id and per-device
secret — and that sketch remains the obvious starting point when one is needed. Nothing here
half-implements it, because a half-measure on this axis is worse than its absence: it creates an
impression of protection that the code does not deliver.

## Consequences

- **A port is a bigger blast radius than a filesystem path, and we are accepting that
  knowingly.** Anyone who can reach the port can read the screen and drive the keyboard. The
  mitigation is posture, not cryptography: off unless asked for, loopback unless widened, and
  every widening typed out by a human.
- **`ws` is a new runtime dependency** — the first the daemon has taken since `dbus-native`. It
  is MIT with no runtime dependencies of its own, and `tools/licences.mjs` walks the installed
  closure to say so rather than taking the manifest's word. `pnpm-lock.yaml` churns accordingly.
  It is imported lazily inside `startWebSocketServer`, matching how the D-Bus and AT-SPI
  backends load, so a daemon that never opens the second door never needs the library present.
- **Shutdown grew a second thing to close and no new ordering.** `terminateOwned(table)` still
  runs first in the signal handler, before any close and before any await, for the reason issue
  #14 taught us. `wsServer?.close()` was added beside `server?.close()`, never in front of the
  reap. `ws`'s `close()` stops accepting and fires only once every client has gone, so the
  WebSocket `on("close")` reap is belt-and-braces for the flagless case and explicitly not the
  mechanism the signal path relies on.
- **B5 got wider and is still not a proof.** The pin now treats a `ws` library import outside
  `packages/transport` as a violation the way it already treats `node:net`. It matches
  **imports**, so a second client dialling through the global `WebSocket` — which imports
  nothing — remains invisible to it. That is the same blind-spot class
  [ADR-0052](0052-the-lane-carrier-is-transports-second-wire.md) recorded at `:17-23`, narrowed
  rather than closed. B5 is a tripwire on the library, not a guarantee that no second client can
  exist, and nothing under the scanned roots imports `ws` today — so the planted-fixture
  transcript, not the real-tree run, is what evidences the widened half works.
- **What this takes from ADR-0052 and what it leaves buried.** It takes the observation that a
  websocket is the right shape for a client that is not on this filesystem, and the honesty about
  B5's import-only reach. It leaves buried the thing ADR-0057 removed: a *second wire* with its
  own four-word vocabulary. There is one wire here, generated from `protocol/schema.json`, and
  the second listener carries it byte for byte.
- The event direction [ADR-0039](0039-the-desktop-talks-first.md) defines is unchanged:
  the `SubscriptionBook` emits through the same `Pipe`, and a dropped WebSocket connection calls
  `closeAll()` at the *backend* rather than forgetting watches locally — a forgotten watch is
  still being fed.

## Evidence

- `bf95eea` lifts the handler; `f992849` adds the listener; `1092ca8` adds the dial; `96c987a`
  widens B5; `2dfc89b` proves the digest refusal over both dials.
- `daemon/src/__tests__/one-handler-behind-a-pipe.test.ts` — both refusals, the mid-buffer
  abandonment, and a two-message chunk, driven through a fake in-memory pipe.
- `daemon/src/__tests__/the-second-pipe.test.ts` — wire parity, both refusals byte-for-byte,
  frame-boundary independence in both directions, and teardown closing watches at the backend.
- `daemon/src/__tests__/daemon-dies-clean.test.ts` — a `--ws-port 0` variant across SIGINT,
  SIGTERM and SIGHUP, asserting exit code 0 with a null signal.
- `packages/transport/src/__tests__/dialling-the-second-pipe.test.ts` — hello, a method call, a
  subscription event and a clean close over a URL; and the both-addresses refusal.
- `node tools/licences.mjs` — 13 packages on the permissive allowlist with `ws` installed.
- `node tools/mutations.mjs` — including the entry that deletes B5's `ws` check and watches a
  test go red.
