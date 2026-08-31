# ADR-0060 — An agent id selects a connection, because the cause id comes back on the event and not on the call

**Status:** accepted
**Date:** 2026-08-31
**Constrains how the package of [ADR-0059](0059-the-package-ships-primitives-and-instructions-not-macros.md) is handed to more than one agent. Preserves the attribution contract of [ADR-0039](0039-the-desktop-talks-first.md) without moving the schema of [ADR-0058](0058-the-daemon-serves-one-protocol-through-two-front-doors.md).**

## Context

The package is installed by a runtime, and a runtime may have several agents. The question
that decides its surface is not whether several agents *should* share one desktop — it is
what happens when they do, because nothing prevents it. The daemon accepts connections. An
API designed for exactly one agent does not refuse the second one; it serves it, and lies
about who did what.

That lie has a specific shape, and it is the reason for this record.

### What the desktop actually permits

Two agents acting at the same moment on one desktop is not parallelism. There is one
keyboard focus, one pointer, one modal stack, and — at the daemon — one open verb at a time:
`inFlight` is module scope, one per process (`daemon/src/server.ts:487`). Concurrent action
is already serialised, and the honest description of the domain is **many observers, one
actor**: a supervisor that subscribes and never touches, an ambient agent holding
subscriptions across sessions while task agents come and go. Those coexist well. Two agents
typing into the same document do not, and no API shape fixes that.

So the design does not need to make concurrent action safe. It needs to make concurrent
*identity* honest.

### Where attribution is decided

The daemon mints a cause id per verb and stamps it on a change it decides was self-caused
(`daemon/src/server.ts:489-512`). The schema is explicit about where that id travels:

> `causeId` — "Names the call this change was caused by. Present if and only if the
> attribution is self; its absence anywhere else is the contract, not an omission."
> (`protocol/schema.json:390-394`)

It rides the **event**. It does not ride the **response** to the call that caused it.

That single fact settles the design. If two agents share one dial, a self-attributed event
arrives carrying a cause id the client cannot map back to either agent's call. The client
could infer it from ordering — verbs serialise, so only one was open — except that events
arrive after the call has returned, which is a documented rough edge, not an anomaly. The
inference would be a guess, and [ADR-0039](0039-the-desktop-talks-first.md)
exists precisely so that this system does not guess about causation.

## Decision

**An agent's identity binds to a connection. The instance _is_ the connection, so there is no
id at all.**

The package is held as an instance addressed once with connection details. Both agent-facing
surfaces come from that instance and share its single dial:

```ts
const desk = new MastraCC({ url: "ws://desk:9977" });
new Agent({
  tools: desk.getTools(),                              // ─┐  one instance →
  signals: [desk.getSignalProvider({ threadId, resourceId })], // ─┘  one connection
});
```

Every `self` event arriving on that dial belongs to exactly one agent, by construction rather
than by inference. That is the whole job, and it is what keeps attribution true. Two agents
means two instances, means two sockets — the property this record wanted, reached by having
no id rather than by routing one.

The cost is one connection per agent. That cost is accepted.

> **Amended 2026-08-31 (signals).** As first written, this decision expressed the binding as an
> id parameter — `getTools("researcher")` resolving to a dial — and claimed the id did a second
> job: *tagging tool results*. Both are struck.
>
> The tagging job was never real. A toolset obtained from an instance is that instance's by
> construction; there is nothing left to tag. And once the identity is the object the caller is
> holding, the id is an indirection with no destination — a lookup key for a map that only ever
> has one entry. Mastra reaches the same shape independently: a provider's connected agent is a
> single field set by one `Agent` constructor, so a provider is 1:1 with an agent whether or not
> we name it.
>
> **Everything above this note still holds.** The `causeId` argument is untouched, and it is
> the entire reason one connection per agent is required at all. Only the surface changed.

Rejected: **carrying the agent id on the wire** so one connection can serve many agents.
It is the better end state and it is not available now — the daemon would have to attribute
per-agent rather than per-connection, which changes `protocol/schema.json` and so moves the
schema digest every artefact agrees on. That is a deliberate protocol release, not a detail smuggled in underneath a
package feature.

Rejected: **a single implicit connection with client-side agent tracking.** This is the shape
that produces the lie. It compiles, it demos, and it reports another agent's edit to the
first agent as `self`.

## Consequences

- Attribution requires no daemon change and no schema change. The daemon's per-connection
  answer at `daemon/src/server.ts:512` is already correct; the package simply stops asking it
  a question it cannot answer.
- N agents cost N sockets — N instances. For the populations this is built for — one actor and
  a small number of watchers — N is small. If it stops being small, that is the trigger to revisit,
  not a reason to pre-optimise now.
- The upgrade is one field, not a redesign: put `causeId` on the call's response, and one
  connection can carry many agents honestly. Consumer code does not change — the instance
  stops opening a socket per id. Recording that here means the future change arrives as a
  scheduled protocol move with a digest bump, which is the only way it is allowed to arrive.
  (After the amendment the consumer change is smaller still: instances stop opening a socket
  each. The surface does not move.)
- **Signal routing falls out for free, and does not need building.** A subscription book
  belongs to the socket — created when the connection is accepted, emptied when it closes, and
  no watch outliving the client that asked for it (`daemon/src/server.ts:535-539`). So once an
  id picks a connection, an agent's watches live on that agent's dial and its events arrive
  there and nowhere else. Delivering a change only to the agent that subscribed requires no
  filtering, no fan-out table and no routing code: it is a property of the connection, which is
  the strongest form the guarantee can take.
- **This settles _agent_ identity and says nothing about _thread_ identity, which is a
  separate gap.** Mastra's `notify(notification, target)` needs a `SignalProviderTarget`
  carrying both a `threadId` and a `resourceId`, and neither is recoverable from a connection.
  So the thread is supplied explicitly — `getSignalProvider({ threadId, resourceId })` — and is
  fixed for that provider's life. One provider serves one thread. Learning the thread instead
  of being told it means learning which thread called `subscribeElement`, which means
  intercepting a tool call; that is deferred, and is recorded here so this record is not read
  as settling more than it does.

## Evidence

| Claim | Receipt |
|---|---|
| One verb is open per daemon process, so concurrent action is already serialised | `daemon/src/server.ts:487` — `inFlight` is module scope, not per connection |
| A cause id is minted per verb and stamped only on a self attribution | `daemon/src/server.ts:489-512` |
| The cause id travels on the change event and never on the call's response | `protocol/schema.json:390-394` — "Present if and only if the attribution is self" |
| Attribution is decided per connection today | `daemon/src/server.ts:512` returns `self` for the connection whose verb is open |
| Events can arrive after the causing call has returned, so ordering cannot be used to recover the caller | [docs/11-AGENT-INSTRUCTIONS.md](../11-AGENT-INSTRUCTIONS.md) — a returned call is not proof the desktop changed |
| A subscription belongs to the connection that opened it and dies with it | `daemon/src/server.ts:535-539` — "The book belongs to the socket" |
| The package this constrains exists and is merged | PR #70, merge commit `e9e193f` |
