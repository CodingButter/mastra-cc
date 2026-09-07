# CC-07 — Refuse ambiguous partial native images

```sh
pnpm exec turbo run build
xvfb-run -a -s '-screen 0 200x150x24' node docs/proofs/reliability-remediation/cc07/demo.mjs
```

The demo imports the built public daemon, publishes an identity through AtspiBackend using the committed GTK replay fixture, and invokes public capture dispatch. Geometry alone is scripted. Pixel acquisition is real: an isolated Xvfb display, native xwd, decoding, intersection and PNG encoding. It does not touch the user's desktop or claim a real application published the scripted rectangle. A fully covered 40-by-30 image must survive; all four edge-clipped captures must be refused. The final line is PROOF: GREEN.

`with.txt` and `without.txt` retain the identical demo. The baseline argument selects the built 00a9ad1 checkout; this predates CC-04 through CC-06 as well, disclosed rather than called the immediate parent. Baseline emits four partial images. Separately, the new five-case geometry regression failed against immediate parent 21004ee before implementation. Compressed test, workspace and mutation transcripts are gates, not substitutes for the native pixel demo.

This is the remediation plan's explicit conservative fallback: partial native observation images are unavailable until provenance is designed. Complete image media remains unchanged. No normalized coordinates, crop-token freshness, content stability, fractional-scale conversion, or race-free click guarantee is claimed. These remain the stronger CC-07 follow-ups described in ADR-0102.
