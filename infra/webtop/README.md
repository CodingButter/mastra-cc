# Webtop semantic desktop harness

This opt-in development harness proves the built daemon and built transport against a real Webtop desktop and AT-SPI bus. Use replay and the Xvfb witness for fast routine checks; use this harness when desktop-session behavior, browser-visible state, or volume persistence matters.

## Prerequisites

- Docker with Compose support
- The pinned Webtop image (Compose pulls it when absent)
- `pnpm turbo run build` completed on the current worktree
- A free loopback port (default `13300`)

## Commands

```bash
pnpm turbo run build
bash infra/webtop/demo.sh
bash infra/webtop/recreate.sh
bash infra/webtop/diagnostics.sh
bash infra/webtop/cleanup.sh
```

`demo.sh` ends with `PROOF: GREEN`; `recreate.sh` ends with `PERSISTENCE: GREEN`. Both are bounded and clean up only the Compose project selected by `MASTRA_CC_WEBTOP_PROJECT` (default `mcc-webtop-harness`). Set `MASTRA_CC_WEBTOP_PORT` to change the loopback Webtop port.

The live scenario writes a fixed non-sensitive proof sentence through built `@mastra-cc/transport`, re-queries the same element, and requires exact semantic read-back. It also observes a real password control and requires `{ kind: "redacted", reason: "protected" }` without carrying its value.

After the semantic read-back, `witness.mjs` supplies independent visual corroboration that the sentence is actually painted in the editor, not merely reported. It resolves the editor element's on-screen rectangle out of band from AT-SPI's `Component` interface — never from the daemon under test, whose semantic protocol deliberately publishes no pixel geometry — captures only that rectangle, and requires non-uniform ink in it before printing `WITNESS: GREEN`. A blank or uniform crop is a named RED and aborts the run. It proves that glyphs reached the screen, not that they spell the exact sentence; character-exact read-back is the semantic lane's job. This is the committed, re-runnable replacement for the earlier ad-hoc screenshot, which could not be regenerated from a clean checkout.

Diagnostics contain container metadata, process state, socket state, and bounded daemon logs. They must not contain protected content. Ad-hoc proof screenshots and Playwright traces belong under the uncommitted plan proof directory, never in the repository; the reproducible visual claim lives in `witness.mjs` instead.
