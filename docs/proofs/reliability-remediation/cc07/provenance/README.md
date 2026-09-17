# CC-07 — A clipped picture says which part of the element it is

```sh
pnpm exec turbo run build
xvfb-run -a -s '-screen 0 200x150x24' node docs/proofs/reliability-remediation/cc07/provenance/demo.mjs
```

This supersedes the interim refusal recorded in [the parent proof](../README.md) (ADR-0102) with the additive contract of [ADR-0105](../../../../02-DECISIONS/0105-a-picture-says-which-part-of-the-element-it-is.md), schema 1.25.0. The demo imports the built public daemon and desktop packages, publishes an identity through `AtspiBackend` using the committed GTK replay fixture, and invokes public `captureElement` dispatch. Geometry alone is scripted; pixel acquisition is real on an isolated 200-by-150 Xvfb display through native xwd, decoding, intersection and PNG encoding. It touches no user desktop and does not claim a real application published the scripted rectangle.

`with.txt` is the current tree: the whole 40-by-30 element answers `clipped: false`, crop `0,0,1,1`, `source: visible-desktop` and a numeric `capturedAt`. Four rectangles hanging a quarter off each edge are **answered**, each with the exact crop (`0.25,0,0.75,1` for the left edge, `0,1/3,1,2/3` for the top, and so on) and picture dimensions equal to the crop times the rectangle. `locateInElement` maps each picture's centre to the element fraction it actually is - `0.625` for the left-clipped picture, not `0.5` - and `describeCapture` names the clip in the text the adapter puts beside the media part. An entirely off-display rectangle is still refused. The final line is `PROOF: GREEN`.

`without.txt` is the same demo against a built `origin/master` checkout before this change: the whole image carries no `clipped`/`source` fields and the demo goes RED at the first assertion; that baseline also refused every clipped rectangle, as the parent proof retains.

Unit gates in the daemon (`a-picture-of-one-element-and-no-more.test.ts`) fix the crop for clipping on each edge, all four at once, a nonzero display origin, and the empty intersection, against known pixel fixtures. The desktop package (`a-place-in-the-picture-is-a-place-in-the-element.test.ts`) fixes centre and edge mapping for whole and clipped crops and refuses non-finite, negative, over-one and out-of-element inputs rather than clamping. `the-adapter-is-optional.test.ts` shows the model receives the media part and the crop text together from the tool's own `toModelOutput`. Mutations `capture-calls-every-picture-whole`, `capture-crop-forgets-the-display-origin`, `the-adapter-drops-the-crop-on-the-way-to-the-model` and `a-place-in-the-picture-is-clamped-not-refused` are each caught.

Not claimed: freshness. The crop is a capture-time relationship; no capture token rejects a stale picture, bounds observation and capture remain non-atomic, and a layout or content change between capture and click is still the caller's to detect by reobserving. Fractional display scaling is not exercised: the fixtures and Xvfb are 1:1, and the crop is defined in element fractions so a scaled display changes pixel counts, not fractions, but that is reasoning rather than a retained measurement.
