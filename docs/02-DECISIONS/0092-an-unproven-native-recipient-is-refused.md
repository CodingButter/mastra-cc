# 0092 — An unproven native recipient is refused

Status: superseded by [0093](0093-useful-native-controls-with-explicit-limits.md). Historical decision preserved below.
Date: 2026-09-06
Supersedes: ADR-0088's geometric drawable selection and ADR-0091's outward capture fallback.

## Context

A rectangle does not establish authority. An unrelated window can contain the same rectangle as an authorized accessible. Trying containing windows until one yields pixels can disclose another application's content. Likewise a global pointer press can reach an overlapping window rather than the authorized element; read-back cannot undo that effect.

Application names, window titles and geometric containment do not establish an exact native drawable binding. This correction does not introduce a trusted, race-safe recipient resolver.

## Decision

Fail closed at the native backend. Element capture refuses before launching a pixel reader. Native `clickElement` refuses before focus, reveal, pointer movement or button emission. `PointerBlockedError` is part of the closed refusal vocabulary. Neither another containing drawable nor whole-root capture is an element-capture fallback.

Retain bounded image decoding and subprocess handling for the internal capture utility and deterministic tests. The explicitly requested internal root utility is not exposed by the element-capture protocol method.

## Consequences

- The identified capture disclosure and pointer misdelivery paths cannot run.
- Native element screenshots and clicks are unavailable, even for legitimate unobstructed targets. This is containment, not a functioning ownership resolver or a completed restoration of desktop capability.
- Semantic actions remain available under their existing gates. Keyboard targeting is not strengthened by this decision and must not be described as atomically bound to an element.
- Re-enabling native capture or pointer delivery requires a trustworthy exact recipient binding and live adversarial proof, including overlapping applications, same-application twin windows, transparent/input-only overlays and changes between observation and delivery.

## Evidence

- `daemon/src/backends/atspi/capture.ts`: `grabPixels` refuses element rectangles before subprocess execution; subprocess output/time and decoder allocation are bounded.
- `daemon/src/backends/atspi/index.ts`: native `clickElement` refuses unproven pointer delivery.
- `daemon/src/__tests__/the-audit-log-names-what-was-touched.test.ts`: closed refusal vocabulary includes `PointerBlockedError`.
- Regression verification: `pnpm --filter @mastra-cc/daemon test`; type verification: `pnpm --filter @mastra-cc/daemon typecheck`.
- The original synthetic reproduction is recorded under `docs/proofs/architecture-audit-2026-09-05/`; it is not live evidence of a working ownership resolver.
