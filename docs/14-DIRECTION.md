# 14 — Direction, September 2026

Status: accepted, 2026-09-23. Written after the [project audit](audits/2026-09-23/PROJECT-AUDIT.md) and the [competitive research](audits/2026-09-23/COMPETITIVE-RESEARCH.md). Where this document and an older one disagree, this one records the newer decision, and the ADRs it names carry the formal change.

## The position

Mastra CC aims to be **the most dependable desktop-control harness for any model the user chooses**, and the one that gets better the more it is used.

We do not expect to beat Anthropic or OpenAI everywhere. They train their models against their own harnesses and layer classifiers on top. What they do not offer is a harness that is provider-neutral, tells the truth about what happened, lets an agent subscribe to the desktop instead of re-photographing it, and feeds verified outcomes into a system that learns. That seat is open.

This is a belief until it is measured. The first deliverable of this direction is the benchmark that measures it (§6).

## Five commitments

### 1. Semantic first, pixels as a real option

The accessibility tree stays the primary way to see and act. It is faster per turn, it knows a disabled button from an enabled one, and it can attribute change. But refusing pixels caps the success rate on anything a toolkit draws without describing (canvases, games, remote sessions, broken accessibility). Every serious competitor ended up hybrid.

So pixels become an option the **agent** may choose, inside an application it is already granted. They are no longer only a last resort gated behind operator authority. The constraint that remains is what keeps pixels honest: **every pixel action is anchored to an element and a capture.** → [ADR-0112](02-DECISIONS/0112-pixels-are-aimed-in-the-picture-the-agent-was-shown.md)

### 2. Pixels are aimed in UV space, and the daemon converts

The agent never sends screen coordinates. It says "click at (u, v) in the picture you gave me", with `u` and `v` in the range [0, 1] relative to the captured image, together with the capture's `capturedAt`. The daemon owns the conversion, because only the daemon knows where the element is now, how the capture was clipped (ADR-0105) and what the display scale is. The daemon:

- refuses if the capture is stale or superseded (the existing freshness check, ADR-0105),
- refuses if the point falls outside [0, 1], is not finite, or lands outside the visible pixels, and never clamps silently,
- records both the UV the agent sent and the device point it pressed in the receipt.

This makes the display-scaling defect ([CC-07 scaling proof](proofs/reliability-remediation/cc07/scaling/README.md)) a prerequisite. The conversion is only as honest as the scale it knows.

### 3. The agent takes the desk, explicitly

We tried to do as much as possible without taking focus ([ADR-0044](02-DECISIONS/0044-the-assistant-does-not-take-the-desk.md)). Users do not expect that. They give an agent a desktop task and expect it to take control, and the foreground-free route leaves a capability gap (covered windows, compositors that refuse focus, the same-rectangle occlusion race the freshness check cannot see). Consistency beats a feature nobody expects. → [ADR-0111](02-DECISIONS/0111-the-agent-takes-the-desk-explicitly.md)

- Before an effect, the daemon raises the target and confirms it is actually in front. Raising is a receipted step, not a side effect.
- Observation never needs the foreground. Reading, capturing and subscribing stay focus-free.
- Human takeover becomes the collision that matters. Detecting the person reaching for the mouse or keyboard mid-task, and stopping cleanly, moves up the queue.

### 4. Every error says whose it is

A learning agent that cannot tell its own mistake from ours learns superstition: it records "avoid this button" when our backend timed out. Every refusal and every failed outcome carries a responsibility class. → [ADR-0113](02-DECISIONS/0113-every-refusal-says-whose-it-is.md)

| Class | Meaning | Who learns from it |
|---|---|---|
| `agent` | The agent misunderstood the desktop: wrong element, disabled control, point outside the picture | skills and knowledge |
| `world` | The desktop changed underneath: element moved, capture stale, dialog appeared, human took over | re-observe and reason again |
| `daemon` | We failed to do what we advertised | nobody. It is our defect, and we count it toward zero |

The goal is that the daemon spends its time reporting the agent's misunderstandings, not its own shortcomings. Two consequences follow. Capabilities must be honest per application, so the agent is never set up to fail. And a log that lies (a write that reads back but the application never accepted, audit C1) is the worst defect class we have.

### 5. The daemon tells the truth; Mastra does the learning

Learning, skills, workflows, reminders and knowledge live in the Mastra layer. That means the consumer package, and above it Mastra's memory, the subconscious learning agent and the curator, which revises knowledge as it becomes wrong. The daemon stays a peripheral whose one contribution to learning is **receipts detailed and true enough to learn from**.

- Skills are learned from verified receipt chains (readback matched, effect receipted), never from content the agent read. Content from pages and documents is untrusted data, not instruction (audit H3).
- Staleness of learned skills is the curator's job, not the daemon's.
- Token efficiency is part of the product. Load skills only when their application is in view, and prefer subscriptions and element-scoped captures to whole-screen screenshots.

## What stays exactly as it was

- The daemon is the only process that touches the desktop.
- Grants are deny-by-default. Refusals explain themselves from a check that actually ran.
- Subscriptions are the speed feature. Closed-loop beats open-loop.
- Raw, un-anchored input (screen coordinates, free-form key strings) stays the most restricted class ([ADR-0046](02-DECISIONS/0046-raw-input-is-the-most-restricted-class-not-a-banned-one.md)). Only element-anchored UV pointer actions move to the agent-choosable tier.

## 6. Next actions, in order

The order is chosen so that the numbers can argue for the direction before most of it is built, and so that nothing learns from a lying log.

1. **Daemon faults that corrupt or freeze truth** (audit Critical). These come first because everything downstream learns from them.
   - C2 UTF-8 split across chunks, plus M1 unbounded line length (transport and daemon framing).
   - C3 CDP liveness: per-call deadline and `Page.javascriptDialogOpening` handling, so one alert cannot freeze every client.
   - C1 web writes that read back without reaching application state. Use the native value setter, and refuse, as a `daemon` class, when application state is not proven.
   - M3 the README claim that typing is read-back verified. The code is right, so the text changes.
2. **M4 protocol generation in the task graph.** This is the root cause of the repeated stale-artifact incidents, and it gets cheaper to fix the earlier it lands.
3. **ADR-0113 implemented:** structured refusals with `class`, a stable `code`, the observed state and a suggested next move. Include a daemon-fault counter.
4. **Benchmark, first lane:** semantic vs pixel vs hybrid on two native and two web tasks, across at least two providers. Report turns, tokens, success rate and daemon-fault rate. Add a learning-curve lane (run 1 / 5 / 10) once skills exist.
5. **Security floor before wider use:** H1 isolated world for CDP instrumentation, M7 grants bound to process identity, H3 untrusted-content tagging and a pre-effect hook, M6 WebSocket Origin allow-list, M8 fail-closed audit, and password-field edits refused by default.
6. **ADR-0111 implemented:** receipted foreground preparation, plus human-takeover detection.
7. **CC-07 scaling fix, then ADR-0112 implemented:** UV clicks.
8. **Capability honesty per application,** and a "broad-reach" grant flag for terminals, file managers and settings.
