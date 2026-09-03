# ADR-0059 — The package ships primitives and instructions, not macros

**Status:** accepted
**Date:** 2026-08-30
**Delivers the second artifact [ADR-0057](0057-mastra-cc-is-a-peripheral-not-an-assistant.md) named. Consumes, and does not duplicate, the one client of [ADR-0003](0003-one-shared-transport-package.md) over either door of [ADR-0058](0058-the-daemon-serves-one-protocol-through-two-front-doors.md).**

## Context

[ADR-0057](0057-mastra-cc-is-a-peripheral-not-an-assistant.md) says this project ships two
things: a portable daemon, and an installable package a runtime consumes. The daemon is
proven. The package is what an agent actually holds, so its shape is the whole question —
and unlike the daemon's shape, it is a matter of taste rather than a matter of a gate.

Two shapes were available.

1. **Primitives plus instructions.** The fourteen protocol methods, one for one, plus the
   text that tells an agent how to use them.
2. **Scenario helpers.** A smaller set of macros — `findTheDocument`, `typeInto` — that hide
   element ids, refusal handling and subscription bookkeeping behind verbs.

Macros are the seductive one. They demo better and they read better in a README. They are
also a claim: that we know, in advance and on the agent's behalf, which element it meant and
what to do when the desktop says no.

The evidence says we do not need to make that claim.
[docs/11-AGENT-INSTRUCTIONS.md](../11-AGENT-INSTRUCTIONS.md) was written by dogfooding an
agent that was given raw transport and **no helpers at all**, and that agent finished the
task. What it lacked was never a smaller verb. It was three facts: that names are not
identifiers, that a returned call is not proof the desktop changed, and that a refusal is an
answer rather than an obstacle to route around.

## Decision

**The package is the protocol plus the prose.**

`@mastra-cc/desktop` wraps `@mastra-cc/transport` — it does not dial the daemon itself, which
pin B5 enforces rather than merely recommends — and exposes every method transport exposes,
unchanged. Its `connect()` takes the same `{ socketPath?, url? }` and adds environment
defaults so a runtime can be pointed at a daemon without code; mutual exclusion between the
two is transport's refusal, surfaced rather than re-implemented.

The instructions ship **inside the tarball** as an exported constant, and a test fails the
build when that file and `docs/11-AGENT-INSTRUCTIONS.md` diverge by a single byte. An agent
that installs the package is handed the reasoning, not just the verbs.

`@mastra-cc/desktop/mastra` is a subpath export that turns those methods into Mastra tools.
`@mastra/core` is a **peer**, so the base entry installs and imports without it. Each tool's
description and input schema are read from the generated protocol descriptors, so a schema
change moves the tools with it and a hand-written second copy cannot drift. A tool that is
refused returns the daemon's refusal text verbatim: no retry, no repair of the caller's
parameters, no smoothing.

Versioning is independent of the daemon's, as [ADR-0057](0057-mastra-cc-is-a-peripheral-not-an-assistant.md)
requires: the daemon is engineering and is done per release; this package is judgment and
drifts with every model that consumes it.

## Consequences

**What we get.** The package cannot lie about the desktop, because it does not decide
anything about the desktop. Everything an agent sees is what the daemon said. When a model
gets better at this work, the package needs no release; when the protocol changes, the tools
change with it mechanically.

**What we give up.** The first ten minutes are harder. An agent must resolve an element id
before it can write to one, and a naive caller will earn a refusal for a priority value it
guessed. That is the intended trade: a refusal that names the check that ran teaches, and a
macro that quietly picks an element does not.

**What stays open.** Option 2 is not refuted, only deferred, and deliberately: macros are
easy to add later and very hard to withdraw once callers depend on them. If real usage shows
the same three-call preamble in every transcript, that preamble is a candidate — as a
separate package or a separate subpath, so the primitives stay honest.

## Evidence

- [what the installable package does](../proofs/what-the-installable-package-does.md) — a
  process outside the workspace, importing only the packed tarball, drives a real desktop
  across a namespace boundary and passes a real refusal back unchanged.
- The proof's own closing section records the bullet this does **not** yet satisfy: the agent
  that drove it is not a cold reader of this repository.
