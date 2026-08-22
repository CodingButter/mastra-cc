# ADR-0046 — Raw input is the most restricted class, not a banned one

**Status:** accepted
**Date:** 2026-08-17
**Amends:** [ADR-0004](0004-semantic-first-pixels-last.md). The semantic-first bet stands unchanged. One clause — the outright ban on raw input synthesis — is replaced by an operation class that is off by default and reachable only through the user.

## Context

[ADR-0004](0004-semantic-first-pixels-last.md) chose the accessibility tree over pixels and over raw input, and banned raw input outright, enforced by boundary test B8 (`tools/pins/b8.mjs`) grepping `xdotool`, `wmctrl` and `uinput` across `daemon`, `packages`, `apps`, `tools`, `scripts` and `infra`. The reason it gives is worth quoting, because it is the thing this record has to preserve:

> "Under deadline pressure, 'just screenshot it' is always the shortest path. B8 and the addressed-capture rule exist so that taking it requires deleting a test, which is a visible act." — `0004:45`

That reasoning was correct and remains correct. The ban existed to make the shortcut expensive.

Two things have changed since it was written.

**First, the enforcement machinery now exists.** When ADR-0004 was written, the alternative to a ban was an agent that could quietly reach for pixels the moment the tree became inconvenient. That is no longer the system. Effect-class operations are refused *before the call* under a pinned test (B11). Refusals name the check that produced them and what would change the answer ([ADR-0008](0008-scopes-operation-classes-and-honest-refusals.md)). Capabilities are configured by the user and hard-enforced by the daemon, and no agent decides what it is capable of ([ADR-0043](0043-an-element-publishes-its-own-actions.md)). There is a chain that escalates a blocked action to the person ([ADR-0041](0041-agents-live-in-the-hub-clients-are-thin.md)).

**Second, we already decided that a permanently absent capability is a lie.** [ADR-0042](0042-existence-is-readable-content-is-not.md) removed application invisibility on exactly this ground: an agent that cannot see OBS tells the user to install what they already have, and an assistant that wastes your time is an assistant slowing you down. A capability that cannot exist under any configuration produces the same false belief one level down. The agent concludes the task is impossible, when the truth is that it is possible and switched off. The honest form is the one ADR-0042 settled on: *I could do that, if you let me.*

The user's framing, which this record adopts: the goal is **true cohabitation** — as much as possible accomplished without taking the mouse, the keyboard or the focus away from the person using the machine. Raw input is not a convenience. It is the thing you reach for when a badly-behaved application leaves no other route, and its correct use is rare, deliberate, and announced.

Two adjacent asks turned out to need no change at all, and are recorded here so the boundary is not re-litigated:

- **Screenshots were never banned.** `0004:35` already permits capture *of a named window or element resolved through the tree*, and forbids only the full-desktop grab handed to a model to search. "Screenshot this window and send it to someone" is a legitimate deliverable and always was.
- **Never sending pixels for something that does not need pixels** is the title of ADR-0004, not a new constraint.

## Decision

**Raw input synthesis becomes an operation class — the most restricted one — instead of a ban. It is off by default, never self-granted, never a fallback, always attributed, and reachable only by a decision the user makes.**

1. **It is an operation class, subject to the same machinery as every other.** It sits in the B11-pinned dispatch table with `enforcement: "before-call"`. It is not a special path around the gate; it is the gate's most restricted entry.

2. **Off by default, and the agent cannot turn it on.** Enabling it is a user configuration act, per [ADR-0043](0043-an-element-publishes-its-own-actions.md): the user configures capabilities and the daemon hard-enforces them. An agent that could grant itself raw input has the key to every door.

3. **Never a fallback.** The daemon does not retry a failed semantic operation as raw input, and no code path degrades from one to the other. A semantic failure produces a refusal that names its check. This is the clause that preserves ADR-0004's real purpose: the shortcut does not become the quiet default, because the shortcut is not reachable from the failure.

4. **The agent's only move is to ask.** When the semantic route is exhausted, the agent escalates a request naming what it tried, what it would send, and why. That travels the chain to the person — worker to orchestrator to orb to user. The person decides. The daemon obeys the resulting configuration, not the request.

5. **Adversarial review advises; it never enforces.** A justification may be reviewed by a model before it reaches the user, and that review is a recommendation attached to the request. It is not a gate. [ADR-0031](0031-the-agent-emits-a-plan-a-model-free-interpreter-runs-it.md) keeps model calls out of the execution path, and a gate that reasons is a gate that can be argued around. Advice from a model, permission from a human, enforcement in code — three separate things, and the daemon obeys only the last two.

6. **Always attributed as raw input.** The audit log records it as its own class, distinct from a semantic effect ([ADR-0026](0026-the-audit-log-is-an-access-record-episodes-are-the-narrative.md)). The record never launders a synthesised keystroke as an element interaction. The change stream must not report a synthesised effect as `self` in a way indistinguishable from a semantic one, because the "a human at the keyboard outranks the agent" rule rests on attribution staying truthful ([ADR-0004](0004-semantic-first-pixels-last.md):19).

7. **Cohabitation is the default and the measured goal.** Every operation that can be done without taking focus is done without taking focus ([ADR-0044](0044-the-assistant-does-not-take-the-desk.md)). Raw input takes the desk by definition — that is precisely why it is the most restricted class and why its use is announced rather than silent.

8. **B8 changes shape rather than disappearing.** The pin stops asserting that the tool names appear nowhere and starts asserting that they appear *only* inside the raw-input class implementation, and that no other module references them. A grep-for-absence becomes a grep-for-containment. The visible act ADR-0004 wanted is preserved: widening the blast radius is a diff against the pin.

9. **This lands after the semantic route is proven, not alongside it.** Implementation is scheduled as its own milestone, after M2.6 closes. Building the escape hatch and the proper route in the same milestone means the escape hatch wins under pressure, which is the failure ADR-0004 anticipated.

## Consequences

**Good.** The assistant can state its limits accurately. "This application does not expose a usable control; I can do it with the keyboard if you allow it, here is exactly what I would send" is a true sentence that the current system cannot say. It replaces a silent failure with a decision the user gets to make.

**Good.** The capability set stops having a hole in it, which matters for the ordering decision this project is built on: the daemon's capabilities are finished and enforced before the hub is built. A ban that agents routinely need to work around is an unfinished capability set wearing a rule.

**Cost — and it is the real one.** ADR-0004's ban made the shortcut expensive by making it a visible act. Replacing the ban with a class makes the shortcut *possible*, and possibility erodes under deadline pressure in exactly the way that record predicted. The containment pin, the no-fallback clause and the user-only grant are what stand in for the ban's deterrent, and they are weaker than a ban. This is accepted deliberately, with the failure mode named: if a future milestone finds itself reaching for raw input routinely, the semantic route has a gap and the correct response is to fix the gap, not to widen the grant.

**Cost.** A capability that exists can be socially engineered toward. An agent that can ask for the keyboard will sometimes ask for the keyboard when it should have tried harder. The escalation is deliberately expensive — it costs the user's attention — which is a weak but real brake.

**Cost.** Attribution gets harder rather than easier. A synthesised keystroke and a human keystroke are close to indistinguishable at the point of effect, which is the entire reason ADR-0004 preferred semantics. The daemon knows it synthesised the input and must say so, but the fidelity of that record depends on the daemon's own bookkeeping rather than on a property of the interface.

**Risk.** The no-fallback rule is the load-bearing clause and the easiest one to erode with a well-intentioned convenience. It needs a test that fails when a semantic refusal path can reach the raw-input class, not a paragraph.

**Risk.** Screenshot capture stays addressed under `0004:35`, but a raw-input class adjacent to a capture capability is the shape of a general "just look and click" fallback. Nothing here loosens capture; the implementing milestone must keep the addressed-capture rule intact and pinned.

## Evidence

| Claim | Source |
|---|---|
| raw input banned outright, enforced by grep across six directories | `tools/pins/b8.mjs` as it stood when this record was written; decision 8 above reshaped it to containment on 2026-08-21, and its contained set is empty until the class exists |
| the ban's stated purpose was making the shortcut a visible act | `0004:45` |
| screenshots were always permitted when addressed to a resolved window or element | `0004:35` |
| attribution is what the human-outranks-agent rule rests on | `0004:21` |
| effect-class operations are enforced before the call under a pin | boundary test B11, `tools/pins/b11.mjs`, `daemon/src/server.ts` dispatch table |
| refusals name the check that ran and what would change the answer | [ADR-0008](0008-scopes-operation-classes-and-honest-refusals.md) |
| a hidden capability manufactures a false belief | [ADR-0042](0042-existence-is-readable-content-is-not.md) |
| the user configures capabilities; the daemon hard-enforces; no agent decides its own | [ADR-0043](0043-an-element-publishes-its-own-actions.md) |
| no model call sits in the execution path | [ADR-0031](0031-the-agent-emits-a-plan-a-model-free-interpreter-runs-it.md) |
| the audit log is an access record with its own vocabulary | [ADR-0026](0026-the-audit-log-is-an-access-record-episodes-are-the-narrative.md) |
| focus moving as a side effect is a bug | [ADR-0044](0044-the-assistant-does-not-take-the-desk.md) |
| escalation reaches the user through the orb | [ADR-0041](0041-agents-live-in-the-hub-clients-are-thin.md) |
