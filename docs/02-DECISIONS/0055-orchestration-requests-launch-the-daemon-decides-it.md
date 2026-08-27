# ADR-0055 — Orchestration requests launch; the daemon decides it

**Status:** accepted, 2026-08-27

## Context

[ADR-0054](0054-gmail-authority-is-composed-by-the-operator-unit.md) gives the daemon one operator-owned launch authority tuple. M6 Stage 3 needs trusted hub orchestration to request a launch later, but must not duplicate that authority, inspect the permit list, turn application identity into a model argument, or pre-empt Stage 4's voice request lifecycle.

The daemon already answers the complete question. Its `openApplication` gate checks session authority before catalog lookup, then durable capability configuration, then owns catalog lookup, process start, ownership, audit, and the refusal bytes. A hub-side permission model would create a second truth and could disagree with the process that actually touches the desktop.

## Decision

`apps/hub/src/orchestrator/launch.ts` is the trusted, non-model launch caller. It accepts a hub-owned `TransportClient` and one application identity selected by non-model orchestration, makes exactly one `client.openApplication({ name })` call, and returns the transport result unchanged.

Ownership is split as follows:

- orchestration chooses **when** to request one named application;
- daemon startup composition owns **which** names the session may launch;
- daemon capability configuration owns **whether** launch is enabled;
- the daemon owns catalog lookup, process start, ownership tracking, audit, and refusal bytes;
- the hub and model own no permit list, do not infer permission through `listApplications`, and receive no general launch tool.

The seam is built as a dedicated module for trusted callers. It is not registered with Mastra, is absent from `OBSERVE_TOOLS`, `CAPABILITY_TOOLS`, and model-provided extras, and does not add a lane event or provider tool.

Stage 4 may call this seam from a typed request lifecycle. It may supply only the application identity selected by trusted orchestration; it may not widen the seam into arbitrary model-chosen tool arguments. Stage 4 owns admission, correlation, dismissal, notification, and provider integration. This record owns none of them.

## Consequences

The authority answer stays beside the desktop effect, so unknown and unpermitted names remain byte-indistinguishable at the daemon boundary and capability refusals continue to name the daemon setting that withheld them. The hub cannot grant itself launch, and changing permission still means editing the Stage 2 operator-owned configuration and restarting the daemon.

The cost is that correctness depends on the caller remaining trusted. A future route from model arguments directly into the application identity would violate this boundary even though the daemon might refuse some names. The seam is deliberately narrow rather than generally reusable by agents.

Stage 3 launches no personal Gmail profile and reads no mail. Its live measurement uses only a private headless desktop and non-personal `yad`; Gmail is the refusal subject and is never launched. Stage 5 remains the sole pre-final real-Gmail measurement.

## Evidence

- `apps/hub/src/orchestrator/launch.ts` contains the single transport delegation.
- `apps/hub/src/__tests__/the-orchestrator-launches-only-through-the-daemon-gate.test.ts` proves exact success/refusal propagation, forbidden observe calls, defanged recipes, and the exact launch-free model surface.
- `tools/mutations.json` contains deletion mutations for the delegation and one observe-floor entry; both make the focused test fail.
- [M6 orchestrator launch seam](../proofs/m6-orchestrator-launch-seam.md) records the base-red/branch-green live proof: `yad` launched, Gmail was refused byte-for-byte, no browser launched, and cleanup completed.
- [The north-star contract](../10-NORTH-STAR-CONTRACT.md) remains the frozen Stage 1 contract; this decision implements a prerequisite without restating it.
