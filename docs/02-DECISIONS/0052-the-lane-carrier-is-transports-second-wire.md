# ADR-0052 — The lane carrier is transport's second wire, not the hub's first socket

**Status:** accepted
**Date:** 2026-08-22

**Relates to:** [ADR-0003](0003-one-shared-transport-package.md) (adds the fifth
responsibility its risk clause reserves), [ADR-0041](0041-agents-live-in-the-hub-clients-are-thin.md),
M4 segment 2.

## Context

M4 brings the first client this repository has ever had. The hub already produces the four
lane events; nothing yet carries them anywhere. Deciding what carries them is the segment's
one genuinely open question, and two written constraints pull in opposite directions.

**The first constraint is a comment in the code that produces the events.**
`apps/hub/src/lanes/lanes.ts:14-18` says: *"When M4 brings a client, the carrier lands inside
`packages/transport` (ADR-0003), never beside it. A WebSocket server growing in the hub would
leave B5 green while the boundary it exists to defend was breached."* That last sentence is a
precise claim about a blind spot rather than a slogan, and it checks out: `tools/pins/b5.mjs`
matches an import of `node:net`, so a carrier built on a WebSocket library inside the hub
would be a second wire implementation that the pin cannot see.

> **Consistency note, 2026-08-23:** The quotation above preserves the comment as
> this decision found it. The source comment now records the carrier's arrival in
> the past tense; the constraint and its B5 blind-spot reasoning are unchanged.

**The second constraint is ADR-0003's own risk clause.** That record lists four
responsibilities — framing and correlation, address resolution per operating system, daemon
discovery, and the generated protocol bindings ([ADR-0003:23](0003-one-shared-transport-package.md)) —
and then says the list is normative: *"adding a fifth requires an ADR"*
([ADR-0003:37](0003-one-shared-transport-package.md)). Those four describe **the daemon
wire**. A hub↔client lane is a different wire, with a different peer, carrying a different
vocabulary. Putting it in `packages/transport` is the fifth thing that clause is about.

So the constraints are not reconcilable by reading them more carefully. One of them bends.

## Decision

**The lane carrier lives in `packages/transport`, and ADR-0003's four-responsibility list
becomes five.** This record is the ADR its risk clause requires.

The fifth responsibility, stated in the same register as the other four: **the hub↔client
lane wire — its framing, and the server and client ends of it.**

Three things follow, and each is a constraint rather than a description:

1. **The carrier is Node-builtins-only, like everything else in the package.** A unix domain
   socket carrying newline-delimited JSON, the same framing shape as the daemon wire, for the
   same reason: it is the framing the repository already knows how to test.

2. **The lane wire has no digest handshake, and that is a difference, not an oversight.** The
   daemon wire refuses at connect on a schema digest mismatch, because both ends are
   generated from `protocol/schema.json`. The lane vocabulary is not generated — it is four
   frozen strings in `apps/hub/src/lanes/lanes.ts:29` whose *set* is asserted by test. The
   carrier's equivalent guarantee is that a frame naming an event outside that set is
   rejected at the boundary rather than delivered, which is asserted where the daemon wire
   asserts its digest: at the point the frame arrives.

3. **The widget may import the carrier and may not reach the daemon.** ADR-0041 is explicit
   that a client carries *"a microphone, a speaker, pixels and a socket — and nothing else"*.
   The cost of this decision is that the widget's import surface now also contains
   `connect()`, the daemon client. That is a real hazard and prose does not fix it: a source
   test asserts the widget calls neither `connect()` nor `defaultSocketPath()`.

## Consequences

**Good.** One implementation of each wire, both in the package that exists to be that. The
hazard lanes.ts named — a second wire growing in the hub where B5's regex cannot see it — is
not merely avoided, it is impossible without the diff moving a file into the hub, which is
visible in review. The widget's main process consumes a package built for exactly this
position: no SDK, no framework, no runtime validator.

**Cost, and it is the one ADR-0003 warned about.** `packages/transport` is now a package that
owns two wires, which is one step closer to the junk drawer its risk clause names. The
four-item list was a fence, and this record moves the fence rather than climbing it. The
mitigation is that the fence still exists at five and the same clause still applies: a sixth
responsibility requires another ADR, and "we already added a fifth" is not an argument for it.

**Cost, second.** B5's guarantee is now carried partly by a pin and partly by a test in the
widget's own suite. The pin says no socket implementation lives outside `packages/transport`;
it does not and cannot say that a package importing the transport for one wire declines to
use the other. That second half is a source test, and a source test in the consumer is weaker
than a pin over the tree — it protects one client, and the next client needs its own.

**Cost, third.** A reader of `packages/transport` now has to know which wire a given export
belongs to. The mitigation is file layout: the daemon wire and the lane wire are separate
modules with separate tests, and the package's index re-exports both rather than a single
module growing a second personality.

## Evidence

| Claim | Source |
|---|---|
| the carrier was named in prose before it was built | `apps/hub/src/lanes/lanes.ts:14-18` |
| B5's pin matches a `node:net` import, so a library-based socket in the hub is invisible to it | `tools/pins/b5.mjs:9` |
| the four-responsibility list is normative and a fifth requires an ADR | [ADR-0003:37](0003-one-shared-transport-package.md) |
| the lane vocabulary is four frozen strings asserted as a set | `apps/hub/src/lanes/lanes.ts:29` |
| clients are thin and carry nothing but a mic, a speaker, pixels and a socket | [ADR-0041](0041-agents-live-in-the-hub-clients-are-thin.md) |
| the daemon wire refuses at connect on a digest mismatch, which the lane wire has no equivalent of | `packages/transport/src/index.ts:188` |
