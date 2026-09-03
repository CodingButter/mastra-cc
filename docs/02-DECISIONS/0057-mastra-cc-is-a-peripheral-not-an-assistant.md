# ADR-0057 — Mastra CC is a peripheral, not an assistant

**Status:** accepted
**Date:** 2026-08-28
**Retires the client surface. Supersedes the product framing of [ADR-0006](0006-hub-holds-no-audio.md), [ADR-0011](0011-dashboard-is-vite-with-playground-ui.md), and [ADR-0053](0053-phrase-wake-gates-a-client-owned-voice-session.md) as *product*; their engineering findings stand as history.**

## Context

The repository was organised around one sentence — *"tell me my most recent email"* — and everything downstream of it: a hub that thought, a widget that listened and spoke, a dashboard that watched, and a voice package that held the microphone. That framing built a real thing, and the hard part it proved was never the assistant. It was the daemon: a semantic model of a live desktop, capability-scoped authority, content observation with protected-control redaction, attribution, receipts, and subtree-scoped change subscriptions.

The client surface was, in the end, a demo harness wearing product clothes. It also drove the shape of the gates: four of the twelve pins asserted facts about clients, the frozen north-star contract encoded one voice scenario in 34 rows, and a third of the mutation manifest defended files that only existed to make the demo speak.

Meanwhile the interesting product is downstream of the daemon and upstream of any user interface: an agent runtime — Mastra — that thinks, and a machine that can be truthfully asked what is on it and told to act. That composition does not need a face.

## Decision

**Mastra CC is a peripheral.** It ships two artifacts and no user interface:

1. **The daemon** — the only process that touches the desktop, portable across VM, container and hardware, and eventually across operating systems. It owns desktop truth: what exists right now, what is actionable, what changed and when, which application something belongs to, and the receipt for every effect.
2. **An installable package** — a dependency an agent runtime consumes, which knows how to use the daemon's operations and get work done with them.

The dividing line with Mastra core: **if it is about thinking, it is Mastra's; if it is about the desk, it is ours.** Agentic loop, model routing, memory, retrieval, skills-as-a-concept and workflows belong to Mastra. Application identity, live element state, actionability, change attribution and audit belong here.

The two artifacts version separately. The daemon is engineering — it is testable and it is done per release. The package is judgment, and judgment drifts with every model that consumes it; a shared version number would force one to lie about the other.

Consequently `apps/hub`, `apps/widget`, `apps/dashboard` and `packages/voice` are removed, along with the gates that only described them: pins B2, B3, B4 and B9, the window-placement proof, the frozen north-star contract and its checker. A voice assistant remains possible as a *later composition over this runtime* — built by someone else, or by us, on top of an interface that no longer assumes it.

## Consequences

- The north star sentence is no longer the acceptance test. Acceptance is now stated per capability against a live desktop, in the terms the daemon already uses: observe, act, attribute, subscribe, refuse.
- **The lane wire goes with the face.** [ADR-0052](0052-the-lane-carrier-is-transports-second-wire.md) built transport's second wire to carry `progress` and `answer` prose *to a person looking at a client*, plus the voice edges and the dial. With no client there is no consumer: an agent runtime streams its own progress through its own machinery, not through our socket. Removing it is honest; keeping a four-word vocabulary alive for a reader who no longer exists is how a codebase accumulates ghosts. The daemon wire — digest-handshaked, generated from `protocol/schema.json` — is untouched and is the only wire that ships.
- Five pins survive (B1, B5, B8, B10, B11) and the mutation manifest drops to 94. Nothing that guards the daemon was weakened; what was removed had no subject left to guard.
- The historical record stays on disk. Roadmap milestones M3 through M6 are marked retired rather than deleted, because the reasoning that produced them is the reason we know the daemon is the product.

## Evidence

- Amputation commit on `refactor/strip-client-surface`, branched from `52a7cfb`.
- `node tools/pins/run.mjs` — five wired pins green with no vacuous subject.
- `tools/mutations.json` — 94 mutations, none referencing a removed package.
