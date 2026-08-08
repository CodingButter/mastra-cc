# ADR-0003 — One shared transport package, from commit one

**Status:** accepted
**Date:** 2026-08-08

## Context

The prototype grew a plugin that spoke to the daemon. Later, the hub needed to speak to the daemon too. Rather than reach for the plugin's client — which carried a Mastra SDK dependency the hub did not want in that position — the hub grew its own.

By day seven those two clients had drifted, and the drift was not cosmetic. The hub's copy **located the daemon socket by scanning filenames** and **skipped the schema digest check entirely**. The digest check is the mechanism that stops a client built against one protocol version from talking to a daemon built against another. One of the two clients had quietly opted out of the system's main compatibility guarantee.

Nobody noticed until the day-seven reshape (PR #227) extracted a shared package and the two implementations were laid side by side.

The same disease appeared in a second place, more visibly. Seven "live" modules — the ear chain, the fingerprint matcher, the gate, the session dial — existed three times over: as TypeScript source in the hub, as emitted JavaScript served to browsers, and as a vendored copy inside the Electron widget. Two generator scripts kept the copies in sync and a parity test caught drift. The parity test fired at least twice, once catching a hand-edit made directly to the vendored copy. It worked. It also means the drift kept happening, and every change in that area cost three files and a regeneration step.

## Decision

**`packages/transport` exists before the first client does, and it is the only implementation of the daemon wire protocol in the tree.**

Constraints on the package, all inherited from what the prototype's extracted version got right:

- **Node builtins only.** No Mastra SDK, no framework, no validation library that pulls a runtime. This is what let the prototype's `clients/shared` be adopted by both the hub and the plugin; the plugin kept its own Zod usage above the transport line.
- **It owns four things and nothing else:** framing and correlation, address resolution per operating system, daemon discovery, and the generated protocol bindings.
- **Digest verification is not optional and not a parameter.** There is no constructor flag that disables it.
- **It has its own test suite and its own typecheck**, run in CI independently of any consumer.

**Boundary B5** in [01-ARCHITECTURE.md](../01-ARCHITECTURE.md) enforces this: a source-level test asserts that no package outside `packages/transport` opens a socket to the daemon address or parses the daemon framing.

**On the three-copy problem specifically:** shared browser-runnable code lives in exactly one package (`packages/voice`), published to consumers as a build artifact by the build system, never by a bespoke vendoring script committed alongside the copy. If a consumer genuinely cannot consume a package — Electron's renderer being the realistic case — the vendored copy is produced by the build and is `.gitignore`d, so there is no second file for a human to hand-edit.

## Consequences

**Good.** One place to fix a transport bug. One place where the digest is checked. No parity tests, because there is nothing to keep in parity. The prototype's own experience is the argument: extracting the shared package immediately revealed a drifted client that had been running in production.

**Cost.** Up-front structure before there is a second consumer to justify it. This is a real cost and it is smaller than the alternative — the prototype paid for the alternative on day seven, during a 179-file rename, while five agents were working inside the directories being renamed.

**Risk.** A shared package can become a junk drawer. Mitigation: the four-responsibility list above is normative; adding a fifth requires an ADR.

## Evidence

| Claim | Source |
|---|---|
| hub had grown a second daemon client | PR #227 description and diff |
| the drifted client found the socket by filename and skipped the digest | PR #227 description |
| digest-keyed socket is the compatibility mechanism | issue #73 |
| three copies of seven live modules | `client/src/live/`, `client/public/live/`, `clients/widget/src/vendor/live/` |
| two generator scripts | `client/scripts/generate-live-assets.mjs`, `clients/widget/scripts/vendor-widget-face.mjs` |
| parity test caught a hand-edit to the vendored copy | `face-parity.test.ts:53`, 2026-08-08 02:06 |
| shared package is Node-builtins-only, no Mastra SDK | `clients/shared/package.json` — zero dependencies |
| reshape happened while five agents worked in the renamed dirs | branch probe, 2026-08-07 18:27 |
