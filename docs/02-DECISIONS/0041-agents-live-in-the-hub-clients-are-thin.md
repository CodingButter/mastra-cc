# 0041 — Agents live in the hub; clients are thin faces

Status: accepted, 2026-08-16 (pre-M3)

## Context

M3 puts an agent behind the daemon for the first time, which forces a question
the skeleton had answered only in outline: **where does an agent run?**

[01-ARCHITECTURE.md](../01-ARCHITECTURE.md) §2 already says "Clients hold no
authority. A client asks; the hub decides; the daemon acts." What it does not
say is whether the *conversational* agent is an exception. The product has two
agent-shaped roles — an **orb** that talks to the person, and an
**orchestrator** that gets work done — and the orb is the one a user feels. The
argument for putting the orb in the client is latency: a conversation that
pauses does not feel like a conversation.

That argument was raised, examined, and rejected on the numbers. Three findings
decided it.

**One — the hop is not the latency.** A client-to-hub turn crosses a unix
socket on the same machine or a WebSocket over the tailnet: sub-millisecond
locally, single-digit milliseconds remote. The model call it wraps costs
hundreds of milliseconds to seconds. Moving the agent to the client buys a
fraction of a percent of perceived latency.

**Two — a client-resident agent drags the credentials outward.** An agent is a
thing that calls a model, so an agent on a device needs that device to hold a
provider key. Boundary **B3** exists to forbid exactly this: *clients hold no
provider credential; they receive minted tokens only*.
[ADR-0007](0007-identity-is-derived-credentials-are-minted.md) records the ruling in
the words it was given in — *"Never give the key to the agent or they'll try it
on every door."* The same applies to the database: an orb with a persistent
thread needs the memory store, and a client-resident orb would put the key to
the whole memory store on a phone.

**Three — there are three faces, and a client-resident orb would fork the
conversation.** The tray widget, the phone page and the dashboard are three
clients. Three client-resident orbs are three threads and three memories: walk
from the desk to the couch mid-sentence and you are talking to a different mind.
One hub-resident orb makes all three faces windows onto one conversation, one
thread, one memory.

## Decision

**Every agent runs in the hub. A client carries a microphone, a speaker, pixels
and a socket — and nothing else.**

Three parts, each independently testable:

**1. Residency.** The orb and the orchestrator are both hub-resident agents.
Each has its own thread and its own memory; they exchange signals with each
other. Neither is reachable from a client except through the lanes (§4) and the
hub's own request surface. A client never holds an agent, a provider
credential, a database credential, or a daemon connection.

The orb keeps everything residency was suspected of costing it: a persistent
thread, observational memory, and direct access to the memory store — because
it is *in* the hub, which is the one place those things are allowed to live.

**2. The transport seam.** The hub reaches the daemon through
`packages/transport` and through nothing else
([ADR-0003](0003-one-shared-transport-package.md)). When the hub needs a
capability the transport does not yet have — M3 will need at least a
subscription feeding the lanes and a call site that writes an audit entry — the
change **lands inside the transport package**. It is never written beside it.

This is a rule with a test, not a discipline, because the prototype proves
discipline is not enough: its hub grew a second client that located the socket
by scanning filenames and skipped the schema digest check, and it ran in
production until PR #227 laid the two implementations side by side. The drift
was not ideological. Someone needed one small thing the shared client did not
do, and five local lines were faster than changing a shared package. **That
exact pressure arrives in M3.**

**3. Latency is measured, never assumed.** If the conversation feels slow, the
first move is to measure where the time goes, not to relocate an agent. Dead
air between the person finishing a sentence and the orb making a sound is an
edge-side problem with edge-side answers — acknowledge locally, stream from the
first token rather than the completed turn, play back-channel sound on the
device. None of those require an agent on the device. Family 6 of
[03-LESSONS.md](../03-LESSONS.md) is the reason this clause exists: the
prototype raised a wake threshold from 18 to 20 while live scores sat at
21.3, tuning a constant to hide an upstream inconsistency.

## Consequences

**Good.** One conversation across every face. Credentials and the memory store
stay behind one boundary, so B3 stays enforceable rather than aspirational. The
clients get small enough to be genuinely replaceable — a new face is a socket
and a renderer.

**Cost — a real one.** Every conversational turn now crosses a process
boundary, so the hub is on the critical path of something a human is waiting
for. A hub restart interrupts a live conversation in a way a client-resident
agent would not, and offline-from-the-hub means no conversation at all. We
accept this: the alternative buys back a fraction of a percent of latency and
pays for it with the provider key on every device.

**Cost.** B5's current pin greps for a `node:net` import outside
`packages/transport` (`tools/pins/b5.mjs`). That proves no *second socket
implementation* exists — and it would **not** have caught the prototype's bug,
because the drifted hub client *was* a socket client, just a divergent one.
The pin is necessary and not sufficient, and saying otherwise would be the
vacuous-pass shape this repository fears most. What actually defends the seam
is that digest verification is unconditional inside the transport at connect
(`packages/transport/src/index.ts:147-153`) with no constructor flag to disable
it, plus the CI digest-agreement step. B5 is the third lock, not the first.

**Deferred.** The vocabulary of the orb↔orchestrator signals — what an
orchestrator is allowed to say and when the orb chooses to relay it — is not
decided here. This record fixes *where* the agents live, not *what they say*.

## Evidence

| Claim | Source |
|---|---|
| clients hold no authority; hub decides, daemon acts | `docs/01-ARCHITECTURE.md` §2 |
| B3 — clients hold no provider credential, minted tokens only | `docs/01-ARCHITECTURE.md` §5 |
| "never give the key to the agent or they'll try it on every door" | [ADR-0007](0007-identity-is-derived-credentials-are-minted.md) |
| the hub is the only place secrets live | `docs/01-ARCHITECTURE.md` §2, [ADR-0007](0007-identity-is-derived-credentials-are-minted.md) |
| the prototype's hub grew a second daemon client | PR #227 description and diff, via [ADR-0003](0003-one-shared-transport-package.md) |
| that client found the socket by filename and skipped the digest | PR #227 description, via [ADR-0003](0003-one-shared-transport-package.md) |
| digest verification is unconditional and unparameterised | `packages/transport/src/index.ts:147-153`; [ADR-0003](0003-one-shared-transport-package.md) decision clause 3 |
| B5 pins the absence of a second socket implementation only | `tools/pins/b5.mjs` |
| the hub already depends on transport and nothing else | `apps/hub/package.json` — one dependency, `@mastra-cc/transport` |
| tuning a constant to hide an upstream inconsistency | `docs/03-LESSONS.md` family 6 |
| three clients: tray widget, phone page, dashboard | `docs/01-ARCHITECTURE.md` §2 |
