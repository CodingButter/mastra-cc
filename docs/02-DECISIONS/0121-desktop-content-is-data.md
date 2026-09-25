# ADR-0121: Desktop content is data, not instructions

Date: 2026-09-25
Status: Accepted. Proof in [untrusted-content](../proofs/untrusted-content/README.md). Closes audit items H3 and M6.

## Context

Everything the daemon reads back — element names, field contents, page text — was written by someone other than the operator. An agent that treats that text as instructions can be steered by any web page or document it is asked to read (prompt injection). Separately, the optional WebSocket listener accepted a handshake from any browser page, so any website the operator visited could open a connection to a loopback daemon.

## Decision

- **The daemon does not interpret content.** It reports what the desk says, verbatim and attributed to the element it came from. It never follows, filters or rewrites it; judging it is the consumer's job.
- **The shipped agent instructions say so.** `docs/11-AGENT-INSTRUCTIONS.md` states that desktop text is data and that instructions come only from the person in the conversation.
- **Browser origins are refused by default.** The WebSocket listener refuses any handshake carrying an `Origin` header not listed with `--ws-allow-origin <origin[,origin…]>` (HTTP 401). A handshake with no `Origin` is not a web page — the transport, scripts — and is admitted as before.

## Consequences

- Instructions reduce injection risk; they do not eliminate it. A model can still be persuaded, so effect-class gates (ADR-0046) and grants remain the enforcement, not the prose.
- A browser-hosted client must now be listed explicitly. No authentication is added; that stays out of scope.
