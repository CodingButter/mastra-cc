# CC-07 — A press aimed from a stale picture is refused before it is sent

```sh
pnpm exec turbo run build
xvfb-run -a -s '-screen 0 200x150x24' node docs/proofs/reliability-remediation/cc07/freshness/demo.mjs
```

This closes the freshness boundary that [the provenance proof](../provenance/README.md) left open, under [ADR-0107](../../../../02-DECISIONS/0107-a-press-aimed-from-a-picture-names-the-picture.md), schema 1.26.0. `clickElement` takes an optional `capturedAt` naming the picture the press was aimed from; the daemon records the newest picture's `capturedAt` and desk rectangle per answered element, and refuses the press - naming which - if that picture is not the latest or the element's fresh rectangle differs from the one it was cropped from. The demo imports the built public daemon, publishes an identity through `AtspiBackend` using the committed GTK replay fixture, takes real pictures on an isolated 200-by-150 Xvfb display through native xwd, and scripts only the element's rectangle and the pointer sink so it can count what was sent.

`with.txt` is the current tree. A press naming the fresh picture is sent at the picture's top-left. After the rectangle moves from `(10,10)` to `(60,10)`, the same press is refused with `PointerBlockedError` naming both rectangles and nothing further is sent. After a second picture, a press naming the first is refused as re-photographed, again with nothing sent; a press naming the second is sent at the moved rectangle. A press naming no picture is sent at the fresh rectangle as it was before. The final line is `PROOF: GREEN`.

`without.txt` is the same demo against a built `origin/master` (`8b102b6`) checkout: `capturedAt` is not in the contract, the moved element is pressed anyway, and the demo goes RED at the second case.

Unit gates: `daemon/src/__tests__/a-press-aimed-from-an-old-picture.test.ts` (five cases: fresh aim, moved element, superseded picture then newest aims, never-answered and non-finite `capturedAt`, unclaimed press unchanged). The adapter text beside every picture now tells the model to pass `capturedAt` (`a-place-in-the-picture-is-a-place-in-the-element.test.ts`). Mutations `a-press-ignores-the-picture-it-names`, `an-older-picture-passes-as-the-latest` and `a-moved-element-still-matches-its-picture` are each caught (`mutations.txt.gz`). `freeze.txt` records the compliant schema bump.

Not claimed: the check is against the daemon's freshly read rectangle, not against pixels - content can change inside an unmoved rectangle and remains the caller's to verify by read-back. Fresh read and press are still non-atomic; the window is narrowed to the daemon's own read-then-send. Two captures in the same millisecond share a `capturedAt` and the same rectangle, so the second simply replaces the first. Fractional display scaling remains unexercised on real pixels.
