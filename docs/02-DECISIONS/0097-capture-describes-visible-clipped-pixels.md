# ADR-0097: Capture describes visible, possibly clipped pixels

Status: accepted for the reliability remediation patch, September 7, 2026.

## Evidence

`protocol/schema.json` previously promised the containing window's pixels even when covered, despite native `daemon/src/backends/atspi/capture.ts` cropping a visible desktop grab. Its image width description also equated image width with full element width, despite `cropScreen` intersecting the rectangle with captured display bounds. The generated Mastra tool inherited this contradictory promise. This is CC-01 from the September 6 remediation handoff.

## Decision

In schema version 1.21.1, correct descriptions only: captures return currently visible pixels intersecting the observed element rectangle and display. They may be clipped or show another window; they do not establish application ownership or hidden-window isolation. Image dimensions describe returned pixels, not necessarily the full element.

Capture remains observational. Foreground preparation uses only an observed, permitted window-navigation action, followed by fresh observation of target and geometry, then capture and inspection. Do not infer that arbitrary activation raises a window. Foreground, focus restoration and capture are not an atomic operation and do not prove non-occlusion. An unavailable authorized route leaves uncertainty, not a hidden input fallback.

No wire fields, permissions, capture implementation or coordinate APIs change. Description/version changes alter the generated digest, so bindings and golden fixtures are regenerated and the existing handshake remains enforced. The patch version denotes a correction of documented behavior, not new capture capability.

## Verification and limits

The generated-adapter regression fails against the old descriptor and passes after regeneration. Existing native decoder/crop/PNG tests cover normal and offscreen/clipped rectangles. An additional fixture changes visible pixels between grabs, checks that covering pixels remain and dimensions are clipped, and asserts no subprocess preparation is introduced when a grab is injected. This is deterministic fixture proof, not a live desktop occlusion trial. Existing capture authority tests and the full workspace gates remain required.

CC-07's explicit geometry/provenance representation and live window-navigation characterization remain separate work; this correction does not claim either is solved. See [ADR-0093](0093-useful-native-controls-with-explicit-limits.md) for native capability limits.
