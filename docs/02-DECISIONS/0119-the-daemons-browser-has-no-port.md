# ADR-0119: The daemon's browser has no port

Date: 2026-09-25
Status: Accepted. Proof in [cdp-pipe](../proofs/cdp-pipe/README.md). Closes audit item H2 for browsers the daemon launches.

## Context

The `chrome` and `gmail` launch recipes started Chrome with `--remote-debugging-port=9744`. Any local process could open that port and drive the browser, including the signed-in Gmail profile. That bypassed every grant, receipt and refusal the daemon enforces.

## Decision

A browser the daemon launches speaks the debugging protocol over a **pipe**, not a port.

- The recipes pass `--remote-debugging-pipe`. Chrome reads commands on its fd 3 and writes replies on fd 4, as NUL-delimited JSON. Only the daemon holds the other ends, so no other process can reach the browser.
- `pipe.ts` adapts the pipe to the existing channel seams, so `channel.ts` and its deadlines, dialog tracking and isolated world are unchanged:
  - discovery (`/json/version`, `/json/list`) is answered by `Browser.getVersion` and `Target.getTargets`;
  - each target gets a flattened session (`Target.attachToTarget`, `flatten: true`) that acts as its socket;
  - a closed pipe ends every session and rejects what still waits; a detached target ends its session, and the next call attaches afresh.
- The browser process and both pipe ends are unref'd, so a launched browser never holds the daemon open.
- While the launched browser's pipe is open, the daemon talks to it through the pipe. Otherwise it falls back to `127.0.0.1:9744`.

**A browser the user starts themselves with `--remote-debugging-port` keeps that port.** The daemon still reaches it there. But so can any other local process, around the daemon's grants. That is the user's choice, and it is documented here rather than hidden. Only a daemon-launched browser is guarded.

## Consequences

- Another local process gets connection refused where it once got the daemon's browser.
- There is one launched browser at a time. A second launch replaces the pipe the daemon follows.
- The pipe carries every target over one stream. A slow target does not block the stream, since each call is matched by id and bounded by ADR-0114's deadline.
