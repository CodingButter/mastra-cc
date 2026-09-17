# CC-01: Visible-pixel capture contract

## Claim

The generated tool no longer promises an obscured application's own pixels. Image dimensions describe returned, possibly clipped pixels. Capture is observational; permitted foreground preparation and fresh geometry observation precede capture rather than being hidden inside it. See [ADR-0097](../../../02-DECISIONS/0097-capture-describes-visible-clipped-pixels.md).

## Run

From the repository root, with workspace dependencies installed:

```sh
bash docs/proofs/reliability-remediation/cc01/demo.sh
```

This regenerates the bindings, builds packages, checks the real generated adapter description, runs native capture fixtures and validates the schema freeze and documentation. It neither launches an application nor sends desktop input.

## Retained evidence

- `without.txt.gz`: `pnpm --filter @mastra-cc/desktop exec vitest run src/__tests__/the-adapter-is-optional.test.ts` before the descriptor correction. One intended assertion failed: the generated description did not contain `currently visible pixels`; the old covered-window promise is printed in the failure. The six existing adapter cases passed.
- `with.txt.gz`: the demo command above after correction.
- `workspace.txt.gz`: `pnpm turbo run build lint typecheck test --force`; all 19 workspace tasks passed with no cache hits.

The native fixture exercises `capture` and the decoder/PNG path with injected root pixels, switches from uncovered to covering pixels, verifies clipping and checks no subprocess preparation occurred. Existing tests cover wholly offscreen bounds, malformed geometry and hostile image headers. This is fixture proof, not a live compositor or window-navigation trial. No claim of atomic capture, pixel ownership or prevention of invisible input interception is made.

## Remaining work

CC-07 geometry/provenance representation and live foreground characterization remain outside this patch. Mousepad real-agent/visual acceptance remains separately blocked and is not made GREEN by these tests.
