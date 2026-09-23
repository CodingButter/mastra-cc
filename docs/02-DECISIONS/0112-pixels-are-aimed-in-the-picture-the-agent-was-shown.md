# ADR-0112: Pixels are aimed in the picture the agent was shown

Date: 2026-09-23
Status: Accepted as direction; schema and implementation pending. **Amends [ADR-0004](0004-semantic-first-pixels-last.md)**: pixels become an option the agent may choose, not only a last resort. **Narrows [ADR-0046](0046-raw-input-is-the-most-restricted-class-not-a-banned-one.md)**: element-anchored pointer actions leave the most-restricted class, while un-anchored raw input stays in it. See [14-DIRECTION.md](../14-DIRECTION.md) §1–2.

## Context

Semantic control is faster per turn and more truthful, and it stays first. But some surfaces cannot be driven semantically: canvases, toolkits that describe nothing, and remote sessions. Every competing harness pairs its accessibility tree with pixels ([competitive research](../audits/2026-09-23/COMPETITIVE-RESEARCH.md)). Without the option we cap our own success rate.

The danger ADR-0004 guarded against is still real: screen coordinates guessed from a screenshot, pressed blind. ADR-0105 already gives each capture a crop, a clipping flag and a `capturedAt`. The second ADR-0105 slice refuses presses aimed from a stale picture.

## Decision

1. **The agent aims in UV space.** A pointer action may carry `at: {u, v}`, with `u` and `v` in the range [0, 1] relative to the **captured image** (not the whole element), together with the `capturedAt` of that capture. `capturedAt` is required whenever `at` is present.
2. **The daemon converts.** It maps UV through the stored crop to the element rectangle (`x = cx + u·cw`), then maps that to device pixels using the display scale. No screen coordinate crosses the wire, in either direction.
3. **Refuse, never clamp.** The daemon refuses a stale or superseded capture, a non-finite value, a value outside [0, 1], or a point outside the visible pixels. It refuses before any input is sent.
4. **Receipts carry both ends:** the UV the agent sent, and the device point that was pressed.
5. **It is agent-choosable inside a granted application.** It needs no operator switch. Raw, un-anchored input stays behind ADR-0046.
6. **The foreground is taken first** ([ADR-0111](0111-the-agent-takes-the-desk-explicitly.md)), so the pixels pressed are the pixels shown.

## Consequences

- Good: pixel mode stays tied to a live element and a picture. It is receipted, and it refuses when the picture has gone stale.
- Cost: this is a real loosening of the founding bet. An agent can now reach for pixels when it could have asked the tree. The benchmark ([14-DIRECTION.md](../14-DIRECTION.md) §6) must show whether that happens.
- Prerequisite: the display-scaling defect ([CC-07 scaling proof](../proofs/reliability-remediation/cc07/scaling/README.md)) must be fixed first. Until then, UV conversion is wrong on scaled displays and must be refused there.
- Schema: this is a minor version bump, adding optional `at` on pointer methods.

## Evidence

- ADR-0105 (capture crop provenance and freshness).
- `docs/proofs/reliability-remediation/cc07/scaling/README.md` (logical coordinates vs device pixels).
- `docs/audits/2026-09-23/COMPETITIVE-RESEARCH.md`.
