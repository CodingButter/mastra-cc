# 0035 — The browser is read through its own protocol, over a hand-rolled channel

Status: accepted, 2026-08-10 (M2.2)

## Context

ROADMAP names the browser route the majority case, and the M0.5 spikes proved
why: the platform's accessibility route shows a browser's content only when
the renderer tree is switched on at launch (measured: 202 nodes with
`--force-renderer-accessibility` against 2 without —
`docs/proofs/which-condition-makes-a-browser-readable.md`), while the
Chromium debugging endpoint serves the browser's own computed semantic tree
regardless (`docs/proofs/what-the-browser-protocol-gives-us.md`). The daemon
already launches applications itself (ADR-0027) and knows what it launched
(ADR-0029), so the debugging port is something the daemon's own launch recipe
opens — never a setting edited on someone else's browser.

Two ways to speak that protocol were considered: an automation library
(Playwright) or a hand-rolled channel over the endpoint's HTTP discovery and
WebSocket transport.

## Decision

The browser backend rides the Chromium debugging protocol over a
**hand-rolled channel** (`daemon/src/backends/cdp/channel.ts`), using Node's
global `fetch` and `WebSocket` — zero new dependencies.

1. **Every exchange crosses one seam.** The channel exposes a single
   `exchange()` call for discovery (`/json/version`, `/json/list`) and
   per-target protocol calls. That seam is what makes capture and replay
   possible: the offline lane answers from a tape recorded off a real
   browser, exactly as the D-Bus channel's tape works for the platform route.
2. **Playwright was rejected**, for reasons of architecture, not taste: it
   hides the wire traffic inside its driver, so the capture seam this
   repository's offline lane depends on cannot exist; it insists on launching
   the browser itself, which collides with ADR-0027 (the daemon launches, the
   daemon owns); and it is a large dependency whose locators and auto-waiting
   solve problems a read-only backend does not have.
3. **Discovery is on the channel seam.** `/json/version` and `/json/list` are
   exchanges like any other, so replay answers them from the tape without a
   browser present. A channel that only recorded WebSocket traffic would need
   a live endpoint just to enumerate targets, and the offline lane would be a
   fiction.
4. **Replay refuses ignorance.** An exchange the tape never recorded throws
   `UnrecordedCdpExchangeError` — refusing to invent a reply, mirroring the
   D-Bus channel's rule. The error is defined locally: the two transports
   share a posture, not a type.
5. **The reply is stored connection-independent.** The JSON-RPC `id` is
   connection-local bookkeeping and is stripped before a reply is stored or
   returned, so a tape replays identically regardless of the connection that
   recorded it.

## Consequences

- Session routing is ours to maintain: per-target WebSocket connections,
  request/reply correlation, and target discovery ordering (`list` before
  `call`) live in ~180 lines of channel code instead of behind a library.
- The channel speaks to whatever answers the endpoint — Chrome, Chromium, or
  an Electron app whose debug port the daemon's own recipe opened — without a
  per-product support matrix.
- Chrome 136 and later ignore the debugging port unless a non-default user
  data directory is given; that constraint lives in the launch recipe, not in
  the channel (`docs/proofs/what-the-browser-protocol-gives-us.md`).
- An unreachable endpoint throws `CdpUnreachableError` for the caller to
  interpret — unreachable is itself reportable (ADR-0022), and the server's
  named refusal for it arrives with the backend, never a raw system error on
  the wire.

## Evidence

- The endpoint's shape and the pre-page injection proof:
  `docs/proofs/what-the-browser-protocol-gives-us.md` (Chrome 150.0.7871.186,
  measured on this machine).
- Why the platform route alone is not enough:
  `docs/proofs/which-condition-makes-a-browser-readable.md` (202 nodes with
  the launch flag, 2 without).
- Which installed applications this route covers:
  `docs/proofs/which-apps-the-browser-adapter-covers.md` (3 of 68 launcher
  entries on this machine are Chromium-based, classified from filesystem
  markers, never from names).
- The D-Bus channel whose posture this mirrors:
  `daemon/src/backends/atspi/channel.ts` (one seam, capture, replay,
  refuse-on-ignorance).
- Zero-dependency feasibility: global `fetch` and `WebSocket` are stable in
  the Node version CI pins (`.github/workflows/ci.yml`, node 22).
