# 0061 — A signal provider carries pointers, drops the agent's own edits, and serves one thread

**Status:** accepted — 2026-08-31

## Context

The daemon has been able to push change events since the semantic-observation work. `subscribeElement`
takes a priority, the daemon emits content-free `ChangeEvent` pointers, and the transport surfaces
them through `onChangeEvent(listener)` (`packages/transport/src/index.ts:104`). But a listener on a
client object is outside the agent loop. An agent could subscribe and then never hear about it — the
priority argument existed with nothing downstream to act on it.

`@mastra/core` has the receiving end: `SignalProvider`, and a delivery policy that reads priority.
`MastraCC.getSignalProvider({ threadId, resourceId })` returns a `DesktopSignals` bound to the same
connection as `getTools()` (ADR-0060). This records the four judgements inside it, each of which is a
place where the obvious choice is wrong.

## Decision

**1. Push only. The provider never polls and exposes no endpoint.** `pollInterval` stays undefined,
`poll` and `handleWebhook` are not implemented (`packages/desktop/src/signals.ts`). If the socket is
open the events arrive; a timer would be a second, worse source of truth.

**2. A notification carries pointers, never content.** The `summary` is a fixed format —
`desktop ${kind}: ${role} ${id} (watch ${subscriptionId})` — asserted by test so nobody improvises
element text into it under deadline. The daemon emits content-free events deliberately (ADR-0056);
enriching one by reading the element back would smuggle content into a path designed not to carry it,
and would do it in the one place a human is most likely to read it.

**3. Only `external` attribution is delivered, by default.** A `self` event is the agent's own edit
echoing back: delivering it wakes the agent to tell it what it just did, which at best burns a run and
at worst loops. `unattributed` is the subtler one — the daemon emits it precisely when it *cannot*
decide, so it may also be the agent's own edit. Both are opt-in, expressed once as a default and
guarded by a mutation.

**4. Priority passes through untouched.** Daemon `low | medium | high` is a literal subset of Mastra's
four. No translation table, no invented `urgent`. The subscriber chose the priority; the delivery
policy is Mastra's business — with one consequence a subscriber must know: on an idle thread, `low`
does **not** wake. It is recorded as `pending` with reason `idle-low-summary`; only `medium` and
above start a run. A watch subscribed at `low` will therefore look wired and never wake anything,
which is Mastra's policy working as designed and our job to say out loud.

**5. One wake per `(subscriptionId, elementId, kind)` per window.** This is a throttle, not judgement:
it deliberately suppresses *distinct* changes inside the window, because nothing here can know which
repeats are logically the same. `dedupeKey` and `coalesceKey` are set for the same reason.

## Consequences

**Notifications persist.** `transient` exists on `AgentSignalInput`, not on the
`SendNotificationSignalInput` this path uses (`@mastra/core@1.63.2`
`dist/notifications/types.d.ts:60-71`). Every delivered change is a stored `NotificationRecord`.
Dedupe and coalesce keys collapse a stream, but a chatty desk still accumulates rows. Measured rate on
a real desk, over a window mixing typing bursts with the pauses between them: **0.57 events/second** (`docs/proofs/the-desk-wakes-the-agent.md`),
low enough that the window suppresses little in practice — it is a floor against a pathological
element, not a rate limiter.

**One provider serves one thread.** The target is fixed at construction, because
`SignalProviderTarget` requires both `threadId` and `resourceId` and nothing in a `ChangeEvent` says
which thread subscribed. Serving many threads means learning which thread called `subscribeElement`,
which means intercepting a tool call. Deferred, and recorded here rather than implied away.

**The provider must be passed to a live `Agent` constructor.** `notify()` throws otherwise. There is
no registry path and no stored-agent path, so an editor-configured agent cannot carry one. That is
upstream's constraint at 1.63.2, documented rather than worked around.

**The surface is experimental.** Mastra's signals API may drift. The peer range is `>=1.63.0 <2` and
only the ends are tested.

**Dropping `unattributed` by default will lose real events.** Some genuinely external changes arrive
unattributed. That is the accepted cost of never waking an agent with its own echo; the flag exists
for anyone who would rather have the noise.

## Evidence

- Implementation: `packages/desktop/src/signals.ts`; exposed by `MastraCC.getSignalProvider()` in
  `packages/desktop/src/mastra.ts`.
- Tests: `packages/desktop/src/__tests__/the-desk-speaks-first.test.ts` — delivery to a connected
  agent, priority at the notification boundary, `external` delivered while `self` and `unattributed`
  are not, burst-inside-window waking once and outside-window waking twice, the fixed summary format,
  `stop()` silencing delivery without closing the dial, and the anti-polling assertions.
- Mutations: the attribution default, the throttle guard, the priority passthrough, the pointer-only
  summary, listener attachment and listener cleanup — each confirmed red when planted
  (`tools/mutations.json`).
- Live proof: `docs/proofs/the-desk-wakes-the-agent.md` — tarball install, external edit typed at the desk,
  wake, zero frames from the agent process and zero requests in the daemon's audit log between
  subscribe and wake; base-red at `e9e193f`.
- Wake path receipts and the minimum agent configuration a wake requires:
  `.mastracode/plans/the-desktop-wakes-the-agent.progress.md`.
