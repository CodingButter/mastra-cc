# 0093 — Useful native controls with explicit limits

Status: accepted
Date: 2026-09-06
Supersedes: [0092](0092-an-unproven-native-recipient-is-refused.md); replaces the native capture mechanics in ADR-0088 and ADR-0091.

## Context

The user explicitly prioritised useful desktop operation over perfect isolation. ADR-0092's blanket refusal removed legitimate native clicks and screenshots. Its warning remains valid: geometry, application names and PID matching do not establish a secure, atomic recipient binding.

## Decision

Restore native `clickElement` using fresh native element bounds, reveal/focus and bounded raw pointer calls. Retain stale-ID, disabled-control, missing/empty-bounds and offscreen checks; refuse targets that remain unusable after reveal. These are practical checks, not an atomic guarantee about which window receives input.

Restore native `captureElement` as a root-screen screenshot cropped to the intersection of the named element's bounds and the display. Partially offscreen rectangles are clipped; invalid bounds or an empty intersection are refused. The result contains **VISIBLE pixels**, potentially including other applications, not application-owned pixels. Geometry observation and capture are non-atomic. The caller still names an element rather than an arbitrary screen region. Retain stale-ID checks and bounded subprocess/image handling.

Semantic application grants and method capabilities remain required. They govern the named semantic target and permitted operation, but do not promise pixel or input isolation. Human control, cancellation, bounded execution and retry safety remain requirements: stop when control is withdrawn, do not replay uncertain effects blindly, and reobserve before another attempt.

The daemon owns native capture, focus, reveal and input mechanics. Portable core instructions own semantic-first policy, fallback guidance and outcome verification. The demo owns installation-specific launch, display and application configuration; none moves into portable core.

## Consequences

- Legitimate native operations can be attempted without waiting for a secure recipient resolver. Overlap can expose another application's pixels or redirect a click. Transparent/input-only overlays and changes between checking and delivery (TOCTOU) remain limitations; even a clear screenshot does not prove the next input recipient.
- Prefer semantic actions, then a justified bounded pointer fallback. If a crop shows an overlay, reobserve, raise the target through an observed window-navigation control and capture again before acting.
- A screenshot returned or a click reported performed is not task-success evidence. Verify the requested state change, report uncertainty, and avoid duplicate effects after cancellation or an uncertain result. This decision claims neither human-equivalent competence nor completed live proof.

## Evidence

- User direction, 2026-09-06: restore useful native click/capture with explicit overlap and isolation limits rather than ADR-0092's blanket refusal.
- ADR-0092 records the prior containment rationale; ADR-0088 and ADR-0091 preserve the earlier capture decisions, not the current pixel contract.
- Implementation ownership: `daemon/src/backends/atspi/index.ts` and `daemon/src/backends/atspi/capture.ts`; portable guidance: `docs/11-AGENT-INSTRUCTIONS.md` and its byte-identical packaged copy.
- September 6 final verification: Turbo 19/19 passed after corrections; daemon 806 passed/25 skipped, desktop 60 passed, demo 42 passed. The [native restoration proof](../proofs/native-restoration-2026-09-06/README.md) passed text readback, independently measured PNG dimensions, exact visible interior RGB comparison with blank/shift negative controls, and a real GTK button callback. No end-to-end wallpaper success or live overlap, transparent-overlay or timing proof is established.
- Mutation rerun completed: 223 mutations, none survived. The earlier supervising-shell timeout was runner failure, not a survived mutation. Full Turbo was rerun after mutation restoration, not concurrently.
- Actual display-bounds querying and the per-tool-set dispatch guard for cancel/handover during lazy dial are implemented and regression-tested. Stream EOF/read/parse failure before a terminal event warns that effects may already have happened. Transport open/hello still has no deadline while connection is pending. Shared-demo concurrency is not production multi-tenant isolation.
- Chromium/KDE-specific installation guarantees belong only to demo configuration; portable instructions describe conditional techniques. These checkpoint facts do not turn this approved contract into a complete verification report.
