# ADR-0102: Refuse native partial captures without crop provenance

Date: 2026-09-07
Status: Superseded by [ADR-0105](0105-a-picture-says-which-part-of-the-element-it-is.md) — was the CC-07 conservative interim policy; schema version 1.24.0

## Evidence

Native capture intersects the element rectangle with the root image. An image of the right half alone has a center at three quarters of the full element width. Without crop provenance, passing image fractions to element-relative clicks targets the wrong point. PNG dimensions alone do not establish the missing offset.

## Decision

Choose CC-07's conservative staged fallback rather than expanding the no-coordinate wire contract. Before PNG encoding, native capture compares the actual crop origin and extent to the requested rectangle. Any positive partial intersection is refused with recovery guidance. Empty intersections remain refused. Fully covered rectangles retain the existing image path. The pure crop utility still computes intersections for its other callers and geometry tests.

This intentionally withdraws partial native screenshots, even for observation-only consumers. It is not silently presented as backward-compatible: protocol 1.24.0 documents the behavior, and mirrored instructions prohibit unsupported image-to-element mapping. Bring the whole element onto the display and reobserve; capture itself still does not prepare the desktop. Full coverage does not prove non-occlusion, coordinate scaling correctness, unchanged content, or atomic capture/effect targeting.

## Verification

[CC-07 proof](../proofs/reliability-remediation/cc07/README.md) drives the built native backend and public dispatch over an actual isolated Xvfb display and real XWD/PNG processing. Accessibility identities come from a replay fixture and geometry is scripted. A complete image remains available; positive intersections crossing each of four edges are refused. Baseline returns four ambiguous partial images. Unit fixtures additionally exercise nonzero display origin and combined-edge clipping. Existing invalid/empty geometry and pixel round-trip checks remain gates. Generated adapter descriptions carry the refusal policy to model tools; the existing image media path is unchanged.

## Deferred stronger contract

Normalized crop provenance, capture tokens, adapter metadata media, fractional scaling/rounding transformations, and known-stale capture rejection remain follow-ups. No mapping formula or race-free targeting guarantee is introduced by this patch. These need an explicit additive schema and freshness design before partial screenshots can safely support targeting again.
