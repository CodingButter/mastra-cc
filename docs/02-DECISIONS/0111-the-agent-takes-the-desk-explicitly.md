# ADR-0111: The agent takes the desk, explicitly

Date: 2026-09-23
Status: Accepted as direction; implementation pending. **Supersedes in part [ADR-0044](0044-the-assistant-does-not-take-the-desk.md)** for effects. Launch focus restoration and the rule that an *unreported* focus move is a bug still stand. See [14-DIRECTION.md](../14-DIRECTION.md) §3.

## Context

ADR-0044 made cohabitation the goal: do every operation that can be done without taking focus that way, and give focus back when a launch takes it. Six weeks of building against it showed three things.

- **Users do not expect it.** Every competing product takes control of the desk for a desktop task ([competitive research](../audits/2026-09-23/COMPETITIVE-RESEARCH.md)). The Windows version of Codex is reportedly foreground-only.
- **It leaves a capability gap.** Wayland compositors refuse focus restoration (ADR-0044, Evidence). Typing into a covered window lands anyway, unannounced ([CC-01 live proof](../proofs/reliability-remediation/cc01/live/README.md)). The capture-freshness check cannot see a window newly covering an unchanged rectangle (same proof, final phase).
- **It costs consistency.** Whether an effect needed focus varied per toolkit and per route. So the agent could not predict what the desk would look like after acting.

## Decision

1. **Before an effect, the daemon brings the target to the front and confirms it.** Raising is its own step with its own receipt. The confirmation reads the foreground back rather than trusting the call's return value. If the raise fails, the effect is refused before input, as a `world` or `daemon` class ([ADR-0113](0113-every-refusal-says-whose-it-is.md)).
2. **Observation stays focus-free.** Queries, reads, captures and subscriptions never raise anything.
3. **Focus moving without a receipt is still a bug.** That part of ADR-0044 stands.
4. **Human takeover is the collision to design for.** When a person moves the pointer or types during a task, the task stops at its next boundary (ADR-0107) and the refusal names the takeover as `world`.

## Consequences

- Good: one predictable contract. Covered-window and pixel actions become safe, because the captured element is on top when it is pressed.
- Cost: the agent now visibly takes the user's desk. A user working alongside it will be interrupted. We accept that as what users expect, and make takeover detection the protection instead.
- Cost: ADR-0044's launch-restoration machinery is kept, but it matters less. It is no longer the headline behaviour.
- Open: Wayland raising has the same compositor limits as restoring. There, a failed raise must be refused rather than assumed.

## Evidence

- ADR-0044, Evidence table (Wayland restoration claims success and moves nothing).
- `docs/proofs/reliability-remediation/cc01/live/README.md` (covered typing landed; same-rectangle occlusion undetected).
- `docs/audits/2026-09-23/COMPETITIVE-RESEARCH.md` (competitor foreground behaviour; vendor-reported).
